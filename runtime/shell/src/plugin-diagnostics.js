'use strict'

const { listenOdkData } = require('./odk-data-control')
const { requestLocalControl } = require('./local-control-client')
const { sanitizeRuntimePlugins } = require('./plugin-runtime-report')
const { healthPort } = require('./plugins/health')

function consumeAsyncHealth(value) {
  const pending = [value]
  const visited = new Set()
  let invalid = false
  while (pending.length) {
    const current = pending.pop()
    if (!current || (typeof current !== 'object' && typeof current !== 'function') || visited.has(current)) continue
    visited.add(current)
    try {
      if (typeof current.then === 'function') {
        void Promise.resolve(current).catch(() => {})
        invalid = true
      }
      if (Array.isArray(current)) {
        for (const component of current) pending.push(component)
      } else if (current.components !== undefined) pending.push(current.components)
    } catch { invalid = true }
  }
  return invalid
}

function sanitizeHealth(value, allowComponents = true) {
  if (!['healthy', 'degraded', 'failed', 'unknown'].includes(value?.state)
    || (value.reason !== undefined && (typeof value.reason !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value.reason)))
    || (value.updatedAt !== undefined && !Number.isFinite(value.updatedAt))) return null
  const result = { state: value.state, ...(value.reason ? { reason: value.reason } : {}), ...(value.updatedAt !== undefined ? { updatedAt: value.updatedAt } : {}) }
  if (value.components !== undefined) {
    if (!allowComponents || !Array.isArray(value.components) || value.components.length > 64) return null
    const ids = new Set()
    const components = []
    for (const component of value.components) {
      const health = sanitizeHealth(component, false)
      if (!health || typeof component?.id !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(component.id) || ids.has(component.id)) return null
      ids.add(component.id)
      components.push({ id: component.id, ...health })
    }
    if (result.state === 'healthy' && components.some(component => component.state !== 'healthy')) return null
    result.components = components
  }
  return result
}

function readHealth(provider) {
  if (!provider) return { state: 'unknown', reason: 'provider-unavailable' }
  try {
    const value = provider.snapshot()
    if (consumeAsyncHealth(value)) {
      return { state: 'failed', reason: 'invalid-health-snapshot' }
    }
    return sanitizeHealth(value) || { state: 'failed', reason: 'invalid-health-snapshot' }
  } catch { return { state: 'failed', reason: 'probe-failed' } }
}

async function readRuntime(provider, port) {
  const declaration = /^odk:plugin-runtime\/([a-z][a-z0-9-]*)(?:\/([a-z0-9-]{1,64}))?\/v1$/.exec(port)
  const host = declaration?.[1] || 'unknown'
  const instance = declaration?.[2] || 'runtime'
  const unavailable = reason => [{ host, instance, state: 'unavailable', reason, plugins: [] }]
  if (!declaration) return unavailable('invalid-port')
  if (!provider) return unavailable('provider-unavailable')
  try {
    const value = await provider.snapshot()
    if (!Array.isArray(value) || !value.length || value.length > 9) return unavailable('invalid-report')
    const instances = new Set()
    return value.map(runtime => {
      if (runtime?.host !== host || (declaration[2] && runtime.instance !== declaration[2]) || typeof runtime.instance !== 'string' || !/^[a-z0-9-]{1,64}$/.test(runtime.instance)
        || instances.has(runtime.instance)) throw Error('invalid runtime')
      instances.add(runtime.instance)
      if (runtime.state === 'available') return { host, instance: runtime.instance, state: 'available', plugins: sanitizeRuntimePlugins(runtime, host) }
      if (runtime.state !== 'unavailable' || typeof runtime.reason !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(runtime.reason)) throw Error('invalid runtime')
      return { host, instance: runtime.instance, state: 'unavailable', reason: runtime.reason, plugins: [] }
    })
  } catch { return unavailable('probe-failed') }
}

function createDiagnosticsPlugin({ healthPorts = [], runtimePorts = [] } = {}) {
  const declaredHealth = new Set(healthPorts)
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.plugin-diagnostics', name: 'Plugin diagnosis channel',
      version: '1.0.0', kind: 'system', host: 'electron-main', provides: [], requires: [...new Set([...declaredHealth, ...runtimePorts])].map(interfaceName => ({ interface: interfaceName, optional: true })), permissions: ['plugin.diagnostics'] },
    create(ctx) {
      const config = ctx.capability('plugin.diagnostics')
      let server
      ctx.onCleanup(async () => {
        if (!server) return
        await server.close()
        server = null
      })
      return { async start() {
        if (ctx.signal.aborted) return
        if (config.smokeMode || !config.endpoint) throw Error('plugin diagnosis channel unavailable')
        server = await listenOdkData({ ...config, requestTimeoutMs: 2000, control: { async dispatch(request) {
          if (request.command !== 'diagnose') return { ok: false, error: 'invalid-command' }
          const plugins = config.snapshot()
          if (request.pluginId !== undefined && typeof request.pluginId !== 'string') return { ok: false, error: 'unknown-plugin' }
          const selected = request.pluginId ? plugins.filter(plugin => plugin.manifest.id === request.pluginId) : plugins
          const runtimes = request.pluginId && selected.length ? [] : (await Promise.all(runtimePorts.map(port => readRuntime(ctx.get(port), port)))).flat()
          if (request.pluginId && !selected.length && !runtimes.some(runtime => runtime.plugins.some(plugin => plugin.manifest.id === request.pluginId))) {
            return { ok: false, error: runtimes.some(runtime => runtime.state === 'unavailable') ? 'runtime-unavailable' : 'unknown-plugin' }
          }
          return { ok: true, scope: 'electron-main', ...(runtimePorts.length ? { runtimes: runtimes.map(runtime => ({ ...runtime,
            plugins: request.pluginId ? runtime.plugins.filter(plugin => plugin.manifest.id === request.pluginId) : runtime.plugins })) } : {}), plugins: selected.map(plugin => ({ ...plugin,
            health: declaredHealth.has(healthPort(plugin.manifest.id)) && plugin.manifest.provides.some(port => port.interface === healthPort(plugin.manifest.id))
              ? readHealth(ctx.get(healthPort(plugin.manifest.id))) : { state: 'unknown', reason: 'not-declared' },
          })) }
        } } })
      } }
    },
  }
}

async function requestDiagnostics({ endpoint, tokenFile, platform = process.platform, pluginId, timeoutMs = 2000 }) {
  const response = await requestLocalControl({ endpoint, tokenFile, platform, timeoutMs, label: 'plugin diagnosis',
    request: { command: 'diagnose', ...(pluginId ? { pluginId } : {}) } })
  if (response.scope !== 'electron-main' || !Array.isArray(response.plugins) || (response.runtimes !== undefined && !Array.isArray(response.runtimes))) throw Error('invalid plugin diagnosis states')
  return response
}

module.exports = { createDiagnosticsPlugin, requestDiagnostics }
