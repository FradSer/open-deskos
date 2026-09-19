import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { admittedProject, atomicRecord, loadRecords, privateDirectory, RECORD_LIMIT, serializeRecord, validText, validateConfig, within } from './task-store.mjs'

export const TASK_TEXT_LIMIT = 16 * 1024
const INCOMPLETE_RESPONSE = '任务执行未正常完成，请检查本机会话记录'
const HOST_CAP = 4
const DEFAULT_IDLE_MS = 30 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MUTATION_ID_BYTES = 256

/** @param {Task} task */
export function reserveTaskRecord(task) {
  serializeRecord({ ...task, state: 'interrupted', lifecycle: 'interrupted', response: INCOMPLETE_RESPONSE })
}
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
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}
/** @typedef {{taskId:string,project:string,prompt:string,state:string,lifecycle?:string,activity?:string,turnOutcome?:string,verification:string,createdAt:string,updatedAt:string,response:string,sessionFile?:string,controlledBy?:{machineName:string,sessionId:string},controlAudit?:Array<{machineName:string,sessionId:string,at:string}>,mutationReceipts?:Array<{command:string,mutationId:string,digest:string}>,currentTurnId?:string,endedReason?:string}} Task */
/** @typedef {{task:Task,signal:AbortSignal,sessionDir:string,model?:string,onEvent?:(event:object)=>void}} TaskInput */

function validConsole(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    validText(value.machineName, 256) && !!value.machineName.trim() &&
    validText(value.sessionId, 256) && !!value.sessionId.trim()
}
function validMutationId(value) {
  return value === undefined || (validText(value, MUTATION_ID_BYTES) && !!value.trim())
}
function canonicalMutation(request) {
  const payload = { command: request.command, taskId: request.taskId }
  for (const key of ['project', 'prompt', 'streamingBehavior', 'expectedTurnId']) if (request[key] !== undefined) payload[key] = request[key]
  return JSON.stringify(payload)
}
function mutationDigest(payload) {
  return createHash('sha256').update(payload).digest('hex')
}

/** @param {import('./task-store.mjs').TaskConfig & {idleMs?:number}} input
 * @param {{createSession?:(input:TaskInput)=>Promise<object>,runTask?:(input:TaskInput)=>Promise<{text:string,stopReason?:string}>,readHistory?:(sessionFile:string,position?:number,limit?:number)=>object}} adapter */
export async function createTaskService(input, adapter) {
  const config = await validateConfig(input)
  const records = await loadRecords(config.stateDir)
  const idleMs = Number.isSafeInteger(input.idleMs) && input.idleMs >= 0 ? input.idleMs : DEFAULT_IDLE_MS
  /** @type {Map<string,{hosted:any,controller:AbortController,turn?:Promise<void>,attached?:{connectionId:string,attachmentId?:string,send?:(event:object)=>void,liveAfter?:number},idleTimer?:NodeJS.Timeout,persistent:boolean}>} */
  const live = new Map()
  const mutations = new Map()
  const mutationRoot = join(config.stateDir, 'mutations')
  await privateDirectory(mutationRoot)
  for (const task of records.values()) {
    for (const receipt of task.mutationReceipts ?? []) mutations.set(`${task.taskId}:${receipt.command}:${receipt.mutationId}`, {
      taskId: task.taskId, command: receipt.command, mutationId: receipt.mutationId,
      payloadDigest: receipt.digest, status: receipt.status ?? 'completed', ...(receipt.error ? { error: receipt.error } : {}),
    })
    const directory = join(mutationRoot, task.taskId)
    let names = []
    try { names = await readdir(directory) } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const name of names) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) throw new Error('Mutation receipt store corrupted')
      const receipt = JSON.parse(await readFile(join(directory, name), 'utf8'))
      if (!receipt || receipt.taskId !== task.taskId || !['prompt', 'cancel', 'end'].includes(receipt.command) || !validMutationId(receipt.mutationId) || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest) || !['accepted', 'completed', 'failed'].includes(receipt.status)) throw new Error('Mutation receipt store corrupted')
      mutations.set(`${receipt.taskId}:${receipt.command}:${receipt.mutationId}`, receipt)
    }
  }
  let serial = Promise.resolve()
  let closing = false
  let storageFailure = false
  const save = task => atomicRecord(join(config.stateDir, `${task.taskId}.json`), task)
  const mutationFile = receipt => join(mutationRoot, receipt.taskId, `${createHash('sha256').update(`${receipt.taskId}\0${receipt.command}\0${receipt.mutationId}`).digest('hex')}.json`)
  const saveMutation = async receipt => {
    await privateDirectory(join(mutationRoot, receipt.taskId))
    await atomicRecord(mutationFile(receipt), receipt)
  }
  const enqueue = operation => {
    const result = serial.then(operation)
    serial = result.then(() => {}, () => {})
    return result
  }
  const publicTask = task => JSON.parse(JSON.stringify(task))
  const overlaps = project => [...live.entries()].some(([id, value]) => {
    const task = records.get(id)
    return ['launching', 'live'].includes(task?.lifecycle) && (task.lifecycle === 'launching' || task.activity === 'working' || value.attached) && (within(task.project, project) || within(project, task.project))
  })
  const liveCount = () => [...live.keys()].filter(id => records.get(id)?.lifecycle === 'live' || records.get(id)?.lifecycle === 'launching').length

  async function persist(task) {
    task.updatedAt = new Date().toISOString()
    task.response = boundedResponse(task)
    try { await save(task) } catch (error) { storageFailure = true; throw error }
  }

  function clearIdle(entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  function scheduleIdle(task, entry) {
    clearIdle(entry)
    if (entry.attached || task.lifecycle !== 'live' || task.activity !== 'idle') return
    entry.idleTimer = setTimeout(() => {
      enqueue(async () => {
        if (entry.attached || task.lifecycle !== 'live' || task.activity !== 'idle') return
        entry.hosted.dispose()
        task.lifecycle = 'ended'
        task.activity = undefined
        task.state = task.turnOutcome === 'cancelled' ? 'cancelled' : task.turnOutcome === 'failed' ? 'failed' : 'finished'
        task.endedReason = 'idle_expired'
        await persist(task)
        live.delete(task.taskId)
      }).catch(() => { storageFailure = true })
    }, idleMs)
    entry.idleTimer.unref?.()
  }

  function publish(task, event) {
    const attached = live.get(task.taskId)?.attached
    if (!attached?.send) return
    if (Number.isSafeInteger(event?.position) && event.position <= (attached.liveAfter ?? 0)) return
    try { attached.send({ version: 1, type: 'event', taskId: task.taskId, ...event }) } catch { /* socket backpressure/closure owns cleanup */ }
  }

  async function finishTurn(task, entry, result, failure = false) {
    if (task.lifecycle !== 'live') return
    const cancelled = entry.controller.signal.aborted || result?.stopReason === 'aborted'
    task.response = boundedText(result?.text || '')
    if (entry.hosted.sessionFile !== undefined) task.sessionFile = entry.hosted.sessionFile
    task.turnOutcome = cancelled ? 'cancelled' : !failure && result?.stopReason === 'stop' ? 'finished' : 'failed'
    task.currentTurnId = undefined
    if (task.turnOutcome !== 'finished' && !task.response.trim()) task.response = task.turnOutcome === 'cancelled' ? '任务已取消' : INCOMPLETE_RESPONSE
    if (entry.persistent) {
      task.activity = 'idle'
      task.state = 'settled'
    } else {
      task.lifecycle = 'ended'
      task.activity = undefined
      task.state = task.turnOutcome
    }
    await persist(task)
    publish(task, { type: 'state', state: task.state, lifecycle: task.lifecycle, activity: task.activity, turnOutcome: task.turnOutcome, response: task.response })
    entry.turn = undefined
    if (entry.persistent) scheduleIdle(task, entry)
    else { entry.hosted.dispose(); live.delete(task.taskId) }
  }

  function beginTurn(task, entry, prompt) {
    clearIdle(entry)
    entry.controller = new AbortController()
    task.lifecycle = 'live'
    task.activity = 'working'
    task.state = 'running'
    task.turnOutcome = undefined
    task.currentTurnId = randomUUID()
    task.response = ''
    const turn = Promise.resolve().then(() => entry.hosted.prompt(prompt))
      .then(result => enqueue(() => finishTurn(task, entry, result)), () => enqueue(() => finishTurn(task, entry, undefined, true)))
      .catch(() => { storageFailure = true })
    entry.turn = turn
  }

  async function createHosted(task, entry) {
    try {
      if (adapter.createSession) {
        entry.hosted = await adapter.createSession({
          task: { ...task },
          signal: entry.controller.signal,
          sessionDir: join(config.stateDir, 'sessions', task.taskId),
          model: config.model,
          onEvent: event => enqueue(() => { publish(task, event) }),
        })
      } else {
        entry.hosted = {
          isStreaming: false,
          async prompt(prompt) { return adapter.runTask({ task: { ...task, prompt }, signal: entry.controller.signal, sessionDir: join(config.stateDir, 'sessions', task.taskId), model: config.model }) },
          async deliver() { throw new Error('Hosted Pi 不支持流式提示') },
          async abort() { entry.controller.abort() },
          dispose() {},
          boundary() { return 0 },
          history() { return { events: [], entries: [], boundary: 0, continuation: null } },
        }
      }
      await enqueue(async () => {
        if (closing || task.lifecycle !== 'launching') { entry.hosted.dispose(); return }
        if (entry.hosted.sessionFile !== undefined) task.sessionFile = entry.hosted.sessionFile
        task.lifecycle = 'live'
        await persist(task)
        beginTurn(task, entry, task.prompt)
      })
    } catch {
      await enqueue(async () => {
        live.delete(task.taskId)
        task.state = 'failed'; task.lifecycle = 'ended'; task.activity = undefined; task.turnOutcome = 'failed'; task.response = '任务执行失败，请检查本机会话记录'
        await persist(task).catch(() => {})
      })
    }
  }

  async function start(request) {
    if (!UUID.test(request.taskId || '') || !validText(request.prompt, 64 * 1024) || !request.prompt.trim() || !validMutationId(request.mutationId)) throw new Error('任务 ID 或提示无效')
    const existing = records.get(request.taskId)
    if (existing) {
      if ((existing.requestedProject ?? existing.project) !== request.project || existing.prompt !== request.prompt) throw new Error('任务 ID 已用于不同请求')
      return { task: publicTask(existing) }
    }
    const project = await admittedProject(config, request.project)
    if (liveCount() >= HOST_CAP || overlaps(project)) throw new Error('项目或主机任务已满')
    const now = new Date().toISOString()
    if (request.console !== undefined && !validConsole(request.console)) throw new Error('Console identity 无效')
    /** @type {Task & {requestedProject:string}} */
    const stored = { taskId: request.taskId, project, prompt: request.prompt, state: 'running', lifecycle: 'launching', activity: undefined, verification: 'not_run', createdAt: now, updatedAt: now, response: '', requestedProject: request.project }
    if (request.console) stored.controlAudit = [{ ...request.console, at: now }]
    reserveTaskRecord(stored)
    await save(stored)
    records.set(stored.taskId, stored)
    const entry = { hosted: undefined, controller: new AbortController(), turn: undefined, attached: undefined, idleTimer: undefined, persistent: !!adapter.createSession }
    live.set(stored.taskId, entry)
    setImmediate(() => createHosted(stored, entry))
    return { task: publicTask(stored) }
  }

  function findTask(request) {
    const task = records.get(request.taskId)
    if (!task || (request.project !== undefined && task.project !== request.project && task.requestedProject !== request.project)) throw new Error('未找到任务')
    return task
  }

  async function prompt(request) {
    const task = findTask(request)
    const entry = live.get(task.taskId)
    if (!entry || task.lifecycle !== 'live') throw new Error('Hosted Pi 已结束')
    if (!validText(request.prompt, 64 * 1024) || !request.prompt.trim()) throw new Error('任务 ID 或提示无效')
    if (task.activity === 'working' || entry.hosted.isStreaming) {
      if (!['steer', 'followUp'].includes(request.streamingBehavior)) throw new Error('流式提示需要 delivery behavior')
      if (entry.hosted.deliver) await entry.hosted.deliver(request.prompt, request.streamingBehavior)
      else await entry.hosted.prompt(request.prompt, { streamingBehavior: request.streamingBehavior })
      return { task: publicTask(task), accepted: true }
    }
    beginTurn(task, entry, request.prompt)
    await persist(task)
    return { task: publicTask(task), accepted: true }
  }

  async function cancel(request) {
    const task = findTask(request)
    const entry = live.get(task.taskId)
    if (request.expectedTurnId !== undefined && request.expectedTurnId !== task.currentTurnId) throw new Error('Turn identity 已变化')
    if (entry?.turn && task.activity === 'working') {
      entry.controller.abort()
      await entry.hosted.abort()
    }
    return { task: publicTask(task), accepted: true }
  }

  async function end(request) {
    const task = findTask(request)
    const entry = live.get(task.taskId)
    if (entry) {
      clearIdle(entry)
      if (entry.turn) { entry.controller.abort(); await entry.hosted.abort() }
      entry.hosted.dispose()
      live.delete(task.taskId)
    }
    task.lifecycle = 'ended'
    task.activity = undefined
    task.endedReason = 'explicit'
    if (task.state === 'settled') task.state = task.turnOutcome === 'cancelled' ? 'cancelled' : task.turnOutcome === 'failed' ? 'failed' : 'finished'
    await persist(task)
    return { task: publicTask(task), accepted: true }
  }

  async function attach(request, context) {
    const task = findTask(request)
    const entry = live.get(task.taskId)
    if (!entry || task.lifecycle !== 'live') throw new Error('Hosted Pi 已结束')
    if (!validConsole(request.console) || !context?.connectionId) throw new Error('Console identity 无效')
    const after = request.after ?? request.position
    if (after !== undefined && after !== null && (!Number.isSafeInteger(after) || after < 0)) throw new Error('History position 无效')
    if (request.attachmentId !== undefined && (!validText(request.attachmentId, 256) || !request.attachmentId.trim())) throw new Error('Attachment identity 无效')
    const previous = entry.attached
    const previousControlledBy = task.controlledBy
    const previousAudit = task.controlAudit
    task.controlledBy = request.console
    const audit = task.controlAudit ?? []
    if (!audit.some(item => item.machineName === request.console.machineName && item.sessionId === request.console.sessionId)) audit.push({ ...request.console, at: new Date().toISOString() })
    task.controlAudit = audit.slice(-16)
    try {
      // Persist attribution before granting the new connection authority. A
      // failed receipt leaves the previous Console in control.
      await persist(task)
    } catch (error) {
      task.controlledBy = previousControlledBy
      task.controlAudit = previousAudit
      throw error
    }
    if (previous && previous.connectionId !== context.connectionId) previous.send?.({ version: 1, type: 'replaced', taskId: task.taskId })
    // All SDK events enter this same serial queue. Installing the attachment before
    // sampling the boundary makes the catch-up fence atomic with later publishes.
    entry.attached = { connectionId: context.connectionId, attachmentId: request.attachmentId, send: context.send, liveAfter: Number.MAX_SAFE_INTEGER }
    const boundary = entry.hosted.boundary?.() ?? entry.hosted.history(0, 1).boundary
    entry.attached.liveAfter = boundary
    clearIdle(entry)
    if (after !== undefined && after !== null) {
      let position = after
      while (position < boundary) {
        const page = entry.hosted.history(position, request.limit ?? 100)
        const batches = page.events ?? page.entries ?? []
        for (const batch of batches) context.send({ version: 1, type: 'event', taskId: task.taskId, ...batch })
        const next = page.continuation
        const appliedThrough = batches.length > 0 ? batches.at(-1).position : position
        // A page may contain only non-message physical entries. Null
        // continuation then means the reader scanned through its boundary.
        const candidate = Number.isSafeInteger(next) ? next : Number.isSafeInteger(page.boundary) ? Math.min(page.boundary, boundary) : appliedThrough
        if (!Number.isSafeInteger(candidate) || candidate <= position) break
        position = candidate
      }
      if (position < boundary) throw new Error('Hosted Pi history catch-up incomplete')
    }
    return { task: publicTask(task), attachmentId: request.attachmentId, boundary, history: { events: [], entries: [], boundary, continuation: null }, caughtUp: true }
  }

  async function history(request) {
    const task = findTask(request)
    const position = request.after ?? request.position ?? 0
    const limit = request.limit ?? 64
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('History position 无效')
    const entry = live.get(task.taskId)
    const value = entry ? entry.hosted.history(position, limit) : adapter.readHistory?.(task.sessionFile, position, limit) ?? { events: [], entries: [], boundary: 0, continuation: null }
    return { task: publicTask(task), history: value }
  }

  async function mutation(request, operation) {
    if (!validMutationId(request.mutationId)) throw new Error('Mutation identity 无效')
    if (request.mutationId === undefined) return operation()
    const key = `${request.taskId}:${request.command}:${request.mutationId}`
    const payloadDigest = mutationDigest(canonicalMutation(request))
    const existing = mutations.get(key)
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) throw new Error('Mutation identity 已用于不同请求')
      if (existing.status === 'failed') throw new Error(existing.error || 'Mutation failed')
      return { task: publicTask(findTask(request)), accepted: true, duplicate: true, pending: existing.status === 'accepted' }
    }
    const task = findTask(request)
    // Validate the requested transition before writing an accepted receipt.
    if (request.command === 'prompt') {
      const entry = live.get(task.taskId)
      if (!entry || task.lifecycle !== 'live' || !validText(request.prompt, 64 * 1024) || !request.prompt.trim()) throw new Error('Hosted Pi prompt 无效')
      if ((task.activity === 'working' || entry.hosted.isStreaming) && !['steer', 'followUp'].includes(request.streamingBehavior)) throw new Error('流式提示需要 delivery behavior')
    } else if (request.command === 'cancel' && request.expectedTurnId !== undefined && request.expectedTurnId !== task.currentTurnId) {
      throw new Error('Turn identity 已变化')
    }
    const receipt = { taskId: request.taskId, command: request.command, mutationId: request.mutationId, payloadDigest, status: 'accepted' }
    // The receipt is the no-replay boundary: no prompt, abort, or disposal may
    // begin until the accepted mutation identity is durable. Receipts live in
    // separate files so a long session cannot overflow its task record.
    await saveMutation(receipt)
    mutations.set(key, receipt)
    try {
      const result = await operation()
      receipt.status = 'completed'
      await saveMutation(receipt)
      mutations.set(key, receipt)
      return result
    } catch (error) {
      receipt.status = 'failed'
      receipt.error = error instanceof Error ? error.message : 'Mutation failed'
      await saveMutation(receipt).catch(() => {})
      mutations.set(key, receipt)
      throw error
    }
  }

  async function dispatch(request, context) {
    if (closing || storageFailure) throw new Error('任务服务不可用')
    if (!request || request.version !== 1 || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128) throw new Error('任务协议无效')
    if (Buffer.byteLength(JSON.stringify(request)) > 64 * 1024) throw new Error('请求过大')
    if (['start', 'launch'].includes(request.command)) return start(request)
    if (request.command === 'list') {
      const project = request.project === undefined ? undefined : await admittedProject(config, request.project)
      const all = [...records.values()].filter(task => !project || task.project === project).reverse()
      const tasks = all.slice(0, 100).map(({ prompt, response, requestedProject, sessionFile, controlAudit, ...task }) => task)
      return { tasks, truncated: all.length > tasks.length }
    }
    if (request.command === 'status') return { task: publicTask(findTask(request)) }
    if (request.command === 'prompt') return mutation(request, () => prompt(request))
    if (request.command === 'cancel') return mutation(request, () => cancel(request))
    if (request.command === 'end') return mutation(request, () => end(request))
    if (request.command === 'attach') return attach(request, context)
    if (request.command === 'history') return history(request)
    throw new Error('未知任务命令')
  }

  return {
    handle(request, context = undefined) {
      return enqueue(async () => {
        const base = { version: 1, requestId: typeof request?.requestId === 'string' ? request.requestId : '' }
        try { return { ...base, ok: true, ...await dispatch(request, context) } }
        catch (error) { return { ...base, ok: false, error: error instanceof Error && !('code' in error) ? error.message : '任务请求失败' } }
      })
    },
    disconnect(connectionId) {
      return enqueue(async () => {
        for (const [id, entry] of live) {
          if (entry.attached?.connectionId !== connectionId) continue
          entry.attached = undefined
          const task = records.get(id)
          task.controlledBy = undefined
          await persist(task)
          scheduleIdle(task, entry)
        }
      })
    },
    async close() {
      closing = true
      await serial
      for (const entry of live.values()) {
        clearIdle(entry)
        if (entry.turn) { entry.controller.abort(); await entry.hosted?.abort().catch(() => {}) }
      }
      await Promise.all([...live.values()].map(entry => entry.turn).filter(Boolean))
      for (const entry of live.values()) entry.hosted?.dispose()
      live.clear()
      await serial
    },
  }
}
