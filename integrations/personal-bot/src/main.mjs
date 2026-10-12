import { createPersonalBotComposition, loadPersonalBotPluginConfig } from './plugin-composition.mjs'
import { loadPersonalBotReplacements } from './development-plugins.mjs'
import { parseArgs } from 'node:util'
import { migratePersonalBotState, personalBotEnvironment } from './personal-bot-migration.mjs'
import { readdir, rm, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createPersonalBot } from './agent.mjs'
import { record } from './recorder.mjs'
import { transcribe, transcriptionProvider, transcriptionLanguage, transcriptionPrompt, isLoopbackUrl, isDeviceLocalStt } from './transcribe.mjs'
import { PersonalBotService } from './service.mjs'
import { channelTokenFile, listen, personalBotEndpoint, personalBotControlEndpoint } from './socket.mjs'
import { prepareHostDirectories } from './host-paths.mjs'
import { loadPersonalConfig } from './personal-config.mjs'
import { proposalStateStore } from './proactive-state.mjs'
import { ProactiveWatch, loadProactiveConfig, ownerConfigWriter } from './proactive.mjs'
import { createJevJudge } from './proactive-jev.mjs'
import { odkDataRequest } from './odk-data.mjs'
import { loadTargets, taskRequest } from './task-client.mjs'
import { rideNotification } from './ride-notification.mjs'
import { HomeBriefing } from './home-briefing.mjs'

async function initialize(env, report, onRideUpdate, platform = process.platform, getWatch = undefined, signal = undefined) {
  signal?.throwIfAborted()
  report('Check ODK_PERSONAL_BOT_CONFIG: personal profile, reviewed Skills, private MEMORY and DiDi credential path; restart service')
  const personal = await loadPersonalConfig(env)
  signal?.throwIfAborted()
  report('Set ODK_WORKSPACE to the shared Open DeskOS writable checkout; restart service')
  if (personal.profile === 'coding' && !env.ODK_WORKSPACE) throw Error('Workspace missing')
  // The provider declares the request shape the endpoint expects, so a desk that
  // sends JSON instead of a multipart upload, or the other way round, is a stated
  // configuration rather than a guess made from a URL.
  const provider = transcriptionProvider(env.ODK_PERSONAL_BOT_STT_PROVIDER)
  report(provider === 'aliyun'
    ? 'Set ODK_PERSONAL_BOT_STT_URL to a DashScope multimodal-generation endpoint, and ALIYUNCS_TOKEN to its bearer credential; restart service'
    : 'Set ODK_PERSONAL_BOT_STT_URL to an HTTPS transcription endpoint, or ODK_STT_PORT for the device-local bridge; no URL credentials')
  // The bridge port is declared once by the service that binds it. Deriving the endpoint from that
  // same value is what keeps the desk from restating one port in two files, and an unreadable value
  // stops startup instead of quietly sending audio to a remote endpoint.
  const sttPort = env.ODK_STT_PORT ? env.ODK_STT_PORT : undefined
  if (sttPort !== undefined && !/^\d{1,5}$/.test(sttPort)) {
    report('Set ODK_STT_PORT to a port number such as 17840; restart service')
    throw Error('Invalid transcription port')
  }
  const url = new URL(env.ODK_PERSONAL_BOT_STT_URL || (provider === 'aliyun'
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
      report('Set ODK_PERSONAL_BOT_STT_KEY_FILE to a readable credential file; restart service')
      if (!env.ODK_PERSONAL_BOT_STT_KEY_FILE) throw Error('Credential missing')
      await access(env.ODK_PERSONAL_BOT_STT_KEY_FILE)
    }
  }
  report('Set ODK_PERSONAL_BOT_STT_LANGUAGE to a two or three lowercase letter language code such as zh or en, or auto; restart service')
  const language = transcriptionLanguage(env.ODK_PERSONAL_BOT_STT_LANGUAGE)
  report('Set ODK_PERSONAL_BOT_STT_PROMPT to at most 1024 characters, or empty to disable context; restart service')
  const prompt = transcriptionPrompt(env.ODK_PERSONAL_BOT_STT_PROMPT)
  if (platform === 'win32') {
    // DirectShow names a microphone the way Windows reports it, and ffmpeg takes
    // the device name itself: the value is what ffmpeg lists, without the audio=
    // input prefix it adds. The Unix default device name means nothing to it, so an
    // unset or default value is a configuration error rather than a capture that
    // silently opens nothing.
    report('Set ODK_PERSONAL_BOT_AUDIO_DEVICE to a DirectShow device name such as "Microphone (2- USB Audio Device)", without the audio= prefix; restart service')
    if (!env.ODK_PERSONAL_BOT_AUDIO_DEVICE || env.ODK_PERSONAL_BOT_AUDIO_DEVICE === 'default') throw Error('Microphone device missing')
  }
  const directories = await prepareHostDirectories(env, platform)
  signal?.throwIfAborted()
  report('Check Jev credential (TYPESAFE_API_KEY or ODK_JEV_KEY_FILE), writable checkout, Pi authentication/model and capability paths; restart service')
  const agent = await createPersonalBot({
    workspace: env.ODK_WORKSPACE,
    stateDir: directories.state,
    model: env.ODK_PERSONAL_BOT_MODEL,
    capabilityPaths: personal.profile === 'coding' && env.ODK_PERSONAL_BOT_CAPABILITIES ? JSON.parse(env.ODK_PERSONAL_BOT_CAPABILITIES) : [],
    personal, onRideUpdate, getWatch, env, signal,
  })
  return {
    agent,
    stt: {
      url: url.href,
      provider,
      model: env.ODK_PERSONAL_BOT_STT_MODEL || (provider === 'aliyun' ? 'qwen3-asr-flash' : 'whisper-1'),
      keyFile: env.ODK_PERSONAL_BOT_STT_KEY_FILE,
      language,
      prompt,
    },
  }
}

async function main() {
  process.umask(0o077)
  const { values } = parseArgs({ options: {
    'plugin-selection': { type: 'string' }, 'trust-plugins': { type: 'boolean', default: false },
    plugins: { type: 'string' },
  } })
  if (values.plugins && !['list', 'validate'].includes(values.plugins)) throw Error('invalid resident inspection command')
  if (values['trust-plugins'] && !values['plugin-selection']) throw Error('resident trust requires a startup selection')
  const replacementPlugins = values['plugin-selection']
    ? loadPersonalBotReplacements(values['plugin-selection'], { trusted: values['trust-plugins'] }) : []
  const env = personalBotEnvironment(process.env)
  const platform = process.platform
  const control = { endpoint: personalBotControlEndpoint(env, platform), stateDir: dirname(channelTokenFile(env, platform)), platform }
  const disabled = loadPersonalBotPluginConfig().resolveStartupDisabled(env)
  if (values.plugins) {
    const unavailable = () => { throw Error('inspection must not start providers') }
    const inspection = createPersonalBotComposition({ replacementPlugins, disabled, control,
      createService: unavailable, openChannel: unavailable, initialize: unavailable,
      createHome: unavailable, ...(env.ODK_PROACTIVE_CONFIG ? { createWatch: unavailable } : {}),
    })
    inspection.validate()
    console.info(JSON.stringify({ host: 'personal-agent', instance: 'personal-bot', scope: 'declarations',
      validated: values.plugins === 'validate', plugins: inspection.catalog() }))
    return
  }
  await migratePersonalBotState(env)
  // The voice link is a runtime channel, so the host's own naming decides where it
  // is bound: a socket in the runtime directory, or the personal-bot named pipe
  // that a channel token authenticates.
  const endpoint = personalBotEndpoint(env, platform)
  if (!endpoint) throw Error('Runtime directory required')
  const directory = (await prepareHostDirectories(env, platform)).captures
  let runtime
  let watch
  let home
  let service
  const composition = createPersonalBotComposition({
    replacementPlugins, disabled, control,
    onService(value) { service = value },
    createService() {
      service = new PersonalBotService({
        failureMessage: '请求未完成。若涉及打车，请先查询订单状态，不要重复下单。',
        record: async onLevel => {
          if (!runtime) throw Error('Configuration incomplete')
          return record(directory, env.ODK_PERSONAL_BOT_AUDIO_DEVICE || 'default', onLevel, { platform })
        },
        transcribe: (path, signal) => transcribe(path, runtime.stt, signal),
        prompt: (text, onResponseSnapshot) => runtime.agent.prompt(text, onResponseSnapshot),
      })
      service.setState('error', 'Configure Open DeskOS workspace, STT credential and Pi authentication; restart service')
      const originalToggle = service.toggle.bind(service)
      service.toggle = async () => { if (runtime) await originalToggle() }
      return service
    },
    async openChannel(service) {
      const server = await listen(endpoint, service, { platform, tokenFile: channelTokenFile(env, platform), runtimeSnapshot: () => composition.catalog() })
      return {
        close: () => server.close(),
        async prepare() {
          for (const name of await readdir(directory)) {
            if (name.startsWith('capture-')) await rm(join(directory, name), { recursive: true, force: true })
          }
        },
      }
    },
    initialize: (service, context) => initialize(env, message => service.setState('error', message), snapshot => {
      const message = rideNotification(snapshot)
      if (message) service.notify(message)
    }, platform, () => watch, context.signal),
    onRuntime(value, context) {
      runtime = value
      if (runtime) service.setState('idle')
      else if (!context.stopping) service.setState('error', 'Personal Bot runtime unavailable')
    },
    createHome(_runtime, _service) {
      home = new HomeBriefing({
        requireBindings: true,
        list: async signal => (await odkDataRequest('list', { signal, env, platform })).readings,
        read: async (id, signal) => (await odkDataRequest('read', { id, signal, env, platform })).reading,
        generate: runtime.agent.generateBriefing,
        publish: frame => service.publishBriefing(frame),
      })
      return home
    },
    onHome(value, service, context) {
      home = value
      service.attachHome(home)
      context.onCleanup(() => { service.attachHome(undefined); home = undefined })
    },
    ...(env.ODK_PROACTIVE_CONFIG ? { async createWatch(_runtime, _service) {
      const config = loadProactiveConfig(env.ODK_PROACTIVE_CONFIG)
      const targets = await loadTargets(env.ODK_TASK_TARGETS_FILE)
      const state = proposalStateStore(join((await prepareHostDirectories(env, platform)).state, 'proactive', 'state.json'))
      watch = new ProactiveWatch({ config, loadState: state.load, saveState: state.save,
        generate: runtime.agent.generateProposals,
        onGeneration: record => console.info(JSON.stringify({ event: 'proactive_generation', model: runtime.agent.generationModel, ...record })),
        judge: createJevJudge({ env }),
        onJudgment: record => console.info(JSON.stringify({ event: 'proactive_jev', ...record })),
        read: async (id, signal) => (await odkDataRequest('read', { id, signal, env, platform })).reading,
        save: ownerConfigWriter(env.ODK_PROACTIVE_CONFIG, config),
        phrase: runtime.agent.phraseProposal,
        execute: runtime.agent.executeProposal,
        codingList: async (scope, signal) => {
          const target = targets.find(target => target.id === scope.target)
          if (!target) throw Error('Coding target unavailable')
          return (await taskRequest(target, { command: 'list', project: scope.project }, signal)).tasks
        },
        codingStatus: async (identity, signal) => {
          const target = targets.find(target => target.id === identity.target)
          if (!target) throw Error('Coding target unavailable')
          return (await taskRequest(target, { ...identity, command: 'status' }, signal)).task
        },
        publish: frame => service.propose(frame),
      })
      return watch
    } } : {}),
    onWatch(value, service, context) {
      watch = value
      service.attachWatch(watch)
      context.onCleanup(() => { service.attachWatch(undefined); watch = undefined })
      context.onCleanup(service.subscribe(status => {
        const busy = service.starting || !['idle', 'error'].includes(status.state)
        if (watch.busy !== busy) watch.setBusy(busy)
      }))
    },
    onError(id) {
      if (id === 'odk.personal-bot.watch') service.notify('主动建议未启用：请检查私有 owner 配置和 Jev 凭据并重启服务。')
      // Configuration reports remain actionable; SDK errors stay private.
    },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void composition.stop().catch(() => { process.exitCode = 1 }) })
  }
  await composition.start()
}

main().catch(() => {
  console.error('Personal Bot startup failed; check runtime directory and configuration')
  process.exitCode = 1
})
