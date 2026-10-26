import {createPiConfig} from './pi-config.mjs'
import { cleanStaleCaptures } from './capture-cleanup.mjs'
import { createConversationProjection } from './conversation-projection.mjs'
import { createRemoteVoice } from './remote-voice.mjs'
import {createOptionalJevHealthCheck} from './judgment-client.mjs'
import { createPersonalAgentComposition, loadPersonalAgentPluginConfig } from './plugin-composition.mjs'
import { loadPersonalAgentReplacements } from './development-plugins.mjs'
import { parseArgs } from 'node:util'
import { migratePersonalAgentState, personalAgentEnvironment } from './personal-agent-migration.mjs'
import { realpath, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createPersonalAgent } from './agent.mjs'
import { record } from './recorder.mjs'
import { transcribe, transcriptionProvider, transcriptionLanguage, transcriptionPrompt, isLoopbackUrl, isDeviceLocalStt } from './transcribe.mjs'
import { PersonalAgentService } from './service.mjs'
import { channelTokenFile, listen, personalAgentEndpoint, personalAgentControlEndpoint } from './socket.mjs'
import { prepareHostDirectories } from './host-paths.mjs'
import { loadPersonalConfig } from './personal-config.mjs'
import { proposalStateStore } from './proactive-state.mjs'
import { ProactiveWatch, loadProactiveConfig, ownerConfigWriter } from './proactive.mjs'
import { checkJevAuthentication } from './jev-client.mjs'
import { createJevJudge } from './proactive-jev.mjs'
import { odkDataRequest } from './odk-data.mjs'
import { loadTargets, taskRequest } from './task-client.mjs'
import { createRideNotifier } from './ride-notification.mjs'
import { attachRemoteConversation } from './remote-pi-reader.mjs'
import { HomeBriefing } from './home-briefing.mjs'
import { createTaskReadings, createRemoteReadings } from './producer-readings.mjs'

async function initialize(env, report, onRideUpdate, platform = process.platform, getWatch = undefined, signal = undefined, onAgentUpdate = undefined, onRemoteUpdate = undefined) {
  signal?.throwIfAborted()
  report('Check ODK_PERSONAL_AGENT_CONFIG: personal profile, reviewed Skills, private MEMORY and DiDi credential path; restart service')
  const personal = await loadPersonalConfig(env)
  signal?.throwIfAborted()
  report('Set ODK_WORKSPACE to the shared Open DeskOS writable checkout; restart service')
  if (personal.profile === 'coding' && !env.ODK_WORKSPACE) throw Error('Workspace missing')
  let voiceGuidance = 'Voice input is unavailable. Check its configuration.'
  const voiceReport = message => { voiceGuidance = message }
  async function prepareVoice() {
    voiceReport('Set ODK_PERSONAL_AGENT_STT_PROVIDER to openai or aliyun; restart service')
    // The provider declares the request shape the endpoint expects, so a desk that
    // sends JSON instead of a multipart upload, or the other way round, is a stated
    // configuration rather than a guess made from a URL.
    const provider = transcriptionProvider(env.ODK_PERSONAL_AGENT_STT_PROVIDER)
    voiceReport(provider === 'aliyun'
      ? 'Set ODK_PERSONAL_AGENT_STT_URL to a DashScope multimodal-generation endpoint, and ALIYUNCS_TOKEN to its bearer credential; restart service'
      : 'Set ODK_PERSONAL_AGENT_STT_URL to an HTTPS transcription endpoint, or ODK_STT_PORT for the device-local bridge; no URL credentials')
    // The bridge port is declared once by the service that binds it. Deriving the endpoint from that
    // same value is what keeps the desk from restating one port in two files, and an unreadable value
    // disables voice instead of sending audio to another endpoint.
    const sttPort = env.ODK_STT_PORT ? env.ODK_STT_PORT : undefined
    if (sttPort !== undefined && !/^\d{1,5}$/.test(sttPort)) {
      voiceReport('Set ODK_STT_PORT to a port number such as 17840; restart service')
      throw Error('Invalid transcription port')
    }
    const url = new URL(env.ODK_PERSONAL_AGENT_STT_URL || (provider === 'aliyun'
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
        voiceReport('Set ALIYUNCS_TOKEN to the Alibaba Cloud bearer credential; restart service')
        if (!env.ALIYUNCS_TOKEN || !env.ALIYUNCS_TOKEN.trim()) throw Error('Credential missing')
      } else {
        voiceReport('Set ODK_PERSONAL_AGENT_STT_KEY_FILE to a readable credential file; restart service')
        if (!env.ODK_PERSONAL_AGENT_STT_KEY_FILE) throw Error('Credential missing')
        await access(env.ODK_PERSONAL_AGENT_STT_KEY_FILE)
      }
    }
    voiceReport('Set ODK_PERSONAL_AGENT_STT_LANGUAGE to a two or three lowercase letter language code such as zh or en, or auto; restart service')
    const language = transcriptionLanguage(env.ODK_PERSONAL_AGENT_STT_LANGUAGE)
    voiceReport('Set ODK_PERSONAL_AGENT_STT_PROMPT to at most 1024 characters, or empty to disable context; restart service')
    const prompt = transcriptionPrompt(env.ODK_PERSONAL_AGENT_STT_PROMPT)
    if (platform === 'win32') {
      // DirectShow names a microphone the way Windows reports it, and ffmpeg takes
      // the device name itself: the value is what ffmpeg lists, without the audio=
      // input prefix it adds. The Unix default device name means nothing to it, so an
      // unset or default value is a configuration error rather than a capture that
      // silently opens nothing.
      voiceReport('Set ODK_PERSONAL_AGENT_AUDIO_DEVICE to a DirectShow device name such as "Microphone (2- USB Audio Device)", without the audio= prefix; restart service')
      if (!env.ODK_PERSONAL_AGENT_AUDIO_DEVICE || env.ODK_PERSONAL_AGENT_AUDIO_DEVICE === 'default') throw Error('Microphone device missing')
    }
    return {
      url: url.href,
      provider,
      model: env.ODK_PERSONAL_AGENT_STT_MODEL || (provider === 'aliyun' ? 'qwen3-asr-flash' : 'whisper-1'),
      keyFile: env.ODK_PERSONAL_AGENT_STT_KEY_FILE,
      language,
      prompt,
    }
  }
  let stt
  try { stt = await prepareVoice() }
  catch { stt = { unavailable: true, message: voiceGuidance } }
  const directories = await prepareHostDirectories(env, platform)
  signal?.throwIfAborted()
  report('Check model providers, writable checkout, Pi authentication/model and capability paths; restart service')
  const agent = await createPersonalAgent({
    workspace: env.ODK_WORKSPACE,
    stateDir: directories.state,
    capabilityPaths: personal.profile === 'coding' && env.ODK_PERSONAL_AGENT_CAPABILITIES ? JSON.parse(env.ODK_PERSONAL_AGENT_CAPABILITIES) : [],
    personal, onRideUpdate, onAgentUpdate, getWatch, env, signal,
  })
  const remote = await attachRemoteConversation({agent,env,stateDir:directories.state,publish:onRemoteUpdate})
  return {
    agent, remote,
    stt,
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
    ? loadPersonalAgentReplacements(values['plugin-selection'], { trusted: values['trust-plugins'] }) : []
  const env = personalAgentEnvironment(process.env)
  const platform = process.platform
  const control = { endpoint: personalAgentControlEndpoint(env, platform), stateDir: dirname(channelTokenFile(env, platform)), platform }
  let intentSelected = false
  try { intentSelected = (await loadPersonalConfig(env)).agentPlugins?.enabled.includes('intent') ?? false } catch { /* Runtime reports invalid profile through its existing boundary. */ }
  const disabled = loadPersonalAgentPluginConfig().resolveStartupDisabled(env)
  if (values.plugins) {
    const unavailable = () => { throw Error('inspection must not start providers') }
    const inspection = createPersonalAgentComposition({ replacementPlugins, disabled, control,
      createService: unavailable, openChannel: unavailable, initialize: unavailable,
      createTaskReadings: unavailable, createRemoteReadings: unavailable,
      createHome: unavailable, ...((env.ODK_PROACTIVE_CONFIG || env.ODK_PRIVATE_RECOMMENDATIONS_FILE || intentSelected) ? { createWatch: unavailable } : {}),
    })
    inspection.validate()
    console.info(JSON.stringify({ host: 'personal-agent', instance: 'personal-agent', scope: 'declarations',
      validated: values.plugins === 'validate', plugins: inspection.catalog() }))
    return
  }
  if (platform === 'win32') throw Error('Windows must use the CM5 display client')
  await migratePersonalAgentState(env)
  // The voice link is a runtime channel, so the host's own naming decides where it
  // is bound: a socket in the runtime directory, or the personal-agent named pipe
  // that a channel token authenticates.
  const endpoint = personalAgentEndpoint(env, platform)
  if (!endpoint) throw Error('Runtime directory required')
  const directories = await prepareHostDirectories(env, platform)
  const directory = await realpath(directories.captures)
  let runtime
  let watch
  let home
  let service
  const piConfig=createPiConfig({getSelection:()=>runtime?.agent.selection,
    isBusy:()=>Boolean(service?.starting || service && !['idle','error'].includes(service.status.state) || watch?.busy || watch?.responding || watch?.running || home?.pending || runtime?.agent.configurationBusy),
    onBusy:busy=>{runtime?.agent.setConfigurationHeld?.(busy);watch?.setBusy(busy || !['idle','error'].includes(service?.status.state))},
    async onChange(change) {
      if(change.authentication) {
        if(!runtime) {
          await composition.setEnabled('odk.personal-agent.runtime',false)
          await composition.setEnabled('odk.personal-agent.runtime',true)
        }
        if(runtime) {
          await runtime.agent.refreshAuthentication()
          const health = await service.refreshJevAuthentication()
          runtime.agent.resetJevHealth(health)
        }
      } else if(runtime) await runtime.agent.configureSelection(change)
    }})
  const notifyRide = createRideNotifier(message => service?.notify(message))
  const composition = createPersonalAgentComposition({
    replacementPlugins, disabled, control,
    onService(value) { service = value },
    createService() {
      service = new PersonalAgentService({
        getJudgmentStatus: () => runtime?.agent.judgmentStatus,
        checkJev: createOptionalJevHealthCheck({check: signal => checkJevAuthentication({env, signal}), getAgent: () => runtime?.agent}),
        failureMessage: '请求未完成。若涉及打车，请先查询订单状态，不要重复下单。',
        record: async onLevel => {
          if (!runtime) throw Error('Configuration incomplete')
          if (runtime.stt.unavailable) throw Error('Voice configuration unavailable')
          return record(directory, env.ODK_PERSONAL_AGENT_AUDIO_DEVICE || 'default', onLevel, { platform })
        },
        transcribe: (path, signal) => transcribe(path, runtime.stt, signal),
        prompt: (text, onResponseSnapshot, reply, owner) => runtime.agent.prompt(text, onResponseSnapshot, reply, owner),
      })
      service.setState('error', 'Configure Open DeskOS workspace, STT credential and Pi authentication; restart service')
      const originalToggle = service.toggle.bind(service)
      service.toggle = async () => {
        if (!runtime || piConfig.busy) return
        if (runtime.stt.unavailable) { service.setState('error', runtime.stt.message); return }
        await originalToggle()
      }
      if (typeof service.reserveRemoteRecording === 'function') {
        const originalReserve = service.reserveRemoteRecording.bind(service)
        service.reserveRemoteRecording = (...args) => Boolean(runtime && !runtime.stt.unavailable) && !piConfig.busy && originalReserve(...args)
      }
      const originalText=service.sendText.bind(service)
      service.sendText=(text,reply,applications)=>piConfig.busy?false:originalText(text,reply,applications)
      return service
    },
    async openChannel(service) {
      await cleanStaleCaptures(directory)
      const conversation = await createConversationProjection({ file: join(directories.state, 'conversation-public.json') })
      const remoteVoice = typeof service.reserveRemoteRecording === 'function' && typeof service.cancelRemoteRecording === 'function'
        ? createRemoteVoice({ service, directory }) : undefined
      const unsubscribe = service.subscribe(status => { if (!service.closed) conversation.observe(status) })
      let server
      try { server = await listen(endpoint, service, { conversation, remoteVoice, piConfig, platform, tokenFile: channelTokenFile(env, platform), runtimeSnapshot: () => composition.catalog() }) } catch (error) { unsubscribe(); await remoteVoice?.close(); throw error }
      return {
        async close() {
          unsubscribe()
          try { await server.close() } finally { await conversation.close() }
        },

      }
    },
    initialize: (service, context) => initialize(env, message => service.setState('error', message), notifyRide, platform, () => watch, context.signal, tasks => service.publishAgents(tasks), frame => service.publishRemote(frame)),
    onRuntime(value, context) {
      runtime = value
      runtime?.agent.setConfigurationHeld?.(piConfig.busy)
      service.attachRemoteUpdates(runtime?.remote)
      service.publishAgents(runtime ? runtime.agent.agentTasks?.activity() ?? [] : undefined)
      if (runtime) { if (service.jev) runtime.agent.setJevHealth?.(service.jev); service.setState('idle') }
      else if (!context.stopping) service.setState('error', 'Personal Agent runtime unavailable')
    },
    createTaskReadings: runtime => createTaskReadings(runtime.agent.agentTasks),
    createRemoteReadings: runtime => createRemoteReadings(runtime.remote),
    createHome(_runtime, _service) {
      home = new HomeBriefing({
        requireBindings: true,
        list: async signal => (await odkDataRequest('list', { signal, env, platform })).readings,
        read: async (id, signal) => (await odkDataRequest('read', { id, signal, env, platform })).reading,
        generate: runtime.agent.generateBriefing,
        publish: frame => service.publishBriefing(frame),
        onFailure: failure => console.warn(JSON.stringify({ event: 'home_briefing_failure', ...failure })),
      })
      return home
    },
    onHome(value, service, context) {
      home = value
      service.attachHome(home)
      context.onCleanup(() => { service.attachHome(undefined); home = undefined })
    },
    ...((env.ODK_PROACTIVE_CONFIG || env.ODK_PRIVATE_RECOMMENDATIONS_FILE || intentSelected) ? { async createWatch(_runtime, _service) {
      const config = env.ODK_PROACTIVE_CONFIG ? loadProactiveConfig(env.ODK_PROACTIVE_CONFIG) : { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }
      const targets = await loadTargets(env.ODK_TASK_TARGETS_FILE)
      const state = proposalStateStore(join((await prepareHostDirectories(env, platform)).state, 'proactive', 'state.json'))
      watch = new ProactiveWatch({ config, intents: runtime.agent.intents, privateSources: runtime.agent.privateSources, loadState: state.load, saveState: state.save,
        generate: runtime.agent.generateProposals,
        refineFeedbackMemory: runtime.agent.refineFeedbackMemory,
        feedbackMemoryEnabled: runtime.agent.feedbackMemoryEnabled === true,
        onGeneration: record => console.info(JSON.stringify({ event: 'proactive_generation', model: runtime.agent.generationModel, ...record })),
        judge: createJevJudge({ env, request: runtime.agent.judge }),
        onJudgment: record => console.info(JSON.stringify({ event: 'proactive_judgment', ...record })),
        ...{ onFeedback: record => console.info(JSON.stringify({ event: 'proactive_feedback', ...record })) },
        read: async (id, signal) => (await odkDataRequest('read', { id, signal, env, platform })).reading,
        save: env.ODK_PROACTIVE_CONFIG ? ownerConfigWriter(env.ODK_PROACTIVE_CONFIG, config) : async () => { throw Error('No owner rule file selected') },
        phrase: runtime.agent.phraseProposal,
        execute: runtime.agent.executeProposal,
        canExecute: action => runtime?.agent?.canExecuteProposal?.(action) === true,
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
      if (id === 'odk.personal-agent.watch') service.notify('主动建议未启用：请检查私有 owner 配置、数据来源和模型连接并重启服务。')
      // Configuration reports remain actionable; SDK errors stay private.
    },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void Promise.all([piConfig.close(), composition.stop()]).catch(() => { process.exitCode = 1 }) })
  }
  await composition.start()
}

main().catch(() => {
  console.error('Personal Agent startup failed; check runtime directory and configuration')
  process.exitCode = 1
})
