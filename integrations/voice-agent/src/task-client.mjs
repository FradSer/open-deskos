import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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

function validateRequest(target, request) {
  if (!['start', 'status', 'list', 'cancel'].includes(request.command)) throw Error('Invalid task command')
  if (!developmentPath(request.project) || !target.roots.some(root => {
    const suffix = relative(root, request.project)
    return suffix === '' || (suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix))
  })) throw Error('Invalid project: select an absolute project within a configured development root')
  if (request.command === 'start' && (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 16_384)) throw Error('Invalid task prompt')
  if (['status', 'cancel'].includes(request.command) && !UUID.test(request.taskId ?? '')) throw Error('Invalid task ID')
}

export async function taskRequest(target, request, signal = undefined, timeout = 10_000) {
  validateRequest(target, request)
  const command = taskCommand(target.executable, target.host)
  const payload = { version: 1, requestId: randomUUID(), command: request.command, project: request.project,
    ...(request.command === 'start' ? { taskId: randomUUID(), prompt: request.prompt } : {}),
    ...(['status', 'cancel'].includes(request.command) ? { taskId: request.taskId } : {}),
  }
  const mutation = ['start', 'cancel'].includes(request.command)
  const failure = message => Error(mutation
    ? `Task ${request.command} outcome unknown; do not retry automatically. target=${target.id} taskId=${payload.taskId} project=${request.project}; use coding_task_status to reconcile`
    : message)
  const input = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(input) > 65_536) throw Error('Task request too large')
  const response = await exchange(command, input, signal, timeout, failure)
  if (!response || response.version !== 1 || response.requestId !== payload.requestId || typeof response.ok !== 'boolean') throw failure('Invalid task response correlation')
  if (!response.ok) {
    const safeReasons = ['项目或主机任务已满', '未找到任务', '任务服务不可用', '任务服务正在启动', '项目不在允许的开发目录内', '任务 ID 已用于不同请求']
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
