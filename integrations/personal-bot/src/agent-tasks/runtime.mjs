import { lstatSync, realpathSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { checkProactivePath, createProactiveDirectory, readProactiveFile, openProactiveTemporary } from '../proactive-private.mjs'

const LIMIT = 4 * 1024 * 1024
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const TASK = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const REVISION = /^[a-f0-9]{64}$/
export const AGENT_AVATARS = Object.freeze(['agent', 'book', 'code', 'compass', 'spark'])
const ACTIVE = new Set(['starting', 'running', 'cancelling'])
const STATES = [...ACTIVE, 'finished', 'failed', 'cancelled', 'interrupted']
const VERIFICATION = ['not_run', 'passed', 'needs_review']
const LEARNING = ['skipped', 'disabled', 'applied', 'needs_review']
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const text = (value, limit, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0)
  && Buffer.byteLength(value) <= limit && Buffer.from(value).toString('utf8') === value && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const pendingVerification = () => ({ status: 'needs_review', summary: 'Execution did not establish verified completion.' })
const now = () => new Date().toISOString()

function validateIdentity(value, stored = false) {
  if (!object(value, ['id', 'name', 'role', 'avatar', ...(stored ? ['revision'] : ['expectedRevision'])])
    || !text(value.id, 64) || !ID.test(value.id) || !text(value.name, 120) || /[\x00-\x1f]/.test(value.name)
    || !text(value.role, 4096) || !AGENT_AVATARS.includes(value.avatar)
    || (value.expectedRevision !== undefined && !REVISION.test(value.expectedRevision))) throw Error('Invalid saved agent identity')
  const definition = { id: value.id, name: value.name, role: value.role, avatar: value.avatar }
  if (stored && value.revision !== revision(definition)) throw Error('Invalid saved agent revision')
  return { ...definition, revision: revision(definition) }
}

function validateState(state) {
  if (!object(state, ['version', 'identities', 'tasks']) || state.version !== 1 || !Array.isArray(state.identities) || state.identities.length > 64
    || !Array.isArray(state.tasks) || state.tasks.length > 128) throw Error('Invalid private agent task state')
  for (const identity of state.identities) validateIdentity(identity, true)
  if (new Set(state.identities.map(item => item.id)).size !== state.identities.length) throw Error('Duplicate saved agent identity')
  for (const task of state.tasks) {
    if (!object(task, ['taskId', 'identity', 'role', 'request', 'state', 'response', 'verification', 'learning', 'createdAt', 'updatedAt', 'turn'])
      || !TASK.test(task.taskId) || !STATES.includes(task.state) || !text(task.role, 4096, true) || !text(task.request, 8192)
      || !text(task.response, 16384, true) || !Number.isSafeInteger(task.turn) || task.turn < 1
      || !Number.isFinite(Date.parse(task.createdAt)) || !Number.isFinite(Date.parse(task.updatedAt))
      || !object(task.verification, ['status', 'summary']) || !VERIFICATION.includes(task.verification.status) || !text(task.verification.summary, 1024)
      || !LEARNING.includes(task.learning)
      || (task.identity !== null && (!object(task.identity, ['id', 'name', 'avatar', 'revision']) || !text(task.identity.id, 64) || !ID.test(task.identity.id)
        || !text(task.identity.name, 120) || /[\x00-\x1f]/.test(task.identity.name) || !AGENT_AVATARS.includes(task.identity.avatar) || !REVISION.test(task.identity.revision)))) throw Error('Invalid private agent task record')
  }
  if (new Set(state.tasks.map(item => item.taskId)).size !== state.tasks.length) throw Error('Duplicate agent task handle')
  return state
}

function privateDirectory(directory) {
  createProactiveDirectory(directory)
  const info = lstatSync(directory)
  if (!info.isDirectory() || realpathSync(directory) !== directory || (process.platform !== 'win32'
    && (info.uid !== process.getuid?.() || info.mode & 0o077))) throw Error('Agent task storage is unavailable or unsafe')
  checkProactivePath(directory)
}

function atomicState(directory, state) {
  const serialized = JSON.stringify(validateState(state))
  if (Buffer.byteLength(serialized) > LIMIT) throw Error('Agent task storage capacity reached')
  privateDirectory(directory)
  const temporary = join(directory, `.tasks-${randomUUID()}.tmp`)
  try {
    const fd = openProactiveTemporary(temporary)
    try { writeFileSync(fd, serialized); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, join(directory, 'state.json'))
  } finally { try { unlinkSync(temporary) } catch {} }
}

/** @typedef {{prompt: (text: string) => Promise<string>, abort: () => Promise<unknown>, close: () => Promise<unknown>, lastTaskResult?: {verification: {status: string, summary: string}, learning: {status: string}}}} Worker */
/** One process owns child lifecycle. Saved identities retain separate homes; temporary children have task-specific homes.
 * @param {{directory: string, createWorker: (spec: {taskId: string, home: string, request: string, role: string, identity: object|null, signal: AbortSignal}) => Promise<Worker>, onUpdate?: (tasks: object[]) => void}} options
 */
export async function openAgentTasks({ directory, createWorker, onUpdate }) {
  if (!isAbsolute(directory) || typeof createWorker !== 'function') throw Error('Invalid agent task runtime configuration')
  privateDirectory(directory)
  let release
  try { release = await lockfile.lock(join(directory, 'owner'), { realpath: false, stale: 30000, retries: 0 }) }
  catch { throw Error('Agent task storage is owned by another runtime or unavailable') }
  let state
  try {
    try { lstatSync(join(directory, 'state.json')); state = validateState(JSON.parse(readProactiveFile(join(directory, 'state.json'), LIMIT))) }
    catch (error) { if (error.code !== 'ENOENT') throw Error('Agent task records are unavailable or unsafe'); state = { version: 1, identities: [], tasks: [] } }
    state = { ...state, tasks: state.tasks.map(task => ACTIVE.has(task.state)
      ? { ...task, state: 'interrupted', verification: pendingVerification(), learning: 'skipped', updatedAt: now() } : task) }
    atomicState(directory, state)
  } catch (error) { await release(); throw error }
  const running = new Map()
  let closed = false, closing, storageFailed = false
  const copy = value => structuredClone(value)
  const active = () => state.tasks.filter(task => ACTIVE.has(task.state)).map(task => ({ taskId: task.taskId, identity: copy(task.identity), state: task.state, updatedAt: task.updatedAt }))
  const publish = () => { try { onUpdate?.(active()) } catch { /* Observers do not own task execution. */ } }
  function available() { if (closed || storageFailed) throw Error('Agent task runtime is closed or storage is unavailable') }
  function commit(next) {
    try { atomicState(directory, next); state = next }
    catch (error) { storageFailed = true; throw error }
    publish()
  }
  function get(taskId) {
    const task = typeof taskId === 'string' && TASK.test(taskId) ? state.tasks.find(task => task.taskId === taskId) : undefined
    if (!task) throw Error('Agent task handle is unavailable')
    return task
  }
  function update(taskId, changes) {
    const next = { ...state, tasks: state.tasks.map(task => task.taskId === taskId ? { ...task, ...changes, updatedAt: now() } : task) }
    commit(next)
    return get(taskId)
  }
  function abort(owner) {
    if (owner.controller.signal.aborted) return
    owner.controller.abort()
    if (owner.worker) void Promise.resolve().then(() => owner.worker.abort()).catch(() => {})
  }
  function launch(task) {
    const owner = { controller: new AbortController(), worker: undefined, done: undefined }
    running.set(task.taskId, owner)
    owner.done = Promise.resolve().then(async () => {
      let response = '', outcome = 'failed', verification = pendingVerification(), learning = 'skipped'
      try {
        if (closed || get(task.taskId).state === 'cancelling') abort(owner)
        owner.controller.signal.throwIfAborted()
        const home = join(directory, 'homes', task.identity ? 'saved' : 'temporary', task.identity?.id ?? task.taskId)
        privateDirectory(home)
        owner.worker = await createWorker({ taskId: task.taskId, home, request: task.request, role: task.role, identity: copy(task.identity), signal: owner.controller.signal })
        owner.controller.signal.throwIfAborted()
        update(task.taskId, { state: 'running' })
        response = await owner.worker.prompt(task.request)
        owner.controller.signal.throwIfAborted()
        if (!text(response, 16384)) throw Error('Agent response is empty or exceeds its limit')
        const result = owner.worker.lastTaskResult
        verification = result && VERIFICATION.includes(result.verification?.status) && text(result.verification.summary, 1024)
          ? { status: result.verification.status, summary: result.verification.summary }
          : { status: 'not_run', summary: 'The child did not run completion verification.' }
        const observedLearning = result?.learning?.status ?? 'skipped'
        learning = LEARNING.includes(observedLearning) ? observedLearning : 'needs_review'
        outcome = 'finished'
      } catch {
        outcome = owner.controller.signal.aborted ? 'cancelled' : 'failed'
        response = ''
        verification = pendingVerification()
        learning = 'skipped'
      } finally {
        try { await owner.worker?.close() } catch { outcome = 'failed'; verification = pendingVerification() }
        if (owner.controller.signal.aborted) { outcome = 'cancelled'; response = ''; verification = pendingVerification(); learning = 'skipped' }
        try { update(task.taskId, { state: outcome, response, verification, learning }) }
        catch { state = { ...state, tasks: state.tasks.map(item => item.taskId === task.taskId ? { ...item, state: 'interrupted', response: '', verification: pendingVerification(), learning: 'skipped' } : item) }; publish() }
        running.delete(task.taskId)
      }
      return copy(get(task.taskId))
    })
    // The task result is queried through exact handles; no unhandled background rejection is permitted.
    void owner.done.catch(() => {})
  }
  function admit(task) {
    if (state.tasks.filter(item => ACTIVE.has(item.state)).length >= 4) throw Error('Agent task concurrency capacity reached')
    if (task.identity && state.tasks.some(item => item.identity?.id === task.identity.id && ACTIVE.has(item.state))) throw Error('Saved agent already has an active task')
    commit({ ...state, tasks: [...state.tasks, task] })
    launch(task)
    return copy(task)
  }
  return {
    identities: () => copy(state.identities),
    saveIdentity(value) {
      available()
      const selected = validateIdentity(value)
      const previous = state.identities.find(item => item.id === selected.id)
      if (previous ? value.expectedRevision !== previous.revision : value.expectedRevision !== undefined) throw Error('Saved agent revision does not match')
      if (!previous && state.identities.length === 64) throw Error('Saved agent capacity reached')
      commit({ ...state, identities: [...state.identities.filter(item => item.id !== selected.id), selected] })
      return copy(selected)
    },
    start(value) {
      available()
      if (!object(value, ['request', 'identityId', 'role']) || !text(value.request, 8192) || (value.role !== undefined && !text(value.role, 4096))
        || (value.identityId !== undefined && (!text(value.identityId, 64) || !ID.test(value.identityId) || value.role !== undefined))) throw Error('Invalid agent task identity, role or request')
      if (state.tasks.length === 128) throw Error('Agent task record capacity reached')
      const saved = value.identityId ? state.identities.find(item => item.id === value.identityId) : undefined
      if (value.identityId && !saved) throw Error('Saved agent identity is unavailable')
      const identity = saved ? { id: saved.id, name: saved.name, avatar: saved.avatar, revision: saved.revision } : null
      const task = { taskId: randomUUID(), identity, request: value.request, role: saved?.role ?? value.role ?? '', state: 'starting', response: '',
        verification: pendingVerification(), learning: 'skipped', createdAt: now(), updatedAt: now(), turn: 1 }
      return admit(task)
    },
    input(taskId, request) {
      available()
      const task = get(taskId)
      if (!text(request, 8192)) throw Error('Invalid agent task request')
      if (ACTIVE.has(task.state) || running.has(taskId)) throw Error('Agent task is already active; cancel or wait for its current turn')
      if (state.tasks.filter(item => ACTIVE.has(item.state)).length >= 4) throw Error('Agent task concurrency capacity reached')
      if (task.identity && state.tasks.some(item => item.identity?.id === task.identity.id && ACTIVE.has(item.state))) throw Error('Saved agent already has an active task')
      const next = update(taskId, { request, turn: task.turn + 1, state: 'starting', response: '', verification: pendingVerification(), learning: 'skipped' })
      launch(next)
      return copy(next)
    },
    status: taskId => copy(get(taskId)),
    list: ({ offset = 0, limit = 16 } = {}) => {
      if (!Number.isInteger(offset) || offset < 0 || offset > 128 || !Number.isInteger(limit) || limit < 1 || limit > 32) throw Error('Invalid agent task page')
      return { tasks: copy([...state.tasks].reverse().slice(offset, offset + limit).map(({ request: _request, role: _role, response: _response, ...metadata }) => metadata)), total: state.tasks.length }
    },
    activity: active,
    cancel(taskId) {
      available()
      const task = get(taskId)
      if (!ACTIVE.has(task.state)) return copy(task)
      const owner = running.get(taskId)
      const next = update(taskId, { state: 'cancelling', verification: pendingVerification(), learning: 'skipped' })
      if (owner) abort(owner)
      return copy(next)
    },
    async wait(taskId) { await running.get(taskId)?.done; return copy(get(taskId)) },
    close() {
      if (!closing) {
        closed = true
        for (const owner of running.values()) abort(owner)
        closing = (async () => { try { await Promise.allSettled([...running.values()].map(owner => owner.done)) } finally { await release() } })()
      }
      return closing
    },
  }
}
