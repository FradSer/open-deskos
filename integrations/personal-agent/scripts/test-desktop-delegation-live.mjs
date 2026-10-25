#!/usr/bin/env node
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { openDurableRuntime, durableCapability } from '../src/durable-runtime.mjs'
import { createReviewedCapabilities } from '../src/reviewed-capabilities.mjs'
import { guardIntentTools } from '../src/intent-routing.mjs'

const phases = { start: 'desktop_task_start', status: 'desktop_task_status', result: 'desktop_task_result', cancel: 'desktop_task_cancel', resume: 'desktop_task_resume' }
const fixtureModel = { api: 'openai-responses', provider: 'synthetic-desktop-coordinator', id: 'deterministic', name: 'Synthetic desktop delegation',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
const assistant = (content, stopReason = 'stop') => ({ role: 'assistant', api: fixtureModel.api, provider: fixtureModel.provider, model: fixtureModel.id,
  content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, stopReason, timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
function advertisedTools(context) {
  const names = new Set()
  for (const message of context.messages) {
    if (message.role !== 'system') continue
    if (message.replace) names.clear()
    for (const name of message.toolsRemoved ?? []) names.delete(typeof name === 'string' ? name : name.name)
    for (const tool of message.toolsAdded ?? []) names.add(tool.name)
  }
  return [...names]
}

/** Run the actual Pi Durable harness, Code Mode sandbox and nested reviewed tool.
 * Only the coordinator decisions are synthetic. The socket service owns worker inference.
 * This function never reads provider credentials or supplies screenshots to the coordinator.
 */
export async function runDesktopDelegation({ socket, directory, request, phase = 'start' }) {
  const toolName = phases[phase]
  if (!toolName || !request || typeof request !== 'object' || Array.isArray(request)) throw Error('Invalid desktop harness phase or request')
  if (Buffer.byteLength(JSON.stringify(request)) > 65536) throw Error('Desktop harness request exceeds limit')
  if (typeof directory !== 'string' || !directory) throw Error('A private harness directory is required')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const runDirectory = join(resolve(directory), `pi-${phase}-${randomUUID()}`)
  const capabilities = await createReviewedCapabilities({ declarations: { desktop: { socketPath: socket } }, stateDir: runDirectory })
  let runtime, receipt, modelCalls = 0, nestedExecutions = 0, modelFacingTools = []
  try {
    const guarded = guardIntentTools(capabilities.tools, () => 'desktop_work', () => 1)
    const tools = guarded.map(tool => ({ ...tool, execute: async (...args) => {
      nestedExecutions++
      if (tool.name !== toolName || nestedExecutions !== 1) throw Error('Unexpected desktop harness call')
      const result = await tool.execute(...args)
      receipt = result.structuredContent
      return result
    } }))
    const models = {
      getAvailable: async () => [fixtureModel], getAvailableSnapshot: () => [fixtureModel], getModels: () => [fixtureModel], getModel: () => fixtureModel,
      getAuth: async () => undefined,
      streamSimple: (_model, context) => {
        const result = Promise.resolve().then(() => {
          modelCalls++
          modelFacingTools = advertisedTools(context)
          if (modelFacingTools.length !== 1 || modelFacingTools[0] !== 'codemode') throw Error('Unexpected model-facing tool surface')
          for (const message of context.messages) if (Array.isArray(message.content) && message.content.some(part => part.type === 'image')) throw Error('Coordinator received image content')
          if (modelCalls === 1) return assistant([{ type: 'toolCall', id: `desktop-${randomUUID()}`, name: 'codemode', arguments: {
            code: `text(await tools.${toolName}(${JSON.stringify(request)}));`,
          } }], 'toolUse')
          if (modelCalls !== 2 || context.messages.at(-1)?.role !== 'toolResult' || context.messages.at(-1).isError || !receipt) throw Error('Desktop nested call did not produce its receipt')
          return assistant('The task receipt was read. Admission and agent-reported verification remain separate.')
        })
        return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
      },
    }
    runtime = await openDurableRuntime({ directory: runDirectory, cwd: runDirectory, models,
      model: { provider: fixtureModel.provider, modelId: fixtureModel.id }, tools: tools.map(tool => durableCapability(tool)),
      instructions: 'Delegate only the supplied task through its fixed desktop tool. Report admission separately from worker-reported outcomes. The coordinator never operates the desktop.' })
    const answer = await runtime.prompt(JSON.stringify({ phase, request }), { requestId: randomUUID() })
    if (modelCalls !== 2 || nestedExecutions !== 1 || !receipt) throw Error('Desktop harness execution was incomplete')
    return { phase, runDirectory, coordinator: { synthetic: true, model: fixtureModel.provider + '/' + fixtureModel.id, paidModelCalls: 0 },
      workerInference: 'Owned by the independent socket service; verify the worker journal separately.',
      modelCalls, nestedExecutions, modelFacingTools, receipt, answer }
  } finally {
    try { await runtime?.close() } finally { await capabilities.close() }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { socket: { type: 'string' }, directory: { type: 'string' }, request: { type: 'string' }, phase: { type: 'string', default: 'start' } }, strict: true })
    if (!values.request) throw Error('A request JSON file is required')
    const bytes = await readFile(values.request)
    if (bytes.length > 65536) throw Error('Request JSON exceeds limit')
    const report = await runDesktopDelegation({ ...values, request: JSON.parse(bytes.toString('utf8')) })
    process.stdout.write(JSON.stringify(report) + '\n')
  } catch {
    process.stderr.write('Desktop delegation harness failed; inspect the isolated harness directory and service status. No mutation was retried.\n')
    process.exitCode = 1
  }
}
