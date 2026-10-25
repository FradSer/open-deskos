import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { copyJson } from '@earendil-works/chord'
import { AssistantEntry, Harness, MemoryStorage, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode'
import { CodemodeSandbox } from '@earendil-works/pi-codemode'
import { Connection, LocalExecutionEnv, RemoteExecutionEnv, localDaemon, sshArguments } from '@earendil-works/pi-env'
import { checkProactivePath, createProactiveDirectory } from './proactive-private.mjs'
import { openPrivateDurableStorage } from './durable-storage.mjs'

/** Convert reviewed Coding Agent capabilities without changing their authorization checks.
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition} tool
 * @param {{callers?: ('model'|'tools')[]}} [options]
 */
export function durableCapability(tool, { callers = ['tools'] } = {}) {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    callers,
    // Catalog read-only hints are not guarantees about interruption or external effects.
    replay: 'unsafe',
    executionMode: 'sequential',
    ...(tool.outputSchema ? { structuredOutputSchema: tool.outputSchema } : {}),
    execute: async (args, api, context) => {
      const result = await tool.execute(api.callId, args, context.abortSignal,
        update => { for (const part of update.content ?? []) if (part.type === 'text') api.output(part.text) }, undefined)
      return {
        output: result.content,
        ...(result.details === undefined ? {} : { details: copyJson(result.details) }),
        ...(result.isError === undefined ? {} : { isError: result.isError }),
        ...(tool.outputSchema && result.structuredContent !== undefined ? { structuredOutput: copyJson(result.structuredContent) } : {}),
      }
    },
  })
}

/** Connections are explicit. Remote construction never provisions a daemon or accepts a host key.
 * @param {{cwd: string, remote?: boolean, id?: string, connection?: Connection}} options
 */
export function createPiExecutionTarget({ cwd, remote = false, id, connection }) {
  if (typeof cwd !== 'string' || !cwd.trim()) throw Error('Pi execution target requires an explicit project')
  if (remote && (!connection || !id)) throw Error('Remote Pi execution requires an explicit connection and identity')
  if (!remote && !isAbsolute(cwd)) throw Error('Local Pi execution requires an absolute project')
  const owned = !connection
  const channel = connection ?? new Connection({ command: [localDaemon()] })
  const env = remote ? new RemoteExecutionEnv({ cwd, id, connection: channel })
    : new LocalExecutionEnv({ cwd, connection: channel })
  let closed = false
  return { env, async close() {
    if (closed) return
    closed = true
    try { await env.cleanup(BACKGROUND_CONTEXT) }
    finally { if (owned) channel.close() }
  } }
}

/** Connect to a daemon the operator has already provisioned and trusted.
 * The remote command is operator configuration, never model input. It includes
 * any quoting required by the target's SSH login shell. Pi adds protocol args.
 * @param {{target: import('@earendil-works/pi-env').SshTarget, daemonCommand: string,
 * onLog?: (text: string) => void}} options
 */
export function createPiSshConnection({ target, daemonCommand, onLog }) {
  if (typeof daemonCommand !== 'string' || !daemonCommand.trim() || /[\r\n\0]/.test(daemonCommand)) throw Error('Pi SSH requires an explicit daemon command')
  return new Connection({ command: [process.execPath, fileURLToPath(new URL('./pi-ssh-transport.mjs', import.meta.url)),
    target.ssh ?? 'ssh', ...sshArguments(target), daemonCommand], onLog })
}

async function privateDirectory(directory) {
  if (!directory || !isAbsolute(directory)) throw Error('Durable state requires an absolute private directory')
  createProactiveDirectory(directory)
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw Error('Unsafe durable state directory')
  checkProactivePath(directory)
  if (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) throw Error('Durable state directory must be private')
}

/** The Pi Durable 1.4 Harness owns all admitted work and persisted conversation state.
 * @param {{directory?: string, ephemeral?: boolean, models: import('@earendil-works/pi-ai').Models,
 * model: import('@earendil-works/pi-durable').ModelRef, tools?: import('@earendil-works/pi-durable').ToolRegistration[],
 * instructions?: string, cwd?: string, codeMode?: boolean, thinkingLevel?: import('@earendil-works/pi-ai').ModelThinkingLevel,
 * extensions?: import('@earendil-works/pi-durable').Extension[],
 * settings?: import('@earendil-works/pi-durable').HarnessSettings,
 * env?: import('@earendil-works/pi-durable').HarnessOptions['env']}} options
 */
export async function openDurableRuntime({ directory, ephemeral = false, models, model, tools = [], instructions = '', cwd, codeMode = true, thinkingLevel, env, extensions = [], settings = {} }) {
  const context = BACKGROUND_CONTEXT
  if (!ephemeral) await privateDirectory(directory)
  const storage = ephemeral ? new MemoryStorage() : await openPrivateDurableStorage(directory, context)
  const registry = createRegistry()
  let harness, sandbox
  try {
    registry.install(defineExtension({ name: 'odk.reviewed-capabilities', tools }))
    sandbox = codeMode ? new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024 }) : undefined
    if (sandbox) registry.install(createCodemodeExtension({ sandbox, models: false }))
    for (const extension of extensions) registry.install(extension)
    harness = await Harness.open(storage, { models, registry, env,
      settings: { retry: { enabled: false }, compaction: { enabled: false }, toolExecution: 'sequential', ...settings } }, context)
    const conversation = await harness.root(context, { agent: { model, thinkingLevel, instructions, cwd,
      ...(codeMode ? { modelTools: [{ name: 'codemode' }] } : {}) } })
    // Update host configuration on reopen. Persisted names cannot preserve removed authority.
    await conversation.configure({ model, thinkingLevel, instructions, cwd, tools: [...tools, ...(codeMode ? [{ name: 'codemode' }] : [])],
      modelTools: codeMode ? [{ name: 'codemode' }] : tools.filter(tool => !tool.callers || tool.callers.includes('model')) }, context)
    let closing
    return {
      harness, conversation, registry,
      submit: (text, { requestId = undefined, whenBusy = 'reject' } = {}) => conversation.submit({ type: 'input', content: text, requestId, whenBusy }, context),
      async prompt(text, { requestId = undefined } = {}) {
        const submission = await conversation.submit({ type: 'input', content: text, requestId, whenBusy: 'reject' }, context)
        const outcome = await submission.wait(context)
        if (outcome.status !== 'done' || outcome.type !== 'input') throw Error('Durable agent request failed')
        const entry = await conversation.commit(tx => tx.entry(AssistantEntry, outcome.answer), context)
        return (entry?.model ?? []).filter(message => message.role === 'assistant')
          .flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)).join('\n')
      },
      abort: () => conversation.abort(context),
      close() {
        if (!closing) closing = (async () => {
          try { await harness.close(context) }
          finally { await sandbox?.close() }
        })()
        return closing
      },
    }
  } catch (error) {
    try { if (harness) await harness.close(context); else await storage.close(context) }
    finally { await sandbox?.close() }
    throw error
  }
}
