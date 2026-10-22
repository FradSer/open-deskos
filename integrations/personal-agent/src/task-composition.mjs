import { loadPersonalAgentPluginHost, loadPersonalAgentRuntimeReport, loadPersonalAgentManagementModules } from './plugin-composition.mjs'

export const TASK_PORTS = Object.freeze({
  listener: 'odk:hosted-pi/listener/v1',
  service: 'odk:hosted-pi/service/v1',
  endpoint: 'odk:hosted-pi/endpoint/v1',
})

const taskDependencies = Object.freeze({ listener: [], service: ['listener'], endpoint: ['service'] })

export function hostedPiManifest(name) {
  if (!Object.hasOwn(taskDependencies, name)) throw Error('unknown Hosted Pi component')
  return {
    schemaVersion: 1, id: `odk.hosted-pi.${name}`, name: `Hosted Pi ${name}`, version: '1.0.0',
    kind: 'service', host: 'personal-agent', permissions: [],
    provides: [{ interface: TASK_PORTS[name] }],
    requires: taskDependencies[name].map(dependency => ({ interface: TASK_PORTS[dependency] })),
  }
}

export function validateHostedPiReplacement(raw) {
  const { validatePluginManifest } = loadPersonalAgentPluginHost()
  const manifest = validatePluginManifest(structuredClone(raw))
  const name = Object.keys(TASK_PORTS).find(name => manifest.id === `odk.hosted-pi.${name}`)
  if (!name) throw Error('unknown Hosted Pi replacement identity')
  const original = validatePluginManifest(hostedPiManifest(name))
  const ports = list => list.map(port => `${port.interface}:${Boolean(port.optional)}`).sort()
  if (manifest.host !== original.host || manifest.kind !== original.kind || manifest.permissions.length
    || JSON.stringify(ports(manifest.provides)) !== JSON.stringify(ports(original.provides))
    || JSON.stringify(ports(manifest.requires)) !== JSON.stringify(ports(original.requires))) {
    throw Error('Hosted Pi replacement changes component contract')
  }
  return manifest
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

export function createTaskComposition({ openChannel, createService, endpointFile, publishEndpoint, removeEndpoint, reportPublicationFailure = () => {}, onError = (_id, _error) => {}, replacementPlugins = [], disabled = [], control = undefined }) {
  const replacements = new Map()
  for (const definition of replacementPlugins) {
    const manifest = validateHostedPiReplacement(definition.manifest)
    if (replacements.has(manifest.id) || typeof definition.create !== 'function') throw Error('invalid or duplicate Hosted Pi replacement')
    replacements.set(manifest.id, { manifest, create: definition.create })
  }
  const selected = (name, context, bindings, fallback) => {
    const replacement = replacements.get(`odk.hosted-pi.${name}`)
    return replacement ? replacement.create(context, bindings) : fallback()
  }
  const errors = new Map()
  let shuttingDown = false
  let shutdownErrors = new Set()
  let closing
  let generation = 0
  const host = loadPersonalAgentPluginHost().createPluginHost({
    disabled,
    onError(id, error) {
      errors.set(id, error)
      if (shuttingDown) shutdownErrors.add(error)
      else onError(id, error)
    },
  })
  const register = (name, create) => host.register({
    manifest: replacements.get(`odk.hosted-pi.${name}`)?.manifest || hostedPiManifest(name),
    create,
  })
  if (control) host.register({
    manifest: { schemaVersion: 1, id: 'odk.hosted-pi.control', name: 'Hosted Pi runtime control', version: '1.0.0',
      kind: 'system', host: 'personal-agent', provides: [], requires: [], permissions: [] },
    create(context) {
      let server
      context.onCleanup(async () => { if (server) { await server.close(); server = undefined } })
      return { async start() {
        if (context.signal.aborted) return
        const { createPluginControl, listenOdkData } = loadPersonalAgentManagementModules()
        server = await listenOdkData({ ...control, requestTimeoutMs: 30000,
          control: createPluginControl({ scope: 'personal-agent', signal: context.signal,
            protectedIds: ['odk.hosted-pi.control'], snapshot: () => host.list(),
            setEnabled }) })
      } }
    },
  })
  register('listener', async context => {
    let service
    let retiring
    const connectionOwners = new Map()
    const handleRequest = (request, requestContext) => {
      if (request?.command === 'runtime_diagnose') return Promise.resolve(diagnose(request))
      if (!service) return Promise.resolve({ version: 1, requestId: request.requestId, ok: false, error: '任务服务正在启动' })
      if (requestContext?.connectionId) connectionOwners.set(requestContext.connectionId, service)
      return service.handle(request, requestContext)
    }
    const disconnect = async connectionId => {
      await (connectionOwners.get(connectionId) || service || retiring)?.disconnect(connectionId)
      connectionOwners.delete(connectionId)
    }
    const channel = await selected('listener', context, Object.freeze({ handleRequest, disconnect }),
      () => openChannel(handleRequest, disconnect, context))
    if (replacements.has('odk.hosted-pi.listener') && typeof channel?.close !== 'function') throw TypeError('Hosted Pi listener requires callable close')
    const close = once(() => channel.close())
    context.onCleanup(close)
    const drain = typeof channel.disconnectClients === 'function' ? async () => {
      retiring ||= service
      service = undefined
      await channel.disconnectClients()
      retiring = undefined
    } : undefined
    return { ports: { [TASK_PORTS.listener]: { close, drain, attach(value) { service = value } } } }
  })
  function diagnose(request) {
    if (request.version !== 1 || typeof request.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(request.requestId)
      || Object.keys(request).some(key => !['version', 'requestId', 'command'].includes(key))) {
      return { version: 1, requestId: request.requestId, ok: false, error: 'invalid-diagnosis-request' }
    }
    let runtime
    try {
      const { sanitizeRuntimePlugins } = loadPersonalAgentRuntimeReport()
      runtime = { host: 'personal-agent', instance: 'hosted-pi', state: 'available', plugins: sanitizeRuntimePlugins({ plugins: host.list() }, 'personal-agent') }
    } catch { runtime = { host: 'personal-agent', instance: 'hosted-pi', state: 'unavailable', reason: 'invalid-report', plugins: [] } }
    return { version: 1, requestId: request.requestId, ok: true, runtime }
  }
  register('service', async context => {
    const listener = context.get(TASK_PORTS.listener)
    let service
    context.onCleanup(async () => {
      try {
        if (replacements.has('odk.hosted-pi.service') && typeof service?.close !== 'function') return
        if (service) await listener.drain?.()
        await service?.close()
      } finally { listener.attach(undefined) }
    })
    context.onCleanup(() => shuttingDown ? listener.close() : undefined)
    service = await selected('service', context, undefined, () => createService(context))
    if (replacements.has('odk.hosted-pi.service')) {
      for (const operation of ['handle', 'disconnect', 'close']) {
        if (typeof service?.[operation] !== 'function') throw TypeError(`Hosted Pi service requires callable ${operation}`)
      }
    }
    listener.attach(service)
    return { ports: { [TASK_PORTS.service]: service } }
  })
  register('endpoint', async context => {
    const file = endpointFile()
    if (replacements.has('odk.hosted-pi.endpoint')) {
      const resource = await selected('endpoint', context, Object.freeze({
        file, publish: () => publishEndpoint(file), remove: () => removeEndpoint(file), reportPublicationFailure,
      }), () => undefined)
      if (typeof resource?.close === 'function') context.onCleanup(once(() => resource.close()))
      if (!resource || typeof resource.published !== 'boolean'
        || (resource.published ? typeof resource.file !== 'string' || resource.file !== file || typeof resource.close !== 'function'
          : resource.file !== null)) throw Error('invalid Hosted Pi endpoint result')
      return { ports: { [TASK_PORTS.endpoint]: { file: resource.file, published: resource.published } } }
    }
    let published = false
    if (file) {
      try { await publishEndpoint(file); published = true }
      catch { reportPublicationFailure() }
    }
    context.onCleanup(() => published ? removeEndpoint(file) : undefined)
    return { ports: { [TASK_PORTS.endpoint]: { file: published ? file : null, published } } }
  })
  function setEnabled(id, enabled) {
    if (['odk.hosted-pi.listener', 'odk.hosted-pi.service'].includes(id)
      && host.get(TASK_PORTS.service) && typeof host.get(TASK_PORTS.listener)?.drain !== 'function') {
      return Promise.reject(Error('Hosted Pi listener does not support connection draining'))
    }
    return host.setEnabled(id, enabled)
  }
  return {
    async start() {
      const epoch = generation
      await closing?.catch(() => {})
      if (epoch !== generation) return host.list()
      closing = undefined
      shuttingDown = false
      shutdownErrors = new Set()
      const catalog = await host.start()
      if (epoch !== generation) return catalog
      const failed = catalog.find(entry => ['failed', 'cleanup-failed', 'cleanup-blocked'].includes(entry.state))
      const manageable = catalog.some(entry => entry.manifest.id === 'odk.hosted-pi.control' && entry.state === 'running')
      if (failed && !manageable) {
        await host.stop()
        throw errors.get(failed.manifest.id) || Error('Hosted Pi startup failed')
      }
      return catalog
    },
    close() {
      if (closing) return closing
      generation++
      shuttingDown = true
      shutdownErrors = new Set()
      closing = host.stop().then(catalog => {
        if (shutdownErrors.size) throw new AggregateError(shutdownErrors, 'Hosted Pi shutdown failed')
        return catalog
      })
      const attempt = closing
      void attempt.catch(() => { if (closing === attempt) closing = undefined })
      return closing
    },
    validate: () => host.validate(),
    catalog: () => host.list(),
    port: name => host.get(name),
    setEnabled,
  }
}
