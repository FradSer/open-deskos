import { loadShellModule } from './plugin-composition.mjs'
import { readFrames, writeFrame } from './channel-frames.mjs'
import { connectMain, mainAlias } from './hub-transport.mjs'
import { APPS_FRAME_BYTES, validDisplayHost } from './display-apps.mjs'
const { listenChannel } = loadShellModule('local-channel.js', import.meta.url)
const FORWARD = new Set(['status', 'text', 'runtime_diagnose', 'proactive_event', 'proposal_presented', 'proposal_list', 'proposal_respond'])
const STATES = new Set(['idle', 'recording', 'transcribing', 'thinking', 'error'])

export async function createDisplayRelay({ endpoint, stateDir, alias, token = undefined, platform = process.platform,
  connect = connectMain, createVoice = undefined, applications = undefined, reconnectMs = 1000, readyTimeoutMs = 10000 }) {
  mainAlias(alias)
  if (applications && !validDisplayHost(applications.host)) throw Error('Invalid display host')
  const clients = new Set()
  const cache = new Map()
  let upstream, voice, registered = !applications, ready = false, stopped = false, retry, deadline, attempt = 0
  let status = unavailable()
  function unavailable() { return { v: 1, type: 'status', state: 'unavailable', textInput: false,
    replyInput: false, level: 0, transcript: '', message: 'CM5 连接不可用。草稿已保留。' } }
  function broadcast(frame) { for (const client of clients) void writeFrame(client, frame).catch(() => client.destroy()) }
  async function send(frame) {
    const active = upstream
    if (!active || !ready || !registered || active.destroyed) throw Error('CM5 unavailable')
    await writeFrame(active, frame, 4096)
    if (active !== upstream || active.destroyed) throw Error('CM5 disconnected')
  }
  function disconnected(active) {
    if (active !== upstream) return
    upstream = undefined
    ready = false
    registered = !applications
    clearTimeout(deadline)
    const oldVoice = voice
    voice = undefined
    void oldVoice?.close().catch(() => {})
    const remote = cache.get('remote_conversation')?.remote
    const briefing = cache.get('briefing')?.briefing
    status = { ...unavailable(),
      ...(remote ? { remote: { ...remote, state: 'stale' } } : {}),
      ...(briefing ? { briefing: { ...briefing, state: briefing.items?.length ? 'stale' : 'unavailable' } } : {}),
    }
    cache.clear()
    broadcast(status)
    if (!stopped) {
      retry = setTimeout(start, Math.min(15000, reconnectMs * 2 ** Math.min(attempt++, 4)))
      retry.unref?.()
    }
  }
  function start() {
    if (stopped) return
    let active
    try { active = connect(alias) } catch {
      retry = setTimeout(start, reconnectMs); retry.unref?.(); return
    }
    upstream = active
    const requests = new Set()
    const seenRequests = new Set()
    deadline = setTimeout(() => active.destroy(), readyTimeoutMs)
    deadline.unref?.()
    active.once('close', () => disconnected(active))
    readFrames(active, frame => {
      if (active !== upstream) return
      if (frame.type === 'host_apps_ready') {
        if (!applications || registered || Object.keys(frame).length !== 2) throw Error('Invalid display acknowledgement')
        registered = true
        if (ready) clearTimeout(deadline)
        if (ready) broadcast(status)
        return
      }
      if (frame.type === 'host_apps_request') {
        if (!registered || !applications || !ready || requests.size >= 8 || typeof frame.requestId !== 'string'
          || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(frame.requestId)
          || Object.keys(frame).some(key => !['v','type','requestId','command','params'].includes(key)) || seenRequests.has(frame.requestId)
          || seenRequests.size >= 4096) throw Error('Invalid display request')
        requests.add(frame.requestId)
        seenRequests.add(frame.requestId)
        // Never pause status, voice or receipt input while the local verifier runs.
        void Promise.resolve().then(() => applications.request(frame.command, frame.params)).then(
          result => reply(result), () => reply({ ok: false, error: 'Display application request failed; outcome unknown, do not retry' }),
        ).finally(() => requests.delete(frame.requestId)).catch(() => active.destroy())
        function reply(result) {
          if (active !== upstream || active.destroyed) return
          return writeFrame(active, { v: 1, type: 'host_apps_response', requestId: frame.requestId, result }, APPS_FRAME_BYTES)
        }
        return
      }
      if (frame.type === 'status') {
        if (!STATES.has(frame.state)) throw Error('Invalid main status')
        ready = true
        if (registered) clearTimeout(deadline)
        attempt = 0
        status = frame
        voice ??= createVoice?.({ send })
        voice?.onFrame(frame)
      } else if (!ready) throw Error('Main status required')
      else if (voice?.onFrame(frame)) return
      if (['briefing', 'remote_conversation', 'conversation'].includes(frame.type)) cache.set(frame.type, frame)
      if (registered && ['status', 'briefing', 'remote_conversation', 'conversation', 'text_receipt', 'runtime_diagnosis'].includes(frame.type)) broadcast(frame)
    }, { maxFrame: APPS_FRAME_BYTES, maxBatch: APPS_FRAME_BYTES * 4 })
    // Reconnect only subscribes. Owner mutations and audio are never replayed.
    void (async () => {
      if (applications) await writeFrame(active, { v: 1, type: 'host_apps_hello', host: applications.host }, 4096)
      await writeFrame(active, { v: 1, type: 'status', runtimeDiagnosis: 1 }, 4096)
    })().catch(() => active.destroy())
  }
  const listener = await listenChannel({ endpoint, stateDir, token, platform, onConnection(client) {
    if (clients.size >= 32) { client.destroy(); return }
    clients.add(client)
    client.once('close', () => clients.delete(client))
    void writeFrame(client, registered ? status : unavailable()).catch(() => client.destroy())
    if (registered) for (const frame of cache.values()) void writeFrame(client, frame).catch(() => client.destroy())
    readFrames(client, async frame => {
      if (frame.type === 'toggle') {
        if (ready && registered && voice) await voice.toggle()
        else await writeFrame(client, registered ? status : unavailable())
        return
      }
      if (!FORWARD.has(frame.type)) { client.destroy(); return }
      if (!ready || !registered) {
        if (frame.type === 'text') await writeFrame(client, { v: 1, type: 'text_receipt', requestId: frame.requestId, accepted: false })
        else await writeFrame(client, registered ? status : unavailable())
        return
      }
      try { await send(frame) } catch { client.destroy() }
    })
  } })
  start()
  return { async close() {
    stopped = true
    clearTimeout(retry); clearTimeout(deadline)
    const oldVoice = voice; voice = undefined
    try { await oldVoice?.close() } finally {
      upstream?.destroy()
      for (const client of clients) client.destroy()
      await listener.close()
    }
  } }
}
