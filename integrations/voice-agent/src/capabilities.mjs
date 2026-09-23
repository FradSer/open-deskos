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

async function userAppsRequest(command, appId, signal, placement) {
  const request = { v: 1, id: randomUUID(), command, ...(appId ? { appId } : {}), ...(placement ? { placement } : {}) }
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
  const placement = Type.Object({
    pageId: Type.String({ minLength: 1, maxLength: 64 }),
    col: Type.String({ pattern: '^[1-5](?: / [2-6])?$' }),
    row: Type.String({ pattern: '^[1-3](?: / [2-4])?$' }),
  }, { additionalProperties: false })
  return defineTool({
    name: ['list', 'desktop'].includes(command) ? `user_apps_${command}` : `user_app_${command}`,
    label: `User app ${command}`,
    description,
    parameters: needsAppId ? Type.Object({
      id: Type.String({ pattern: APP_ID.source, minLength: 1, maxLength: 64 }),
      ...(command === 'install' ? { placement: Type.Optional(placement) } : {}),
      ...(command === 'place' ? { placement } : {}),
    }, { additionalProperties: false }) : Type.Object({}),
    execute: async (_id, params, signal) => {
      const id = needsAppId && 'id' in params && typeof params.id === 'string' ? params.id : undefined
      return result(await userAppsRequest(command, id, signal, 'placement' in params ? params.placement : undefined))
    },
  })
}

/**
 * Commands the coordinator may run against a target. Every command that acts on
 * a session that already exists carries its durable task identity, because the
 * coordinator's job is to keep working with the sessions the desk already owns,
 * not to start a replacement when the operator says "continue".
 */
// The daemon accepts only a session's own project as an identity, not a broader scope: a root
// resolves a session in the list and nowhere else, so the coordinator must carry the project the
// list reported. Stating it on every identity tool is what keeps a spoken reference resolvable.
const SESSION_IDENTITY = "Pass the session's own project exactly as coding_tasks_list reported it, not a broader root."
const TASK_COMMANDS = {
  start: { tool: 'coding_task_start', extra: { prompt: Type.String({ minLength: 1, maxLength: 16_384 }) },
    description: 'Start an independent Pi session on an explicit configured target and project. Accepted is not completed or verified. Never retry a mutation after an unknown outcome; reconcile with status.' },
  list: { tool: 'coding_tasks_list',
    description: 'List the sessions recorded on a target, most recently updated first, with their project, state, lifecycle, activity, last turn outcome and a goal preview. A project scope covers that project and everything under it, so a configured development root is a valid project and lists every session under it. This is how a spoken reference such as the second working session on the desk is resolved to a durable task ID and that session\'s own project.' },
  status: { tool: 'coding_task_status', extra: { taskId: Type.String({ minLength: 36, maxLength: 36 }) },
    description: `Read one recorded session by its durable task ID: lifecycle, activity, last turn outcome and latest bounded response. Finished is not verified success. ${SESSION_IDENTITY}` },
  history: { tool: 'coding_task_history', extra: { taskId: Type.String({ minLength: 36, maxLength: 36 }), position: Type.Optional(Type.Integer({ minimum: 0 })) },
    description: `Read one bounded page of an existing session's own events by durable task ID, optionally after a physical position an earlier page returned. Reports what that session has produced; it creates no new session and replays nothing. ${SESSION_IDENTITY}` },
  prompt: { tool: 'coding_task_prompt',
    extra: { taskId: Type.String({ minLength: 36, maxLength: 36 }), prompt: Type.String({ minLength: 1, maxLength: 16_384 }), streamingBehavior: Type.Optional(Type.Union([Type.Literal('steer'), Type.Literal('followUp')])) },
    description: `Give an existing session a further instruction, keeping its identity: an idle session runs it as another turn, while a session already working requires streamingBehavior to steer or follow up that running turn. A session that is still starting is refused as starting, and an ended one as ended. Accepted is not completed; read status or history before reporting progress. ${SESSION_IDENTITY}` },
  cancel: { tool: 'coding_task_cancel', extra: { taskId: Type.String({ minLength: 36, maxLength: 36 }) },
    description: `Abort one working turn of an existing session. The session keeps its identity and stays attachable instead of being disposed. ${SESSION_IDENTITY}` },
  end: { tool: 'coding_task_end', extra: { taskId: Type.String({ minLength: 36, maxLength: 36 }) },
    description: `End an existing session, disposing it and releasing its host slot, while its terminal receipt and persisted history stay readable. Ending an already-ended session is accepted and changes nothing. Never end a session merely to escape an unknown mutation outcome; reconcile with status first. ${SESSION_IDENTITY}` },
}

function codingTaskTool(command, targets) {
  const spec = TASK_COMMANDS[command]
  return defineTool({
    name: spec.tool, label: command === 'list' ? 'Coding tasks list' : `Coding task ${command}`,
    description: spec.description,
    parameters: Type.Object({
      target: Type.Union([Type.Literal('cm5'), Type.Literal('mac')]),
      project: Type.String({ minLength: 1 }),
      ...spec.extra,
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
    userAppTool('desktop', 'List desktop page IDs, one-based page numbers, grid dimensions and occupied cells before selecting a widget location. Only grid pages accept widgets.', false),
    userAppTool('install', 'Verify and install a resident user application draft. Optional widget placement uses pageId and CSS grid line strings col/row (for example 2 / 4). Occupied locations are rejected, never overwritten.', true),
    userAppTool('place', 'Move or resize an installed widget using pageId and CSS grid line strings col/row without changing its verified revision. List desktop locations first; occupied cells are rejected.', true),
    userAppTool('rollback', 'Roll back a resident user application through the shell lifecycle backend.', true),
    userAppTool('remove', 'Remove a resident user application through the shell lifecycle backend.', true),
    defineTool({
      name: 'coding_targets', label: 'Coding targets', description: 'List configured target IDs, names and development roots. Configuration is not a network health or availability check.',
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => result({ targets: targets.map(({ id, name, roots }) => ({ id, name, roots })) }),
    }),
    ...Object.keys(TASK_COMMANDS).map(command => codingTaskTool(command, targets)),
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
