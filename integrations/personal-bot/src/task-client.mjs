import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, posix } from 'node:path'
import { sshEnvironment } from './ssh-environment.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cleanPath = value => typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)
const developmentPath = value => {
  if (!cleanPath(value)) return false
  // Compare the reserved POSIX namespace with the same separators on every desk.
  // Keep the original target path; only the host can resolve its actual roots.
  const path = posix.normalize(normalize(value).replaceAll('\\', '/'))
  return path !== '/opt/odk' && !path.startsWith('/opt/odk/')
}
const keysOnly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))

export function taskCommand(executable, host) {
  if (!cleanPath(executable)) throw Error('Invalid task executable: must be absolute without control characters')
  if (host === undefined) return { executable, args: [] }
  if (typeof host !== 'string' || !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw Error('Invalid SSH host')
  const quoted = `'${executable.replaceAll("'", "'\\''")}'`
  return { executable: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '--', host, quoted] }
}

/** Read-only streams detect dead SSH transports without changing mutation request arguments. */
export function taskCompletionCommand(executable, host) {
  const command=taskCommand(executable,host)
  if(host)command.args.splice(command.args.indexOf('--'),0,'-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2')
  return command
}

export async function loadTargets(path = process.env.ODK_TASK_TARGETS_FILE) {
  if (!path) return []
  if (!cleanPath(path)) throw Error('Invalid task targets configuration path')
  const config = JSON.parse(await readFile(path, 'utf8'))
  if (!keysOnly(config, ['targets']) || !Array.isArray(config.targets)) throw Error('Invalid task targets configuration')
  const ids = new Set()
  for (const target of config.targets) {
    if (!keysOnly(target, ['id', 'name', 'host', 'executable', 'roots', 'reportMachines']) || !['cm5', 'mac'].includes(target.id)
      || typeof target.name !== 'string' || !target.name.trim() || !Array.isArray(target.roots) || !target.roots.length
      || !target.roots.every(developmentPath) || new Set(target.roots).size !== target.roots.length) throw Error('Invalid task target configuration')
    if(target.reportMachines!==undefined && (!Array.isArray(target.reportMachines) || target.reportMachines.length>16 || !target.reportMachines.every(machine=>typeof machine==='string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(machine)) || new Set(target.reportMachines).size!==target.reportMachines.length))throw Error('Invalid report machine binding')
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
  if (request.expectedRevision !== undefined && (typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedRevision))) throw Error('Invalid task revision')
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
    ...(request.command === 'prompt' && request.expectedRevision !== undefined ? {expectedRevision:request.expectedRevision} : {}),
    ...(request.command === 'history' && request.position !== undefined ? { position: request.position } : {}),
  }
  const mutation = ['start', 'launch', 'prompt', 'cancel', 'end'].includes(request.command)
  const failure = message => Error(mutation
    ? `Task ${request.command} outcome unknown; do not retry automatically. target=${target.id} taskId=${payload.taskId} project=${request.project} mutationId=${mutationId}; use coding_task_status to reconcile`
    : message)
  const input = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(input) > 65_536) throw Error('Task request too large')
  const response = await exchange(command, input, signal, timeout, failure, target.host !== undefined)
  if (!response || response.version !== 1 || response.requestId !== payload.requestId || typeof response.ok !== 'boolean') throw failure('Invalid task response correlation')
  if (!response.ok) {
    // Only the daemon's own fixed refusals are reflected. A reason an operator can act on is
    // worthless if it arrives as "rejected": a session that has already ended and a working turn
    // that needs a stated delivery behavior are exactly the two a spoken request hits.
    const safeReasons = ['项目或主机任务已满', '未找到任务', '任务服务不可用', '任务服务正在启动', '项目不在允许的开发目录内', '任务 ID 已用于不同请求', 'Hosted Pi 已结束', 'Hosted Pi 正在启动', '流式提示需要 delivery behavior', 'Task revision 已变化', '原会话目录必须使用真实私有规范路径', '原会话文件不可安全恢复', '原会话头无效', '原会话身份不匹配', '此端点是当前 Pi 会话，不是 Hosted Pi 任务服务', '指令未送达：该会话正在运行，且这条消息没有被排队']
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
function exchange(command, input, signal, timeout, failure, remote) {
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const directory = mkdtempSync(join(tmpdir(), 'odk-task-'))
    const file = join(directory, 'request.json')
    writeFileSync(file, input, { mode: 0o600 })
    const stdin = openSync(file, 'r')
    // The request is a file on the child's standard input, so there is no pipe to
    // write, drain, or fail; the abort signal is what still tears the process down.
    const child = spawn(command.executable, command.args, { stdio: [stdin, 'pipe', 'pipe'], signal,
      ...(remote ? { env: sshEnvironment() } : {}) })
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


/** Internal completion-only subscription. It never issues inventory queries or mutations. */
export function watchTaskCompletions(target, {signal = undefined, onCompletion = () => {}, onState = (_state) => {}} = {}) {
  if(!Array.isArray(target.roots) || !target.roots.length || target.roots.length>32 || !target.roots.every(root=>carriedProject(root,Boolean(target.host))))throw Error('Invalid completion roots')
  const command=taskCompletionCommand(target.executable,target.host),lifetime=new AbortController()
  const abort=()=>lifetime.abort()
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true})
  let child,timer,unsupported=false,reconnectMs=5000
  const loop=(async()=>{
    while(!lifetime.signal.aborted && !unsupported) {
      const requestId=randomUUID(),payload={version:1,requestId,command:'subscribe_completions',projects:target.roots}
      if(Buffer.byteLength(JSON.stringify(payload))>65535)throw Error('Completion subscription request too large')
      const directory=mkdtempSync(join(tmpdir(),'odk-task-completions-')),file=join(directory,'request.json')
      let stdin
      try {
        writeFileSync(file,JSON.stringify(payload)+'\n',{mode:0o600});stdin=openSync(file,'r')
        await new Promise(resolve=>{
          let ready=false,pending=''
          child=spawn(command.executable,command.args,{stdio:[stdin,'pipe','ignore'],...(target.host?{env:sshEnvironment()}:{} )})
          const stop=()=>child?.kill('SIGKILL')
          lifetime.signal.addEventListener('abort',stop,{once:true})
          timer=setTimeout(stop,10000)
          child.once('error',()=>{})
          child.once('close',code=>{if(!ready && code!==255)unsupported=true;clearTimeout(timer);lifetime.signal.removeEventListener('abort',stop);child=undefined;resolve(undefined)})
          child.stdout.setEncoding('utf8')
          child.stdout.on('data',chunk=>{
            pending+=chunk
            if(Buffer.byteLength(pending)>262144){unsupported=true;stop();return}
            const lines=pending.split('\n');pending=lines.pop()??''
            for(const line of lines)try{
              const record=JSON.parse(line)
              if(record.version!==1 || record.requestId!==requestId)throw Error()
              if(!ready){
                if(!record.ok || record.subscription!=='completions'){unsupported=true;stop();return}
                ready=true;reconnectMs=5000;clearTimeout(timer);onState('connected');onCompletion()
              }else{
                if(record.type==='heartbeat'){if(Object.keys(record).length!==3 || Object.keys(record).some(key=>!['version','requestId','type'].includes(key)))throw Error();continue}
                if(Object.keys(record).some(key=>!['version','requestId','type','taskId','project','lastTurnId','outcome'].includes(key)) || record.type!=='completion' || !UUID.test(record.taskId) || !UUID.test(record.lastTurnId) || !carriedProject(record.project,Boolean(target.host)) || !['finished','failed','cancelled'].includes(record.outcome))throw Error()
                onCompletion()
              }
            }catch{unsupported=true;stop();return}
          })
          if(lifetime.signal.aborted)stop()
        })
      } finally {if(stdin!==undefined)closeSync(stdin);await rm(directory,{recursive:true,force:true})}
      if(lifetime.signal.aborted)break
      onState('unavailable')
      if(!unsupported)await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);lifetime.signal.removeEventListener('abort',done);resolve(undefined)}
        timer=setTimeout(done,reconnectMs);reconnectMs=Math.min(reconnectMs*2,60000);lifetime.signal.addEventListener('abort',done,{once:true})
        if(lifetime.signal.aborted)done()
      })
    }
  })().catch(()=>onState('unavailable'))
  return {async close(){abort();clearTimeout(timer);child?.kill('SIGKILL');await loop;signal?.removeEventListener('abort',abort)}}
}
