import { chmod, mkdir, open, readFile, readdir, rename, unlink, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/** @typedef {{roots:string[],stateDir:string,socketPath:string,model?:string}} TaskConfig */
/** @param {string} directory */
export async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}
/** @param {unknown} value */
export function serializeRecord(value) {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized) > RECORD_LIMIT) throw new Error('任务记录过大')
  return serialized
}
/** @param {string} file @param {unknown} value */
export async function atomicRecord(file, value) {
  const serialized = serializeRecord(value)
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(serialized)
    await handle.sync()
  } finally { await handle.close(); }
  try { await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  const directory = await open(join(file, '..'), 'r')
  try { await directory.sync(); } finally { await directory.close(); }
}
/** @param {string} root @param {string} path */
export function within(root, path) {
  const suffix = relative(root, path)
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}
/** @param {TaskConfig} config */
export async function validateConfig(config) {
  if (!config || !Array.isArray(config.roots) || !config.roots.length ||
      ![...config.roots, config.stateDir, config.socketPath].every(path => typeof path === 'string' && isAbsolute(path))) {
    throw new Error('任务配置需要绝对路径和开发根目录')
  }
  const roots = await Promise.all(config.roots.map(root => realpath(root)))
  for (const root of roots) if (!(await stat(root)).isDirectory()) throw new Error('开发根目录不是目录')
  if (config.model !== undefined && (typeof config.model !== 'string' || !/^[^/]+\/.+$/.test(config.model))) throw new Error('模型配置无效')
  return { ...config, roots }
}
/** @param {string} [file] */
export async function loadTaskConfig(file = process.env.ODESK_TASK_CONFIG) {
  if (!file || !isAbsolute(file)) throw new Error('未配置 ODESK_TASK_CONFIG 绝对路径')
  const info = await stat(file)
  if (info.uid !== process.getuid?.() || (info.mode & 0o022)) throw new Error('任务配置必须由当前用户拥有且不可被其他用户写入')
  return validateConfig(JSON.parse(await readFile(file, 'utf8')))
}
/** @param {TaskConfig} config @param {unknown} project */
export async function admittedProject(config, project) {
  if (typeof project !== 'string' || !validProject(project)) throw new Error('项目需要有效的绝对路径')
  const path = await realpath(project)
  if (!(await stat(path)).isDirectory() || within('/opt/open-deskos', path) || !config.roots.some(root => within(root, path))) {
    throw new Error('项目不在允许的开发目录内')
  }
  return path
}
export const RECORD_LIMIT = 80 * 1024
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validText(value, limit) {
  return typeof value === 'string' && Buffer.byteLength(value) <= limit && Buffer.from(value).toString('utf8') === value
}
function validProject(value) {
  return validText(value, 64 * 1024) && isAbsolute(value) && !value.includes('\0')
}
function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function validControlIdentity(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    validText(value.machineName, 256) && !!value.machineName.trim() &&
    validText(value.sessionId, 256) && !!value.sessionId.trim()
}
function validRecord(record, name) {
  return record && typeof record === 'object' && !Array.isArray(record) &&
    typeof record.taskId === 'string' && TASK_ID.test(record.taskId) && name === `${record.taskId}.json` &&
    ['pending', 'running', 'settled', 'interrupted', 'finished', 'failed', 'cancelled'].includes(record.state) &&
    (record.lifecycle === undefined || ['launching', 'live', 'ended', 'interrupted'].includes(record.lifecycle)) &&
    (record.activity === undefined || ['working', 'idle'].includes(record.activity)) &&
    (record.turnOutcome === undefined || ['finished', 'failed', 'cancelled', 'interrupted'].includes(record.turnOutcome)) &&
    (record.currentTurnId === undefined || (typeof record.currentTurnId === 'string' && TASK_ID.test(record.currentTurnId))) &&
    (record.endedReason === undefined || ['explicit', 'idle_expired', 'evicted', 'host_restart'].includes(record.endedReason)) &&
    (record.sessionFile === undefined || (validProject(record.sessionFile) && normalize(record.sessionFile) === record.sessionFile)) &&
    (record.controlledBy === undefined || validControlIdentity(record.controlledBy)) &&
    (record.controlAudit === undefined || (Array.isArray(record.controlAudit) && record.controlAudit.length <= 16 && record.controlAudit.every(item => validControlIdentity(item) && validDate(item.at)))) &&
    (record.mutationReceipts === undefined || (Array.isArray(record.mutationReceipts) && record.mutationReceipts.every(item => item && typeof item === 'object' &&
      ['prompt', 'cancel', 'end'].includes(item.command) && validText(item.mutationId, 256) && !!item.mutationId.trim() && typeof item.digest === 'string' && /^[0-9a-f]{64}$/.test(item.digest) &&
      (item.status === undefined || ['accepted', 'completed', 'failed'].includes(item.status)) && (item.error === undefined || validText(item.error, 512))))) &&
    record.verification === 'not_run' && validProject(record.project) && normalize(record.project) === record.project &&
    (record.requestedProject === undefined || validProject(record.requestedProject)) &&
    validText(record.prompt, 64 * 1024) && !!record.prompt.trim() && validText(record.response, 16 * 1024) &&
    validDate(record.createdAt) && validDate(record.updatedAt) && record.createdAt <= record.updatedAt
}
async function readRecord(file, name) {
  const handle = await open(file, 'r')
  try {
    if (!(await handle.stat()).isFile()) throw new Error('任务记录损坏')
    const bytes = Buffer.alloc(RECORD_LIMIT + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > RECORD_LIMIT) throw new Error('任务记录损坏')
    const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
    if (!validRecord(record, name)) throw new Error('任务记录损坏')
    return record
  } catch {
    throw new Error('任务记录损坏')
  } finally { await handle.close(); }
}
/** @param {string} stateDir */
export async function loadRecords(stateDir) {
  await privateDirectory(stateDir)
  const records = new Map()
  for (const name of await readdir(stateDir)) {
    if (!name.endsWith('.json')) continue
    const record = await readRecord(join(stateDir, name), name)
    records.set(record.taskId, record)
  }
  for (const record of records.values()) {
    // SDK sessions are process-owned. Any non-terminal Hosted Pi from the prior
    // host lifetime is no longer controllable after restart and must never be
    // presented as live or have its prompt replayed.
    if (!['ended', 'interrupted'].includes(record.lifecycle) && (['running', 'pending', 'settled'].includes(record.state) || ['launching', 'live'].includes(record.lifecycle))) {
      // A session idle at its prompt keeps the outcome of the turn that already finished; only
      // work that was actually in flight becomes an interrupted turn. The lifecycle changes either
      // way, because the SDK session is process-owned and is no longer controllable.
      const wasMidTurn = record.state === 'running' || record.activity === 'working'
      record.state = 'interrupted'
      record.lifecycle = 'interrupted'
      record.activity = undefined
      if (wasMidTurn) record.turnOutcome = 'interrupted'
      record.currentTurnId = undefined
      record.controlledBy = undefined
      record.endedReason = 'host_restart'
      if (record.response === undefined) record.response = '任务执行被主机重启中断，请检查本机会话记录'
      record.updatedAt = new Date().toISOString()
      await atomicRecord(join(stateDir, `${record.taskId}.json`), record)
    }
  }
  return records
}
