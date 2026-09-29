import { readdir, rm, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createVoiceAgent } from './agent.mjs'
import { record } from './recorder.mjs'
import { transcribe, transcriptionProvider, transcriptionLanguage, transcriptionPrompt, isLoopbackUrl, isDeviceLocalStt } from './transcribe.mjs'
import { VoiceService } from './service.mjs'
import { channelTokenFile, listen, voiceEndpoint } from './socket.mjs'
import { prepareHostDirectories } from './host-paths.mjs'
import { loadPersonalConfig } from './personal-config.mjs'
import { rideNotification } from './ride-notification.mjs'

async function initialize(env, report, onRideUpdate, platform = process.platform) {
  report('Check ODESK_VOICE_AGENT_CONFIG: personal profile, reviewed Skills, private MEMORY and DiDi credential path; restart service')
  const personal = await loadPersonalConfig(env)
  report('Set ODESK_WORKSPACE to the shared Open DeskOS writable checkout; restart service')
  if (personal.profile === 'coding' && !env.ODESK_WORKSPACE) throw Error('Workspace missing')
  // The provider declares the request shape the endpoint expects, so a desk that
  // sends JSON instead of a multipart upload, or the other way round, is a stated
  // configuration rather than a guess made from a URL.
  const provider = transcriptionProvider(env.ODESK_VOICE_STT_PROVIDER)
  report(provider === 'aliyun'
    ? 'Set ODESK_VOICE_STT_URL to a DashScope multimodal-generation endpoint, and ALIYUNCS_TOKEN to its bearer credential; restart service'
    : 'Set ODESK_VOICE_STT_URL to an HTTPS transcription endpoint, or ODK_STT_PORT for the device-local bridge; no URL credentials')
  // The bridge port is declared once by the service that binds it. Deriving the endpoint from that
  // same value is what keeps the desk from restating one port in two files, and an unreadable value
  // stops startup instead of quietly sending audio to a remote endpoint.
  const sttPort = env.ODK_STT_PORT ? env.ODK_STT_PORT : undefined
  if (sttPort !== undefined && !/^\d{1,5}$/.test(sttPort)) {
    report('Set ODK_STT_PORT to a port number such as 17840; restart service')
    throw Error('Invalid transcription port')
  }
  const url = new URL(env.ODESK_VOICE_STT_URL || (provider === 'aliyun'
    ? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    : sttPort ? `http://127.0.0.1:${sttPort}/inference` : 'https://api.openai.com/v1/audio/transcriptions'))
  if (url.username || url.password) throw Error('Invalid transcription URL')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackUrl(url))) throw Error('Invalid transcription URL')
  // The device-local bridge ignores a bearer, so a desk that transcribes through it needs no
  // credential file at all. Every other endpoint still proves its credential before starting.
  if (!isDeviceLocalStt(url)) {
    if (provider === 'aliyun') {
      // The cloud provider's own bearer is one device-local environment value, so
      // a desk carries it where its other cloud credentials already live instead
      // of restating it in a second file only this service can read.
      report('Set ALIYUNCS_TOKEN to the Alibaba Cloud bearer credential; restart service')
      if (!env.ALIYUNCS_TOKEN || !env.ALIYUNCS_TOKEN.trim()) throw Error('Credential missing')
    } else {
      report('Set ODESK_VOICE_STT_KEY_FILE to a readable credential file; restart service')
      if (!env.ODESK_VOICE_STT_KEY_FILE) throw Error('Credential missing')
      await access(env.ODESK_VOICE_STT_KEY_FILE)
    }
  }
  report('Set ODESK_VOICE_STT_LANGUAGE to a two or three lowercase letter language code such as zh or en, or auto; restart service')
  const language = transcriptionLanguage(env.ODESK_VOICE_STT_LANGUAGE)
  report('Set ODESK_VOICE_STT_PROMPT to at most 1024 characters, or empty to disable context; restart service')
  const prompt = transcriptionPrompt(env.ODESK_VOICE_STT_PROMPT)
  if (platform === 'win32') {
    // DirectShow names a microphone the way Windows reports it, and ffmpeg takes
    // the device name itself: the value is what ffmpeg lists, without the audio=
    // input prefix it adds. The Unix default device name means nothing to it, so an
    // unset or default value is a configuration error rather than a capture that
    // silently opens nothing.
    report('Set ODESK_VOICE_AUDIO_DEVICE to a DirectShow device name such as "Microphone (2- USB Audio Device)", without the audio= prefix; restart service')
    if (!env.ODESK_VOICE_AUDIO_DEVICE || env.ODESK_VOICE_AUDIO_DEVICE === 'default') throw Error('Microphone device missing')
  }
  const directories = await prepareHostDirectories(env, platform)
  report('Check writable checkout and widget skill, Pi user authentication/model, and trusted capability paths; restart service')
  const agent = await createVoiceAgent({
    workspace: env.ODESK_WORKSPACE,
    stateDir: directories.state,
    model: env.ODESK_VOICE_MODEL,
    capabilityPaths: personal.profile === 'coding' && env.ODESK_VOICE_CAPABILITIES ? JSON.parse(env.ODESK_VOICE_CAPABILITIES) : [],
    personal, onRideUpdate,
  })
  return {
    agent,
    stt: {
      url: url.href,
      provider,
      model: env.ODESK_VOICE_STT_MODEL || (provider === 'aliyun' ? 'qwen3-asr-flash' : 'whisper-1'),
      keyFile: env.ODESK_VOICE_STT_KEY_FILE,
      language,
      prompt,
    },
  }
}

async function main() {
  process.umask(0o077)
  const env = process.env
  const platform = process.platform
  // The voice link is a runtime channel, so the host's own naming decides where it
  // is bound: a socket in the runtime directory, or the voice-agent named pipe
  // that a channel token authenticates.
  const endpoint = voiceEndpoint(env, platform)
  if (!endpoint) throw Error('Runtime directory required')
  const directory = (await prepareHostDirectories(env, platform)).captures
  let runtime
  const service = new VoiceService({
    failureMessage: '请求未完成。若涉及打车，请先查询订单状态，不要重复下单。',
    record: async onLevel => {
      if (!runtime) throw Error('Configuration incomplete')
      return record(directory, env.ODESK_VOICE_AUDIO_DEVICE || 'default', onLevel, { platform })
    },
    transcribe: (path, signal) => transcribe(path, runtime.stt, signal),
    prompt: (text, onResponseSnapshot) => runtime.agent.prompt(text, onResponseSnapshot),
  })
  service.setState('error', 'Configure Open DeskOS workspace, STT credential and Pi authentication; restart service')
  const server = await listen(endpoint, service, { platform, tokenFile: channelTokenFile(env, platform) })
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
    await runtime?.agent.close()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().catch(() => { process.exitCode = 1 }) })
  try {
    runtime = await initialize(env, message => service.setState('error', message), snapshot => {
      const message = rideNotification(snapshot)
      if (message) service.notify(message)
    })
    if (closing) await runtime.agent.close()
    else service.setState('idle')
  } catch {
    // Keep the safe, actionable initialization-stage message; never expose SDK errors.
  }
}

main().catch(() => {
  console.error('Voice agent startup failed; check runtime directory and configuration')
  process.exitCode = 1
})
