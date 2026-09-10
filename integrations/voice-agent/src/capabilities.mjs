import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
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

const APP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function appSocket() {
  return process.env.ODESK_APPS_CONTROL_SOCKET || `${process.env.XDG_RUNTIME_DIR || '/run/user/' + process.getuid()}/open-deskos-apps/control.sock`
}

async function userAppsRequest(command, appId, signal) {
  const request = { v: 1, id: randomUUID(), command, ...(appId ? { appId } : {}) }
  const timeout = command === 'install' ? 30_000 : 10_000
  return await new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const socket = createConnection(appSocket())
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      error ? reject(error) : resolve(value)
    }
    const abort = () => finish(Error('Application lifecycle request aborted'))
    const timer = setTimeout(() => finish(Error('Application lifecycle request timed out')), timeout)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      output += chunk
      if (Buffer.byteLength(output) > 512 * 1024) return finish(Error('Application lifecycle response too large'))
      const newline = output.indexOf('\n')
      if (newline < 0) return
      let response
      try { response = JSON.parse(output.slice(0, newline)) } catch { return finish(Error('Invalid application lifecycle response')) }
      if (response.v !== 1 || response.id !== request.id || typeof response.ok !== 'boolean') return finish(Error('Invalid application lifecycle response'))
      if (!response.ok) return finish(Error(typeof response.error === 'string' ? response.error : 'Application lifecycle request rejected'))
      finish(null, response)
    })
    socket.on('error', () => finish(Error('Application lifecycle control unavailable')))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function userAppTool(command, description, needsAppId = true) {
  return defineTool({
    name: command === 'list' ? 'user_apps_list' : `user_app_${command}`,
    label: `User app ${command}`,
    description,
    parameters: needsAppId ? Type.Object({ id: Type.String({ pattern: APP_ID.source, minLength: 1, maxLength: 64 }) }) : Type.Object({}),
    execute: async (_id, params, signal) => {
      const id = needsAppId && 'id' in params && typeof params.id === 'string' ? params.id : undefined
      return result(await userAppsRequest(command, id, signal))
    },
  })
}

function coreCapabilities() {
  return [
    userAppTool('list', 'List installed resident user applications from the shell lifecycle backend.', false),
    userAppTool('install', 'Install a resident user application draft through the shell lifecycle backend.', true),
    userAppTool('rollback', 'Roll back a resident user application through the shell lifecycle backend.', true),
    userAppTool('remove', 'Remove a resident user application through the shell lifecycle backend.', true),
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
