import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const BOT_PORTS = Object.freeze({
  service: 'odk:personal-bot/service/v1',
  channel: 'odk:personal-bot/channel/v1',
  runtime: 'odk:personal-bot/runtime/v1',
  home: 'odk:personal-bot/home/v1',
  watch: 'odk:personal-bot/watch/v1',
})

const componentDependencies = Object.freeze({
  service: [], channel: ['service'], runtime: ['service', 'channel'],
  home: ['service', 'runtime'], watch: ['service', 'runtime', 'home'],
})

export function personalBotManifest(name) {
  if (!Object.hasOwn(componentDependencies, name)) throw Error('unknown resident component')
  return {
    schemaVersion: 1, id: `odk.personal-bot.${name}`, name: `Personal Bot ${name}`, version: '1.0.0',
    kind: 'service', host: 'personal-agent', permissions: [],
    provides: [{ interface: BOT_PORTS[name] }],
    requires: componentDependencies[name].map(dependency => ({ interface: BOT_PORTS[dependency] })),
  }
}

export function validatePersonalBotReplacement(raw) {
  const { validatePluginManifest } = loadPersonalBotPluginHost()
  const manifest = validatePluginManifest(structuredClone(raw))
  const name = Object.keys(BOT_PORTS).find(name => manifest.id === `odk.personal-bot.${name}`)
  if (!name) throw Error('unknown resident replacement identity')
  const original = validatePluginManifest(personalBotManifest(name))
  const ports = list => list.map(port => `${port.interface}:${Boolean(port.optional)}`).sort()
  if (manifest.host !== original.host || manifest.kind !== original.kind || manifest.permissions.length
    || JSON.stringify(ports(manifest.provides)) !== JSON.stringify(ports(original.provides))
    || JSON.stringify(ports(manifest.requires)) !== JSON.stringify(ports(original.requires))) {
    throw Error('resident replacement changes component contract')
  }
  return manifest
}

export function loadPersonalBotPluginHost(base = import.meta.url) {
  return loadShellModule('plugin-host.js', base)
}

export function loadPersonalBotRuntimeReport(base = import.meta.url) {
  return loadShellModule('plugin-runtime-report.js', base)
}

export function loadPersonalBotPluginConfig(base = import.meta.url) {
  return loadShellModule('plugin-config.js', base)
}

export function loadPersonalBotManagementModules(base = import.meta.url) {
  return {
    ...loadShellModule('plugin-control.js', base),
    ...loadShellModule('odk-data-control.js', base),
    ...loadShellModule('platform/index.js', base),
  }
}

function loadShellModule(name, base) {
  const candidates = [`../../../runtime/shell/src/${name}`, `../../../src/${name}`]
    .map(relative => fileURLToPath(new URL(relative, base)))
  const source = candidates.find(candidate => existsSync(candidate))
  if (!source) throw Error(`Personal Bot requires the installed Shell module ${name}`)
  return require(source)
}

function once(operation) {
  let pending
  return () => {
    if (!pending) {
      try { pending = Promise.resolve(operation()) } catch (error) { pending = Promise.reject(error) }
      const attempt = pending
      void attempt.catch(() => { if (pending === attempt) pending = undefined })
    }
    return pending
  }
}

export function createPersonalBotComposition({ createService, openChannel, initialize, createHome, createWatch = undefined, onRuntime = (_runtime, _context = { stopping: false }) => {}, onError = (_id, _error) => {}, replacementPlugins = [], disabled = [], onService = (_service) => {}, onHome = (_home, _service, _context) => {}, onWatch = (_watch, _service, _context) => {}, control = undefined }) {
  const replacements = new Map()
  const active = new Set(['service', 'channel', 'runtime', ...(createHome ? ['home'] : []), ...(createWatch ? ['watch'] : [])].map(name => `odk.personal-bot.${name}`))
  for (const definition of replacementPlugins) {
    const manifest = validatePersonalBotReplacement(definition.manifest)
    if (!active.has(manifest.id) || replacements.has(manifest.id) || typeof definition.create !== 'function') throw Error('invalid or inactive resident replacement')
    replacements.set(manifest.id, { manifest, create: definition.create })
  }
  const selected = (name, context, fallback) => {
    const replacement = replacements.get(`odk.personal-bot.${name}`)
    return replacement ? replacement.create(context) : fallback()
  }
  let shuttingDown = false
  let shutdownErrors = []
  let stopPromise
  let closeHome
  const host = loadPersonalBotPluginHost().createPluginHost({
    disabled,
    onError(id, error) {
      if (shuttingDown) shutdownErrors.push(error)
      else onError(id, error)
    },
  })
  const serviceClosers = new WeakMap()
  let generation = 0
  const register = (name, create) => host.register({
    manifest: replacements.get(`odk.personal-bot.${name}`)?.manifest || personalBotManifest(name),
    create,
  })
  if (control) host.register({
    manifest: { schemaVersion: 1, id: 'odk.personal-bot.control', name: 'Personal Bot runtime control', version: '1.0.0',
      kind: 'system', host: 'personal-agent', provides: [], requires: [], permissions: [] },
    create(context) {
      let server
      context.onCleanup(async () => { if (server) { await server.close(); server = undefined } })
      return { async start() {
        if (context.signal.aborted) return
        const { createPluginControl } = loadShellModule('plugin-control.js', import.meta.url)
        const { listenOdkData } = loadShellModule('odk-data-control.js', import.meta.url)
        server = await listenOdkData({ ...control, requestTimeoutMs: 30000, control: createPluginControl({
          scope: 'personal-agent', signal: context.signal, protectedIds: ['odk.personal-bot.control'],
          snapshot: () => host.list(), setEnabled,
        }) })
      } }
    },
  })
  register('service', async context => {
    const service = await selected('service', context, createService)
    const close = once(() => service.close())
    serviceClosers.set(service, close)
    context.onCleanup(close)
    onService(service)
    return { ports: { [BOT_PORTS.service]: service } }
  })
  register('channel', async context => {
    const service = context.get(BOT_PORTS.service)
    const channel = await selected('channel', context, () => openChannel(service, context))
    const close = once(() => channel.close())
    context.onCleanup(close)
    return { ports: { [BOT_PORTS.channel]: { close } }, start: () => channel.prepare?.() }
  })
  register('runtime', async context => {
    const service = context.get(BOT_PORTS.service)
    const channel = context.get(BOT_PORTS.channel)
    const runtime = await selected('runtime', context, () => initialize(service, context))
    // Separate cleanup registrations preserve the established order even if one fails.
    context.onCleanup(async () => {
      try { await runtime.agent.close() } finally { onRuntime(undefined, { stopping: shuttingDown }) }
    })
    context.onCleanup(() => shuttingDown ? serviceClosers.get(service)() : service.suspend())
    context.onCleanup(() => runtime.agent.abort())
    context.onCleanup(() => { if (shuttingDown) return channel.close() })
    await service.resume?.()
    if (!context.signal.aborted) onRuntime(runtime, { stopping: false })
    return { ports: { [BOT_PORTS.runtime]: runtime } }
  })
  for (const [name, factory] of [
    ['home', createHome],
    ['watch', createWatch],
  ]) {
    if (!factory) continue
    register(name, async context => {
      const resource = await selected(name, context, () => factory(context.get(BOT_PORTS.runtime), context.get(BOT_PORTS.service), context))
      const close = once(() => resource.close())
      if (name === 'home') closeHome = close
      context.onCleanup(close)
      if (name === 'home') onHome(resource, context.get(BOT_PORTS.service), context)
      else onWatch(resource, context.get(BOT_PORTS.service), context)
      return {
        ports: { [BOT_PORTS[name]]: resource },
        start: () => resource.start(),
        stop: close,
      }
    })
  }
  function setEnabled(id, enabled) {
    if (['odk.personal-bot.service', 'odk.personal-bot.channel', 'odk.personal-bot.runtime'].includes(id)) {
      const service = host.get(BOT_PORTS.service)
      if (service && (typeof service.suspend !== 'function' || typeof service.resume !== 'function')) {
        return Promise.reject(Error('resident service does not support runtime suspension'))
      }
    }
    return host.setEnabled(id, enabled)
  }
  return {
    async start() {
      const epoch = generation
      const restarting = Boolean(stopPromise)
      await stopPromise?.catch(() => {})
      if (epoch !== generation) return host.list()
      stopPromise = undefined
      shuttingDown = false
      shutdownErrors = []
      if (restarting) closeHome = undefined
      const catalog = await host.start()
      if (epoch !== generation) return catalog
      const fatal = catalog.find(entry => ['odk.personal-bot.service', 'odk.personal-bot.channel'].includes(entry.manifest.id) && entry.state !== 'running')
      const manageable = catalog.some(entry => entry.manifest.id === 'odk.personal-bot.control' && entry.state === 'running')
      if (fatal && !manageable) { await host.stop(); throw Error('Personal Bot resident channel unavailable') }
      return catalog
    },
    stop() {
      if (stopPromise) return stopPromise
      generation++
      shuttingDown = true
      shutdownErrors = []
      // Home cancellation was synchronous before this composition. Watch may wait
      // for pending work, so cancel Home before the reverse dependency cleanup.
      closeHome?.().catch(() => {})
      stopPromise = host.stop().then(catalog => {
        if (shutdownErrors.length) throw new AggregateError(shutdownErrors, 'Personal Bot shutdown failed')
        return catalog
      })
      const attempt = stopPromise
      void attempt.catch(() => { if (stopPromise === attempt) stopPromise = undefined })
      return stopPromise
    },
    validate: () => host.validate(),
    setEnabled,
    catalog: () => host.list(),
    port: name => host.get(name),
  }
}
