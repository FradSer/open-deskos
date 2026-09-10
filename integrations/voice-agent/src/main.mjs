import { readdir, rm, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createVoiceAgent } from './agent.mjs'
import { record } from './recorder.mjs'
import { transcribe } from './transcribe.mjs'
import { VoiceService } from './service.mjs'
import { listen } from './socket.mjs'

function isLoopbackHttp(url) {
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === 'localhost.' || host === '::1' || host === '[::1]') return true
  const octets = host.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) < 256)
}

async function initialize(env, report) {
  report('Set ODESK_WORKSPACE to the shared Open DeskOS writable checkout; restart service')
  if (!env.ODESK_WORKSPACE) throw Error('Workspace missing')
  report('Set ODESK_VOICE_STT_KEY_FILE to a readable credential file; restart service')
  if (!env.ODESK_VOICE_STT_KEY_FILE) throw Error('Credential missing')
  await access(env.ODESK_VOICE_STT_KEY_FILE)
  report('Set ODESK_VOICE_STT_URL to an HTTPS transcription endpoint, or plain HTTP loopback for device-local speech; no URL credentials')
  const url = new URL(env.ODESK_VOICE_STT_URL || 'https://api.openai.com/v1/audio/transcriptions')
  if (url.username || url.password) throw Error('Invalid transcription URL')
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) throw Error('Invalid transcription URL')
  report('Check writable checkout and widget skill, Pi user authentication/model, and trusted capability paths; restart service')
  const agent = await createVoiceAgent({
    workspace: env.ODESK_WORKSPACE,
    stateDir: join(env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'open-deskos-voice'),
    model: env.ODESK_VOICE_MODEL,
    capabilityPaths: env.ODESK_VOICE_CAPABILITIES ? JSON.parse(env.ODESK_VOICE_CAPABILITIES) : [],
  })
  return { agent, stt: { url: url.href, model: env.ODESK_VOICE_STT_MODEL || 'whisper-1', keyFile: env.ODESK_VOICE_STT_KEY_FILE } }
}

async function main() {
  process.umask(0o077)
  const env = process.env
  if (!env.XDG_RUNTIME_DIR) throw Error('XDG_RUNTIME_DIR required')
  const directory = join(env.XDG_RUNTIME_DIR, 'open-deskos-voice')
  let runtime
  const service = new VoiceService({
    record: async () => {
      if (!runtime) throw Error('Configuration incomplete')
      return record(directory, env.ODESK_VOICE_AUDIO_DEVICE || 'default')
    },
    transcribe: (path, signal) => transcribe(path, runtime.stt, signal),
    prompt: text => runtime.agent.prompt(text),
  })
  service.setState('error', 'Configure Open DeskOS workspace, STT credential and Pi authentication; restart service')
  const server = await listen(join(directory, 'agent.sock'), service)
  const originalToggle = service.toggle.bind(service)
  service.toggle = async () => { if (runtime) await originalToggle() }
  for (const name of await readdir(directory)) {
    if (name.startsWith('capture-')) await rm(join(directory, name), { recursive: true, force: true })
  }
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    await runtime?.agent.abort()
    await service.close()
    runtime?.agent.close()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().catch(() => { process.exitCode = 1 }) })
  try {
    runtime = await initialize(env, message => service.setState('error', message))
    if (closing) runtime.agent.close()
    else service.setState('idle')
  } catch {
    // Keep the safe, actionable initialization-stage message; never expose SDK errors.
  }
}

main().catch(() => {
  console.error('Voice agent startup failed; check runtime directory and configuration')
  process.exitCode = 1
})
