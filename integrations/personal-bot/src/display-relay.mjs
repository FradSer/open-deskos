import { loadShellModule } from './plugin-composition.mjs'
import { readFrames, writeFrame } from './channel-frames.mjs'
import { connectMain, mainAlias } from './hub-transport.mjs'
const { listenChannel } = loadShellModule('local-channel.js', import.meta.url)
const FORWARD = new Set(['status', 'text', 'runtime_diagnose', 'proactive_event', 'proposal_presented', 'proposal_list', 'proposal_respond'])
const STATES = new Set(['idle', 'recording', 'transcribing', 'thinking', 'error'])

export async function createDisplayRelay({ endpoint, stateDir, alias, token = undefined, platform = process.platform,
  connect = connectMain, createVoice = undefined, reconnectMs = 1000, readyTimeoutMs = 10000 }) {
  mainAlias(alias)
  const clients = new Set()
  const cache = new Map()
  let upstream, voice, ready = false, stopped = false, retry, deadline, attempt = 0
  let status = unavailable()
  function unavailable() { return { v: 1, type: 'status', state: 'unavailable', textInput: false,
    replyInput: false, level: 0, transcript: '', message: 'CM5 连接不可用。草稿已保留。' } }
  function broadcast(frame) { for (const client of clients) void writeFrame(client, frame).catch(() => client.destroy()) }
  async function send(frame) {
    const active = upstream
    if (!active || !ready || active.destroyed) throw Error('CM5 unavailable')
    await writeFrame(active, frame, 4096)
    if (active !== upstream || active.destroyed) throw Error('CM5 disconnected')
  }
  function disconnected(active) {
    if (active !== upstream) return
    upstream = undefined
    ready = false
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
    deadline = setTimeout(() => active.destroy(), readyTimeoutMs)
    deadline.unref?.()
    active.once('close', () => disconnected(active))
    readFrames(active, frame => {
      if (active !== upstream) return
      if (frame.type === 'status') {
        if (!STATES.has(frame.state)) throw Error('Invalid main status')
        ready = true
        clearTimeout(deadline)
        attempt = 0
        status = frame
        voice ??= createVoice?.({ send })
        voice?.onFrame(frame)
      } else if (!ready) throw Error('Main status required')
      else if (voice?.onFrame(frame)) return
      if (['briefing', 'remote_conversation', 'conversation'].includes(frame.type)) cache.set(frame.type, frame)
      if (['status', 'briefing', 'remote_conversation', 'conversation', 'text_receipt', 'runtime_diagnosis'].includes(frame.type)) broadcast(frame)
    }, { maxFrame: 131072, maxBatch: 524288 })
    // Reconnect only subscribes. Owner mutations and audio are never replayed.
    void writeFrame(active, { v: 1, type: 'status', runtimeDiagnosis: 1 }, 4096).catch(() => active.destroy())
  }
  const listener = await listenChannel({ endpoint, stateDir, token, platform, onConnection(client) {
    if (clients.size >= 32) { client.destroy(); return }
    clients.add(client)
    client.once('close', () => clients.delete(client))
    void writeFrame(client, status).catch(() => client.destroy())
    for (const frame of cache.values()) void writeFrame(client, frame).catch(() => client.destroy())
    readFrames(client, async frame => {
      if (frame.type === 'toggle') {
        if (ready && voice) await voice.toggle()
        else await writeFrame(client, status)
        return
      }
      if (!FORWARD.has(frame.type)) { client.destroy(); return }
      if (!ready) {
        if (frame.type === 'text') await writeFrame(client, { v: 1, type: 'text_receipt', requestId: frame.requestId, accepted: false })
        else await writeFrame(client, status)
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
