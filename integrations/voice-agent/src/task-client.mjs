import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, normalize } from 'node:path'

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

// The daemon stores and reports every project as its real path, while a target's configured roots
// and the coordinator's own submitted paths are whatever the operator wrote. A root that is itself a
// symlink therefore used to make the project the list just reported look like it was outside the
// root, and the follow-up identity call was refused before it left. Either form is accepted on both
// sides: the check still proves the project is inside the root on disk.
function canonical(value) {
  try { return realpathSync(value) } catch { return value }
}

function withinRoot(root, project) {
  for (const base of new Set([root, canonical(root)])) {
    for (const candidate of new Set([project, canonical(project)])) {
      const suffix = relative(base, candidate)
      if (suffix === '' || (suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix))) return true
    }
  }
  return false
}

function validateRequest(target, request) {
  if (!['start', 'launch', 'status', 'list', 'prompt', 'cancel', 'end', 'history'].includes(request.command)) throw Error('Invalid task command')
  if (!developmentPath(request.project) || !target.roots.some(root => withinRoot(root, request.project))) throw Error('Invalid project: select an absolute project within a configured development root')
  if (['start', 'launch', 'prompt'].includes(request.command) && (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 16_384)) throw Error('Invalid task prompt')
  if (request.command === 'prompt' && request.streamingBehavior !== undefined && !['steer', 'followUp'].includes(request.streamingBehavior)) throw Error('Invalid streaming behavior')
  if (['status', 'prompt', 'cancel', 'end', 'history'].includes(request.command) && !UUID.test(request.taskId ?? '')) throw Error('Invalid task ID')
  if (request.command === 'history' && (request.position !== undefined && (!Number.isSafeInteger(request.position) || request.position < 0))) throw Error('Invalid history position')
}

export async function taskRequest(target, request, signal = undefined, timeout = 10_000) {
  validateRequest(target, request)
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

function exchange(command, input, signal, timeout, failure) {
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const child = spawn(command.executable, command.args, { stdio: ['pipe', 'pipe', 'ignore'], signal })
    const finish = (error, value = undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) child.kill('SIGKILL')
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => finish(failure('Task control timeout')), timeout)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      if (Buffer.byteLength(output) > 262_144) finish(failure('Task response too large'))
    })
    child.on('error', () => finish(failure('Task control failed')))
    child.stdin.on('error', () => finish(failure('Task control failed')))
    child.once('close', code => {
      if (code !== 0) return finish(failure('Task control failed'))
      let response
      try { response = JSON.parse(output.trim()) } catch { return finish(failure('Invalid task response')) }
      finish(null, response)
    })
    child.stdin.end(input)
  })
}
