import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cleanPath = value => typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)
const developmentPath = value => cleanPath(value) && normalize(value) !== '/opt/open-deskos' && !normalize(value).startsWith('/opt/open-deskos/')
const keysOnly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))

export function taskCommand(executable, host) {
  if (!cleanPath(executable)) throw Error('Invalid task executable: must be absolute without control characters')
  if (host === undefined) return { executable, args: [] }
  if (typeof host !== 'string' || !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('Invalid SSH host')
  const quoted = `'${executable.replaceAll("'", "'\\''")}'`
  return { executable: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '--', host, quoted] }
}

export async function loadTargets(path = process.env.ODESK_TASK_TARGETS_FILE) {
  if (!path) return []
  if (!cleanPath(path)) throw Error('Invalid task targets configuration path')
  const config = JSON.parse(await readFile(path, 'utf8'))
  if (!keysOnly(config, ['targets']) || !Array.isArray(config.targets)) throw Error('Invalid task targets configuration')
  const ids = new Set()
  for (const target of config.targets) {
    if (!keysOnly(target, ['id', 'name', 'host', 'executable', 'roots']) || !['cm5', 'mac'].includes(target.id)
      || typeof target.name !== 'string' || !target.name.trim() || !Array.isArray(target.roots) || !target.roots.length
      || !target.roots.every(developmentPath) || new Set(target.roots).size !== target.roots.length) throw Error('Invalid task target configuration')
    taskCommand(target.executable, target.host)
    if (ids.has(target.id)) throw Error('Duplicate task target ID')
    ids.add(target.id)
  }
  return config.targets
}

// Admissibility belongs to the host, which owns the configured roots and is the only side that can
// resolve them on disk. The coordinator refuses only what it cannot put on the wire — a project that
// is not an absolute normalized path, or one carrying control characters. Repeating the root policy
// here is what once refused a project the daemon had itself just reported, whenever a configured
// root was a symlink, so the request now travels and the daemon's own refusal is the answer.
const submittedProject = value => cleanPath(value) && normalize(value) === value

/**
 * A remote target's project is a path on that host, so it is judged as that host writes
 * it: an absolute POSIX path without control characters or a parent segment.
 * Normalizing one with this host's rules is what a Windows Shell Host did to every
 * project it was asked to carry — it rewrote each separator and prefixed a root — so a
 * desk that can reach a target over SSH refused work it was configured to do.
 */
const remoteProject = value => typeof value === 'string' && value.startsWith('/') && !/[\x00-\x1f\x7f]/.test(value) && !value.split('/').includes('..')

/**
 * Whether this desk can put a project on the wire for that target at all. A remote
 * target is judged by its host's rules, a local one by this host's.
 * @param {unknown} value
 * @param {boolean} [remote]
 */
export function carriedProject(value, remote = false) {
  return remote ? remoteProject(value) : submittedProject(value)
}

function validateRequest(request, remote = false) {
  if (!['start', 'launch', 'status', 'list', 'prompt', 'cancel', 'end', 'history'].includes(request.command)) throw Error('Invalid task command')
  if (!carriedProject(request.project, remote)) throw Error('Invalid project: send an absolute normalized project path without control characters')
  if (['start', 'launch', 'prompt'].includes(request.command) && (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 16_384)) throw Error('Invalid task prompt')
  if (request.command === 'prompt' && request.streamingBehavior !== undefined && !['steer', 'followUp'].includes(request.streamingBehavior)) throw Error('Invalid streaming behavior')
  if (['status', 'prompt', 'cancel', 'end', 'history'].includes(request.command) && !UUID.test(request.taskId ?? '')) throw Error('Invalid task ID')
  if (request.command === 'history' && (request.position !== undefined && (!Number.isSafeInteger(request.position) || request.position < 0))) throw Error('Invalid history position')
}

export async function taskRequest(target, request, signal = undefined, timeout = 10_000) {
  // Whether the project is carried on this host or on the target's decides how it is judged.
  validateRequest(request, target.host !== undefined)
  const command = taskCommand(target.executable, target.host)
  const mutationId = ['start', 'launch', 'prompt', 'cancel', 'end'].includes(request.command) ? (request.mutationId ?? randomUUID()) : undefined
  const payload = { version: 1, requestId: randomUUID(), command: request.command, project: request.project,
    ...(['start', 'launch'].includes(request.command) ? { taskId: request.taskId ?? randomUUID(), mutationId, prompt: request.prompt, ...(request.console ? { console: request.console } : {}) } : {}),
    ...(request.command === 'prompt' ? { taskId: request.taskId, mutationId, prompt: request.prompt, ...(request.streamingBehavior ? { streamingBehavior: request.streamingBehavior } : {}) } : {}),
    ...(['status', 'cancel', 'end', 'history'].includes(request.command) ? { taskId: request.taskId } : {}),
    ...(['cancel', 'end'].includes(request.command) ? { mutationId } : {}),
    ...(request.command === 'history' && request.position !== undefined ? { position: request.position } : {}),
  }
  const mutation = ['start', 'launch', 'prompt', 'cancel', 'end'].includes(request.command)
  const failure = message => Error(mutation
    ? `Task ${request.command} outcome unknown; do not retry automatically. target=${target.id} taskId=${payload.taskId} project=${request.project}; use coding_task_status to reconcile`
    : message)
  const input = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(input) > 65_536) throw Error('Task request too large')
  const response = await exchange(command, input, signal, timeout, failure)
  if (!response || response.version !== 1 || response.requestId !== payload.requestId || typeof response.ok !== 'boolean') throw failure('Invalid task response correlation')
  if (!response.ok) {
    // Only the daemon's own fixed refusals are reflected. A reason an operator can act on is
    // worthless if it arrives as "rejected": a session that has already ended and a working turn
    // that needs a stated delivery behavior are exactly the two a spoken request hits.
    const safeReasons = ['项目或主机任务已满', '未找到任务', '任务服务不可用', '任务服务正在启动', '项目不在允许的开发目录内', '任务 ID 已用于不同请求', 'Hosted Pi 已结束', 'Hosted Pi 正在启动', '流式提示需要 delivery behavior']
    throw Error(safeReasons.includes(response.error) ? response.error : 'Managed task request rejected')
  }
  return response
}

/**
 * The request goes to the helper as a file rather than a pipe, and the correlated
 * frame is what completes the request rather than the helper's exit.
 *
 * Both halves are host facts. A Windows OpenSSH client does not relay a piped stdin
 * to a remote command, so a pipe arrives as nothing at all; and its session stays
 * open after the remote command has finished, so waiting for the process to exit
 * would report a request that is already answered as a timeout. One file handoff
 * and one answered frame work the same on every host.
 */
function exchange(command, input, signal, timeout, failure) {
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const directory = mkdtempSync(join(tmpdir(), 'open-deskos-task-'))
    const file = join(directory, 'request.json')
    writeFileSync(file, input, { mode: 0o600 })
    const stdin = openSync(file, 'r')
    // The request is a file on the child's standard input, so there is no pipe to
    // write, drain, or fail; the abort signal is what still tears the process down.
    const child = spawn(command.executable, command.args, { stdio: [stdin, 'pipe', 'pipe'], signal })
    closeSync(stdin)
    const discard = () => { void rm(directory, { recursive: true, force: true }).catch(() => {}) }
    const finish = (error, value = undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // The answer is the fact, and the process that produced it is disposable:
      // a helper that keeps running after its frame would otherwise leave a session
      // per request, which is exactly what a Windows OpenSSH client does on its own.
      child.kill('SIGKILL')
      discard()
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => finish(failure('Task control timeout')), timeout)
    const respond = () => {
      let response
      try { response = JSON.parse(output.trim()) } catch { return }
      if (response && response.version === 1 && typeof response.requestId === 'string' && typeof response.ok === 'boolean') {
        finish(null, response)
      }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      if (Buffer.byteLength(output) > 262_144) return finish(failure('Task response too large'))
      respond()
    })
    child.on('error', () => finish(failure('Task control failed')))
    child.once('close', code => {
      // A helper that answered has said what happened; one that exits without
      // answering failed the exchange, which is the transport's own vocabulary.
      respond()
      if (settled) return
      finish(code === 0 ? failure('Invalid task response') : failure('Task control failed'))
    })
  })
}
