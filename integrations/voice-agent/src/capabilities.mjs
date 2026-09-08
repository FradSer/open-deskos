import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'
import { Type } from 'typebox'
import { defineTool } from '@earendil-works/pi-coding-agent'

export function sessionCommand(executable, host) {
  if (!host) return { executable, args: [] }
  if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('Invalid SSH host')
  if (!isAbsolute(executable)) throw Error('SSH session-control executable must be absolute')
  if (/[\x00-\x1f\x7f]/.test(executable)) throw Error('Invalid SSH executable')
  const quoted = `'${executable.replaceAll("'", "'\\''")}'`
  return { executable: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '--', host, quoted] }
}

export async function sessionRequest(request, signal, executable = process.env.PI_SESSION_CONTROL_COMMAND || 'pi-session-control', host = process.env.PI_SESSION_CONTROL_SSH_HOST) {
  const command = sessionCommand(executable, host)
  const payload = { ...request, version: 1, requestId: randomUUID() }
  const failure = message => Error(request.command === 'send' ? 'Session-control delivery outcome unknown; do not retry automatically' : message)
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: ['pipe', 'pipe', 'ignore'], signal })
    let output = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(failure('Session-control timeout')) }, 10_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      if (Buffer.byteLength(output) > 262_144) { child.kill('SIGKILL'); reject(failure('Session-control response too large')) }
    })
    child.on('error', () => { clearTimeout(timer); reject(failure('Session-control unavailable')) })
    child.stdin.on('error', () => {})
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0) return reject(failure('Session-control failed'))
      try { resolve(JSON.parse(output.trim())) } catch { reject(failure('Invalid session-control response')) }
    })
    child.stdin.end(`${JSON.stringify(payload)}\n`)
  })
  if (result.version !== 1 || result.requestId !== payload.requestId || typeof result.ok !== 'boolean') throw failure('Invalid session-control response')
  if (!result.ok) throw Error('Session-control request rejected')
  return result
}

function coreCapabilities() {
  return [
    defineTool({
      name: 'live_sessions', label: 'Live sessions', description: 'List currently reachable Pi sessions. Never infer live sessions from history files.',
      parameters: Type.Object({}),
      execute: async (_id, _params, signal) => result(await sessionRequest({ command: 'list' }, signal)),
    }),
    defineTool({
      name: 'send_to_session', label: 'Send to live session', description: 'Send to an exact ID from live_sessions. Accepted or queued means delivery, not completion. Never retry automatically after an unknown delivery outcome.',
      parameters: Type.Object({ sessionId: Type.String({ minLength: 1 }), text: Type.String({ minLength: 1, maxLength: 16_384 }), deliverAs: Type.Optional(Type.Union([Type.Literal('steer'), Type.Literal('followUp')])) }),
      execute: async (_id, params, signal) => result(await sessionRequest({ command: 'send', ...params, deliverAs: params.deliverAs ?? 'followUp' }, signal)),
    }),
  ]
}

function result(value) {
  return { content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(value) }], details: {} }
}

export async function loadCapabilities(paths = []) {
  const tools = coreCapabilities()
  const names = new Set(['read', 'write', 'edit', 'bash', ...tools.map(tool => tool.name)])
  for (const path of paths) {
    if (!isAbsolute(path)) throw Error('Capability paths must be absolute')
    const module = await import(pathToFileURL(path).href)
    const additions = await module.default()
    if (!Array.isArray(additions)) throw Error('Capability must return a tool array')
    for (const tool of additions) {
      if (!tool.name || typeof tool.execute !== 'function' || names.has(tool.name)) throw Error('Invalid or duplicate capability')
      names.add(tool.name)
      tools.push(tool)
    }
  }
  return tools
}
