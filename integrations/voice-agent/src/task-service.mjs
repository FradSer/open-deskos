import { join } from 'node:path'
import { admittedProject, atomicRecord, loadRecords, RECORD_LIMIT, serializeRecord, validText, validateConfig, within } from './task-store.mjs'

export const TASK_TEXT_LIMIT = 16 * 1024
const INCOMPLETE_RESPONSE = '任务执行未正常完成，请检查本机会话记录'
/** @param {Task} task */
export function reserveTaskRecord(task) {
  serializeRecord({ ...task, state: 'interrupted', response: INCOMPLETE_RESPONSE })
}
/** @param {Task} task */
function boundedResponse(task) {
  let remaining = RECORD_LIMIT - Buffer.byteLength(JSON.stringify({ ...task, response: '' }))
  let response = ''
  for (const character of boundedText(task.response)) {
    const cost = Buffer.byteLength(JSON.stringify(character)) - 2
    if (cost > remaining) break
    response += character
    remaining -= cost
  }
  return response
}
/** @param {string} text @param {number} [limit] */
export function boundedText(text, limit = TASK_TEXT_LIMIT) {
  const bytes = Buffer.from(text)
  if (bytes.length <= limit) return bytes.toString('utf8')
  let end = limit
  while ((bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}
/** @typedef {{taskId:string,project:string,prompt:string,state:string,verification:string,createdAt:string,updatedAt:string,response:string}} Task */
/** @typedef {{task:Task,signal:AbortSignal,sessionDir:string,model?:string}} TaskInput */
/** @param {import('./task-store.mjs').TaskConfig} input
 * @param {{runTask:(input:TaskInput)=>Promise<{text:string,stopReason?:string}>}} adapter */
export async function createTaskService(input, { runTask }) {
  const config = await validateConfig(input)
  const records = await loadRecords(config.stateDir)
  /** @type {Map<string,{controller:AbortController,done:Promise<void>}>} */
  const active = new Map()
  let serial = Promise.resolve()
  let closing = false
  let storageFailure = false
  const save = task => atomicRecord(join(config.stateDir, `${task.taskId}.json`), task)

  async function execute(task, controller) {
    try {
      controller.signal.throwIfAborted()
      const result = await runTask({ task: { ...task }, signal: controller.signal, sessionDir: join(config.stateDir, 'sessions', task.taskId), model: config.model })
      task.response = boundedText(result.text || '')
      task.state = controller.signal.aborted || result.stopReason === 'aborted' ? 'cancelled' : result.stopReason === 'stop' ? 'finished' : 'failed'
      if (task.state !== 'finished' && !task.response.trim()) task.response = task.state === 'cancelled' ? '任务已取消' : INCOMPLETE_RESPONSE
    } catch {
      task.state = controller.signal.aborted ? 'cancelled' : 'failed'
      task.response = controller.signal.aborted ? '任务已取消' : '任务执行失败，请检查本机会话记录'
    }
    task.updatedAt = new Date().toISOString()
    task.response = boundedResponse(task)
    try { await save(task); } catch { storageFailure = true; }
    active.delete(task.taskId)
  }

  async function start(request) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.taskId || '') || !validText(request.prompt, 64 * 1024) || !request.prompt.trim()) throw new Error('任务 ID 或提示无效')
    const existing = records.get(request.taskId)
    if (existing) {
      if ((existing.requestedProject ?? existing.project) !== request.project || existing.prompt !== request.prompt) throw new Error('任务 ID 已用于不同请求')
      return { task: { ...existing } }
    }
    const project = await admittedProject(config, request.project)
    if (active.size >= 4 || [...active.keys()].some(id => within(records.get(id).project, project) || within(project, records.get(id).project))) throw new Error('项目或主机任务已满')
    const now = new Date().toISOString()
    const task = { taskId: request.taskId, project, prompt: request.prompt, state: 'running', verification: 'not_run', createdAt: now, updatedAt: now, response: '' }
    // Preserve the submitted path for durable idempotency across symlink aliases.
    const stored = { ...task, requestedProject: request.project }
    reserveTaskRecord(stored)
    await save(stored)
    records.set(task.taskId, stored)
    const controller = new AbortController()
    const done = new Promise(resolve => setImmediate(resolve)).then(() => execute(stored, controller))
    active.set(task.taskId, { controller, done })
    return { task: { ...stored } }
  }

  async function dispatch(request) {
    if (closing || storageFailure) throw new Error('任务服务不可用')
    if (!request || request.version !== 1 || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128) throw new Error('任务协议无效')
    if (Buffer.byteLength(JSON.stringify(request)) > 64 * 1024) throw new Error('请求过大')
    if (request.command === 'start') return start(request)
    if (request.command === 'list') {
      const project = request.project === undefined ? undefined : await admittedProject(config, request.project)
      const all = [...records.values()].filter(task => !project || task.project === project).reverse()
      const tasks = all.slice(0, 100).map(({ prompt, response, requestedProject, ...task }) => task)
      return { tasks, truncated: all.length > tasks.length }
    }
    if (!['status', 'cancel'].includes(request.command)) throw new Error('未知任务命令')
    const task = records.get(request.taskId)
    if (!task || (request.project !== undefined && task.project !== request.project && task.requestedProject !== request.project)) throw new Error('未找到任务')
    if (request.command === 'cancel') active.get(task.taskId)?.controller.abort()
    return { task: { ...task } }
  }

  return {
    handle(request) {
      const operation = serial.then(async () => {
        const base = { version: 1, requestId: typeof request?.requestId === 'string' ? request.requestId : '' }
        try { return { ...base, ok: true, ...await dispatch(request) }; }
        catch (error) { return { ...base, ok: false, error: error instanceof Error && !('code' in error) ? error.message : '任务请求失败' }; }
      })
      serial = operation.then(() => {})
      return operation
    },
    async close() {
      closing = true
      await serial
      for (const { controller } of active.values()) controller.abort()
      await Promise.all([...active.values()].map(({ done }) => done))
    },
  }
}
