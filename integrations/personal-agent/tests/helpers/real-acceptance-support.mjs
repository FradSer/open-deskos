import { join } from 'node:path'

export function assertResidentIdentity(residentUid, currentUid) {
  if (residentUid !== currentUid) throw Error('Resident service user required before provider startup')
}

const ALLOWED = new Set(['coding_targets', 'coding_tasks_list', 'coding_task_status', 'coding_task_history', 'coding_task_prompt'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function cleanupAcceptance(steps, timeoutMs = 2000) {
  const failures = []
  for (const step of steps) {
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(step.run),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), timeoutMs) }),
      ])
    } catch (error) { failures.push({ step: step.name, failure: error?.message === 'timeout' ? 'timeout' : 'rejected' }) }
    finally { clearTimeout(timer) }
  }
  return failures
}

function selectedResult(payload) {
  if (!payload) return undefined
  return { ok: payload.ok, version: payload.version, requestId: payload.requestId, mutationId: payload.mutationId,
    submitted: payload.submitted, accepted: payload.accepted, delivery: payload.delivery, reconciliation: payload.reconciliation,
    targets: payload.targets?.map(target => ({ id: target.id, roots: target.roots })),
    tasks: payload.tasks?.map(task => ({ taskId: task.taskId, project: task.project, name: task.name })),
    task: payload.task && { taskId: payload.task.taskId, project: payload.task.project, activity: payload.task.activity, prompt: payload.task.prompt, response: payload.task.response } }
}

export function acceptanceTools(tools, identity, trace) {
  let offered
  return { getOffer: () => offered, tools: tools.filter(tool => ALLOWED.has(tool.name)).map(tool => ({ ...tool, execute: async (...args) => {
    const params = args[1]
    if (tool.name === 'coding_task_prompt') {
      if (!params || params.target !== 'mac' || params.project !== identity.project || params.taskId !== identity.taskId || offered) throw Error('Exact fixture once only; no replay')
      offered = { target: params.target, project: params.project, taskId: params.taskId, prompt: params.prompt, streamingBehavior: params.streamingBehavior, outcome: 'unknown', retry: 'never' }
    }
    const record = { name: tool.name, params: params && { target: params.target, project: params.project, taskId: params.taskId, prompt: params.prompt, streamingBehavior: params.streamingBehavior } }
    trace.push(record)
    try {
      const value = await tool.execute(...args)
      record.result = selectedResult(value.structuredContent)
      if (tool.name === 'coding_task_prompt') offered.mutationId = value.structuredContent?.mutationId
      return value
    } catch (error) {
      record.outcome = 'unknown'; record.retry = 'never'
      const candidate = typeof error?.mutationId === 'string' ? error.mutationId : /mutationId=([0-9a-f-]{36})(?![0-9a-f-])/i.exec(error?.message || '')?.[1]
      if (candidate && UUID.test(candidate)) { record.mutationId = candidate; if (tool.name === 'coding_task_prompt') offered.mutationId = candidate }
      throw error
    }
  } })) }
}

export function observePersonalTurn(client, { handshake, states, timeoutMs = 120_000 }) {
  return new Promise((resolve, reject) => {
    let pending = '', recording = false, thinking = false, settled = false
    const cleanup = () => { clearTimeout(timer); client.off('data', onData); client.off('connect', onConnect) }
    const finish = (error, frame) => {
      if (settled) return
      settled = true; cleanup(); client.destroy()
      if (error) reject(error); else resolve(frame)
    }
    const onConnect = () => { try { client.write(handshake + JSON.stringify({ v: 1, type: 'toggle' }) + '\n') } catch { finish(Error('Channel write failed; no mutation retry')) } }
    const onData = chunk => {
      try {
        pending += chunk
        if (Buffer.byteLength(pending) > 131_072) throw Error('Oversized service response')
        let newline
        while (!settled && (newline = pending.indexOf('\n')) >= 0) {
          const frame = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1)
          if (frame?.v !== 1 || frame.type !== 'status' || typeof frame.state !== 'string') throw Error('Invalid service frame')
          if (states.at(-1) !== frame.state) states.push(frame.state)
          if (frame.state === 'recording' && !recording) { recording = true; client.write(JSON.stringify({ v: 1, type: 'toggle' }) + '\n') }
          if (frame.state === 'thinking') thinking = true
          if (frame.state === 'error' || thinking && frame.state === 'idle') finish(null, frame)
        }
      } catch { finish(Error('Malformed or invalid service frame; no mutation retry')) }
    }
    const onError = () => finish(Error('Channel failed; no mutation retry'))
    const onClose = () => {
      client.off('error', onError)
      finish(Error('Channel closed before outcome; no mutation retry'))
    }
    const timer = setTimeout(() => finish(Error('Observation timeout; no mutation retry')), timeoutMs)
    client.setEncoding('utf8')
    client.once('connect', onConnect); client.on('data', onData); client.on('error', onError); client.once('close', onClose)
  })
}

export function acceptanceEndpoint(platform, directory, id) {
  return platform === 'win32' ? String.raw`\\.\pipe\odk-real-pa-${id}` : join(directory, 'agent.sock')
}
