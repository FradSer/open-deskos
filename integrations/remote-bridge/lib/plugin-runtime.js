'use strict'

const fs = require('node:fs')
const path = require('node:path')

// Source checkouts and immutable releases have different Shell root locations.
// Both load the same kernel; no separate transport lifecycle is maintained here.
function loadPluginHost(base = __dirname) {
  return loadShellModule('plugin-host.js', base)
}

function loadPluginConfig(base = __dirname) {
  return loadShellModule('plugin-config.js', base)
}

function loadShellModule(name, base = __dirname) {
  const candidates = [
    path.resolve(base, '../../../runtime/shell/src', name),
    path.resolve(base, '../../../src', name),
  ]
  const source = candidates.find(candidate => fs.existsSync(candidate))
  if (!source) throw Error(`Remote Bridge requires the installed Shell module ${name}`)
  return require(source)
}

function respondRuntimeDiagnosis(socket, record, catalog) {
  if (record.type !== 'runtime_diagnose') return false
  if (Object.keys(record).some(key => !['v', 'type', 'requestId'].includes(key))
    || typeof record.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(record.requestId)) return true
  let runtime
  try {
    const { sanitizeRuntimePlugins } = loadShellModule('plugin-runtime-report.js')
    const plugins = catalog()
    if (typeof plugins?.then === 'function') {
      void Promise.resolve(plugins).catch(() => {})
      throw Error('Runtime snapshot must be synchronous')
    }
    runtime = { host: 'remote-bridge', instance: 'bridge', state: 'available', plugins: sanitizeRuntimePlugins({ plugins }, 'remote-bridge') }
  } catch { runtime = { host: 'remote-bridge', instance: 'bridge', state: 'unavailable', reason: 'invalid-report', plugins: [] } }
  const line = `${JSON.stringify({ v: 1, type: 'runtime_diagnosis', requestId: record.requestId, runtime })}\n`
  try {
    if (!socket.destroyed) {
      if (socket.writableLength + Buffer.byteLength(line) > 65536) socket.destroy()
      else socket.write(line)
    }
  } catch { socket.destroy() }
  return true
}

const LISTENER_PORT = 'odk:remote/listener/v1'
const LISTENER_ID = 'odk.remote.listener'
const CONTROL_PORT = 'odk:remote/control-ready/v1'

function resolveBridgeControlEndpoint(socketPath) {
  const suffix = 'odk-remote-bridge'
  if (loadShellModule('local-channel.js').isNamedPipe(socketPath) && socketPath.endsWith(suffix)) {
    return socketPath.slice(0, -suffix.length) + 'odk-remote-plugin-control'
  }
  return `${socketPath}.control`
}

function validateTransportReplacement(raw) {
  const { validatePluginManifest } = loadPluginHost()
  const manifest = validatePluginManifest(structuredClone(raw))
  const id = manifest.id
  if (!id.startsWith('odk.remote.transport.') || manifest.host !== 'remote-bridge' || manifest.kind !== 'transport'
    || manifest.permissions.length || manifest.provides.length !== 1 || manifest.requires.length !== 1
    || manifest.provides[0].interface !== `odk:remote/transport/${id}/v1`
    || manifest.requires[0].interface !== LISTENER_PORT || manifest.requires[0].optional
    || !Number.isSafeInteger(manifest.priority) || manifest.priority < 0
    || !['usb-cdc', 'wireless'].includes(manifest.transport)) throw Error('external transport changes bridge contract')
  if (id === 'odk.remote.transport.usb-cdc' && (manifest.priority !== 100 || manifest.transport !== 'usb-cdc')) throw Error('external USB transport changes bridge policy')
  return manifest
}

function retryableOperation(operation) {
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

function createBridgePluginRuntime({ transports, open, close, handlers, logger, initialize = true, withdrawn = () => {}, replacementPlugins = [], disabled = [], onTransportCreated = () => {}, controlEndpoint, hostPlatform, listenControl }) {
  const controlRequired = hostPlatform?.isWindows && controlEndpoint && !disabled.includes('odk.remote.control')
  const replacements = new Map()
  const identities = new Set(transports.map(transport => transport.manifest?.id || 'odk.remote.transport.adapter'))
  for (const definition of replacementPlugins) {
    const manifest = validateTransportReplacement(definition.manifest)
    if (!identities.has(manifest.id) || replacements.has(manifest.id) || typeof definition.create !== 'function') throw Error('invalid or duplicate external transport')
    replacements.set(manifest.id, { manifest, create: definition.create })
  }
  const errors = new Map()
  const active = new Map()
  const transportIds = new Set()
  const host = loadPluginHost().createPluginHost({
    disabled,
    onError(id, error) {
      errors.set(id, error)
      logger.error(`Remote Bridge plugin ${id} failed`, error)
    },
  })
  host.register({
    manifest: {
      schemaVersion: 1, id: LISTENER_ID, name: 'Remote Bridge listener', version: '1.0.0',
      kind: 'system', host: 'remote-bridge', provides: [{ interface: LISTENER_PORT }],
    },
    create(context) {
      return { ports: { [LISTENER_PORT]: handlers }, start: () => open(context.signal), stop: close }
    },
  })
  for (const original of transports) {
    const transport = original
    const id = transport.manifest?.id || 'odk.remote.transport.adapter'
    transportIds.add(id)
    const port = `odk:remote/transport/${id}/v1`
    const replacement = replacements.get(id)
    let previous = original
    const manifest = replacement?.manifest || {
        schemaVersion: 1, id, name: transport.manifest?.name || id,
        version: transport.manifest?.version || '1.0.0', kind: 'transport', host: 'remote-bridge',
        provides: [{ interface: port }], requires: [{ interface: LISTENER_PORT }],
      }
    host.register({
      manifest: controlRequired ? { ...manifest, requires: [...manifest.requires, { interface: CONTROL_PORT }] } : manifest,
      async create(context) {
        const transport = replacement ? await replacement.create(context, structuredClone(replacement.manifest)) : original
        const stop = replacement ? retryableOperation(() => transport?.stop?.()) : () => transport.stop()
        const destroy = replacement ? retryableOperation(() => transport?.destroy?.()) : () => transport.destroy?.()
        if (replacement) {
          context.onCleanup(async () => { await stop(); await destroy() })
          for (const operation of ['on', 'off', 'start', 'stop', 'send']) {
            if (typeof transport?.[operation] !== 'function') throw TypeError(`external transport requires callable ${operation}`)
          }
          if (transport.manifest?.id !== id || transport.priority !== replacement.manifest.priority
            || transport.transport !== replacement.manifest.transport) throw Error('external transport instance changes declared policy')
          onTransportCreated(previous, transport)
          previous = transport
        }
        active.set(transport, context.signal)
        const listener = context.get(LISTENER_PORT)
        for (const [event, handler] of Object.entries(listener)) {
          const callback = (...args) => {
            if (context.signal.aborted) return
            try {
              Promise.resolve(handler(transport, ...args)).catch(error => logger.error('Remote Link callback failed', error))
            } catch (error) { logger.error('Remote Link callback failed', error) }
          }
          transport.on(event, callback)
          context.onCleanup(() => transport.off(event, callback))
        }
        context.onCleanup(() => {
          active.delete(transport)
          withdrawn(transport)
        })
        return {
          ports: { [port]: transport },
          async start() {
            if (initialize) await transport.init?.()
            if (!context.signal.aborted) await transport.start()
          },
          stop,
          destroy,
        }
      },
    })
  }
  if (controlEndpoint) host.register({
    manifest: { schemaVersion: 1, id: 'odk.remote.control', name: 'Remote Bridge transport control', version: '1.0.0',
      kind: 'system', host: 'remote-bridge', provides: controlRequired ? [{ interface: CONTROL_PORT }] : [], requires: [{ interface: LISTENER_PORT }], permissions: [] },
    create(context) {
      let server
      context.onCleanup(async () => { if (server) { await server.close(); server = null } })
      return { ports: controlRequired ? { [CONTROL_PORT]: {} } : {}, async start() {
        if (context.signal.aborted) return
        const { createPluginControl } = loadShellModule('plugin-control.js')
        const listenOdkData = listenControl || loadShellModule('odk-data-control.js').listenOdkData
        const platform = hostPlatform || loadShellModule('platform/index.js').resolveShellHost()
        server = await listenOdkData({ endpoint: controlEndpoint, platform: platform.platform, stateDir: platform.stateDir, requestTimeoutMs: 30000,
          maxConnections: platform.isWindows ? 32 : undefined,
          control: createPluginControl({ scope: 'remote-bridge', signal: context.signal,
            protectedIds: [LISTENER_ID, 'odk.remote.control'],
            inventorySnapshot: () => host.list(),
            snapshot: () => host.list().filter(plugin => transportIds.has(plugin.manifest.id)),
            setEnabled: (id, enabled) => host.setEnabled(id, enabled) }) })
      } }
    },
  })
  return {
    host, errors, listenerId: LISTENER_ID,
    isAvailable: transport => active.has(transport) && !active.get(transport).aborted,
    setEnabled(id, enabled) {
      if (!transportIds.has(id)) return Promise.reject(Error(`unknown transport plugin ${id}`))
      return host.setEnabled(id, enabled)
    },
  }
}

module.exports = { loadShellModule, createBridgePluginRuntime, loadPluginHost, loadPluginConfig, respondRuntimeDiagnosis, validateTransportReplacement, resolveBridgeControlEndpoint }
