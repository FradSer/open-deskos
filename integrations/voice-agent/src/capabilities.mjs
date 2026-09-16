import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'
import { Type } from 'typebox'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { loadTargets, taskRequest } from './task-client.mjs'

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

function codingTaskTool(command, targets) {
  return defineTool({
    name: command === 'list' ? 'coding_tasks_list' : `coding_task_${command}`, label: `Coding task ${command}`,
    description: `${command} an independent Pi task on an explicit configured target and project. Accepted is not completed or verified. Never retry mutations after unknown outcomes; reconcile with status.`,
    parameters: Type.Object({
      target: Type.Union([Type.Literal('cm5'), Type.Literal('mac')]),
      project: Type.String({ minLength: 1 }),
      ...(command === 'start' ? { prompt: Type.String({ minLength: 1, maxLength: 16_384 }) } : {}),
      ...(['status', 'cancel'].includes(command) ? { taskId: Type.String({ minLength: 36, maxLength: 36 }) } : {}),
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const target = targets.find(target => target.id === params.target)
      if (!target) throw Error('Target is not configured; use coding_targets and ask the user')
      return result(await taskRequest(target, { ...params, command }, signal))
    },
  })
}

function coreCapabilities(targets) {
  return [
    userAppTool('list', 'List installed resident user applications from the shell lifecycle backend.', false),
    userAppTool('install', 'Install a resident user application draft through the shell lifecycle backend.', true),
    userAppTool('rollback', 'Roll back a resident user application through the shell lifecycle backend.', true),
    userAppTool('remove', 'Remove a resident user application through the shell lifecycle backend.', true),
    defineTool({
      name: 'coding_targets', label: 'Coding targets', description: 'List configured target IDs, names and development roots. Configuration is not a network health or availability check.',
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => result({ targets: targets.map(({ id, name, roots }) => ({ id, name, roots })) }),
    }),
    ...['start', 'status', 'list', 'cancel'].map(command => codingTaskTool(command, targets)),
  ]
}

function result(value) {
  return { content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(value) }], details: {} }
}

export async function loadCapabilities(paths = []) {
  const tools = coreCapabilities(await loadTargets())
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
