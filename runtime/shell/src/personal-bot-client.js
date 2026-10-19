const net = require('node:net')
const { parseReplyTo } = require('./personal-bot-reply-reference')
const { randomUUID } = require('node:crypto')
const { sanitizeRuntimePlugins } = require('./plugin-runtime-report')
const { parseHomeBriefing } = require('./home-briefing-frame')
const { parseRemoteConversation } = require('./remote-conversation-frame')
const { parseJevStatus } = require('./jev-status-frame')
const { parseJudgmentStatus } = require('./judgment-status-frame')
const { parseAgentTasks } = require('./agent-task-frame')
const { readOrCreateToken, requiresToken, writeHandshake } = require('./local-channel')
const { resolveShellHost } = require('./platform')

const STATES = new Set(['idle', 'recording', 'transcribing', 'thinking', 'error'])
const MAX_STATUS_BYTES = 131072
const MAX_MESSAGE_CHARACTERS = 16384
const MAX_TRANSCRIPT_CHARACTERS = 4096

/**
 * The voice link is a runtime channel, so its endpoint comes from the host's own
 * naming: a socket in the runtime directory on a Unix host, and the `personal-bot`
 * named pipe on a Windows host. A Unix host with no runtime directory still
 * resolves nothing rather than guessing where a service would listen.
 */
function resolvePersonalBotSocketPath(env = process.env, host = null) {
  const resolved = host || resolveShellHost({ env })
  return resolved.endpoint('personal-bot')
}

function createPersonalBotClient({ socketPath, env = process.env, platform = process.platform, host = null, token = '', reconnectDelayMs = 1000, diagnosisTimeoutMs = 500 } = {}) {
  const resolvedHost = host || resolveShellHost({ env, platform })
  // A named pipe carries no owner, so the channel token is what authenticates the
  // peer there. A Unix socket is already gated by ownership, and a client written
  // before the token existed keeps reaching the protocol with every byte it sent.
  const needsToken = Boolean(socketPath) && requiresToken({ endpoint: socketPath, platform })
  let tokenPromise = null
  let socket = null
  let connected = false
  let completionPending = false
  let completionEnabled = false
  let diagnosisReady = false
  let diagnosisSupported = false
  let running = false
  let timer = null
  let status = { state: 'unavailable', message: 'Personal Bot service unavailable' }
  const listeners = new Set()
  const diagnoses = new Map()
  const textRequests = new Map()
  function finishText(id, accepted) {
    const request = textRequests.get(id)
    if (!request) return
    textRequests.delete(id)
    clearTimeout(request.timer)
    request.resolve(accepted)
  }
  const unavailable = reason => ({ host: 'personal-agent', instance: 'resident', state: 'unavailable', reason, plugins: [] })
  function finishDiagnosis(id, runtime) {
    const pending = diagnoses.get(id)
    if (!pending) return
    diagnoses.delete(id)
    clearTimeout(pending.timer)
    pending.signal?.removeEventListener('abort', pending.abort)
    pending.resolve([runtime])
  }
  function cancelDiagnoses(reason) {
    for (const id of diagnoses.keys()) finishDiagnosis(id, unavailable(reason))
  }

  // The token is read when the endpoint needs one, not when the client is
  // created, because the Shell builds its client before anything is listening.
  async function channelToken() {
    if (token) return token
    if (!needsToken) return ''
    if (!tokenPromise) tokenPromise = readOrCreateToken({ stateDir: resolvedHost.stateDir })
    return tokenPromise
  }

  function publish(next) {
    status = next
    for (const listener of listeners) listener({ ...status })
  }

  function write(type, payload = {}) {
    if (!connected || !socket || socket.destroyed) return false
    socket.write(`${JSON.stringify({ v: 1, type, ...payload })}\n`)
    return true
  }

  function servicePush(readingIds) {
    if (!Array.isArray(readingIds) || readingIds.length === 0 || readingIds.length > 32
      || !readingIds.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))) return false
    const completion = readingIds.length === 1 && readingIds[0] === 'odk.app.pi-sessions.completed'
    const sent = diagnosisReady && write('proactive_event', { readingIds })
    if (completion) { completionEnabled = true; completionPending = !sent }
    return sent
  }

  function connect() {
    if (!running) return
    const active = net.createConnection(socketPath)
    socket = active
    let remainder = ''
    active.setEncoding('utf8')
    active.once('connect', () => {
      connected = true
      channelToken().then((value) => {
        // A connection that lost its socket while the token was being read must
        // not write into it, and an unreadable token is not a reason to present
        // an unauthenticated connection: the service drops those anyway.
        if (socket !== active || !connected || active.destroyed) return
        if (value) writeHandshake(active, value)
        diagnosisReady = true
        write('status', { runtimeDiagnosis: 1 })
        if (completionPending) servicePush(['odk.app.pi-sessions.completed'])
      }, () => active.destroy())
    })
    active.on('data', (chunk) => {
      remainder += chunk
      const lines = remainder.split('\n')
      remainder = lines.pop()
      if (Buffer.byteLength(remainder) > MAX_STATUS_BYTES) return active.destroy()
      for (const line of lines) {
        if (Buffer.byteLength(line) > MAX_STATUS_BYTES) return active.destroy()
        let record
        try { record = JSON.parse(line) } catch { continue }
        if (record?.v === 1 && record.type === 'text_receipt') { finishText(record.requestId, record.accepted === true); continue }
        if (record?.v === 1 && record.type === 'runtime_diagnosis') {
          if (!diagnoses.has(record.requestId)) continue
          const runtime = record.runtime
          try {
            if (runtime?.host !== 'personal-agent' || runtime.instance !== 'resident') throw Error('invalid runtime')
            if (runtime.state === 'available') finishDiagnosis(record.requestId, { host: 'personal-agent', instance: 'resident', state: 'available', plugins: sanitizeRuntimePlugins(runtime, 'personal-agent') })
            else if (runtime.state === 'unavailable' && typeof runtime.reason === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(runtime.reason)) finishDiagnosis(record.requestId, unavailable(runtime.reason))
            else throw Error('invalid runtime')
          } catch { finishDiagnosis(record.requestId, unavailable('invalid-report')) }
          continue
        }
        if (record?.v === 1 && record.type === 'remote_conversation') {
          publish({...status,remote:parseRemoteConversation(record.remote)})
          continue
        }
        if (record?.v === 1 && record.type === 'briefing') {
          publish({ ...status, briefing: parseHomeBriefing(record.briefing) })
          continue
        }
        if (record?.v !== 1 || record.type !== 'status' || !STATES.has(record.state)) continue
        diagnosisSupported = record.runtimeDiagnosis === 1
        const level = record.state === 'recording' && Number.isFinite(record.level)
          && record.level >= 0 && record.level <= 1 ? record.level : 0
        const transcript = ['thinking', 'idle', 'error'].includes(record.state) && typeof record.transcript === 'string'
          ? record.transcript.slice(0, MAX_TRANSCRIPT_CHARACTERS) : ''
        publish({
          state: record.state,
          textInput: record.textInput === true,
          replyInput: record.replyInput === true,
          message: typeof record.message === 'string' ? record.message.slice(0, MAX_MESSAGE_CHARACTERS) : '',
          transcript,
          ...(typeof record.ownerTurnId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.ownerTurnId) ? { ownerTurnId: record.ownerTurnId } : {}),
          ...(parseReplyTo(record.replyTo) && typeof record.threadId==='string' && /^[a-f0-9]{64}$/.test(record.threadId) ? {replyTo:parseReplyTo(record.replyTo),threadId:record.threadId} : {}),
          level,
          agents: parseAgentTasks(record.agents),
          jev: parseJevStatus(record.jev),
          judgment: parseJudgmentStatus(record.judgment),
          ...(record.remote ? {remote:parseRemoteConversation(record.remote)} : status.remote ? {remote:status.remote} : {}),
          ...(record.briefing ? { briefing: parseHomeBriefing(record.briefing) } : status.briefing ? { briefing: status.briefing } : {}),
          ...(Array.isArray(record.proposals) && record.proposals.length <= 64 ? { proposals: record.proposals, proposalPopup: record.proposalPopup === true, proposalInteraction: record.proposalInteraction === true, proposalHiddenCount: Number.isSafeInteger(record.proposalHiddenCount) ? record.proposalHiddenCount : 0 } : {}),
          ...(typeof record.proposalError === 'string' ? { proposalError: record.proposalError.slice(0, 256) } : {}),
        })
      }
    })
    active.on('error', () => {})
    active.once('close', () => {
      if (socket !== active) return
      connected = false
      if (completionEnabled) completionPending = true
      diagnosisReady = false
      diagnosisSupported = false
      socket = null
      cancelDiagnoses('disconnected')
      for (const id of textRequests.keys()) finishText(id, false)
      publish({ state: 'unavailable', message: 'Personal Bot service unavailable', jev: { status: 'unavailable' }, judgment: {status:'unavailable',provider:'model'},
        agents: { state: 'unavailable', tasks: [] },
        ...(status.remote ? { remote: {...status.remote, state:'stale'} } : {}),
        ...(status.briefing ? { briefing: { ...status.briefing, state: status.briefing.items.length ? 'stale' : 'unavailable' } } : {}) })
      if (running) timer = setTimeout(connect, reconnectDelayMs)
    })
  }

  return {
    start() {
      if (running || !socketPath) return
      running = true
      connect()
    },
    stop() {
      running = false
      clearTimeout(timer)
      connected = false
      diagnosisReady = false
      diagnosisSupported = false
      const active = socket
      socket = null
      cancelDiagnoses('stopped')
      for (const id of textRequests.keys()) finishText(id, false)
      active?.destroy()
    },
    diagnose({ signal } = {}) {
      if (signal?.aborted) return Promise.resolve([unavailable('stopped')])
      if (!diagnosisReady || !connected || !socket || socket.destroyed) return Promise.resolve([unavailable('disconnected')])
      if (!diagnosisSupported) return Promise.resolve([unavailable('not-supported')])
      if (diagnoses.size >= 16) return Promise.resolve([unavailable('busy')])
      return new Promise(resolve => {
        const requestId = randomUUID()
        const timer = setTimeout(() => finishDiagnosis(requestId, unavailable('timeout')), diagnosisTimeoutMs)
        const abort = () => finishDiagnosis(requestId, unavailable('stopped'))
        diagnoses.set(requestId, { resolve, timer, signal, abort })
        signal?.addEventListener('abort', abort, { once: true })
        try {
          if (!write('runtime_diagnose', { requestId })) finishDiagnosis(requestId, unavailable('disconnected'))
        } catch { finishDiagnosis(requestId, unavailable('send-failed')) }
      })
    },
    toggle: () => write('toggle'),
    sendText(text, replyTo) {
      const reference = replyTo === undefined ? undefined : parseReplyTo(replyTo)
      if (reference === null || (reference && status.replyInput !== true)) return Promise.resolve(false)
      const context = reference ? { replyTo: reference } : {}
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 3000
        || status.textInput !== true || textRequests.size || !['idle', 'error'].includes(status.state)) return Promise.resolve(false)
      const requestId = randomUUID()
      if (Buffer.byteLength(JSON.stringify({ v: 1, type: 'text', text, requestId, ...context })) > 4095) return Promise.resolve(false)
      return new Promise(resolve => {
        const timer = setTimeout(() => finishText(requestId, false), 5000)
        textRequests.set(requestId, { resolve, timer })
        try { if (!write('text', { text, requestId, ...context })) finishText(requestId, false) }
        catch { finishText(requestId, false) }
      })
    },
    servicePush,
    proposalCommand: ({ type, ...payload }) => ['proposal_respond', 'proposal_list', 'proposal_presented'].includes(type) && write(type, payload),
    snapshot: () => ({ ...status }),
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...status })
      return () => listeners.delete(listener)
    },
  }
}

module.exports = { createPersonalBotClient, resolvePersonalBotSocketPath }
