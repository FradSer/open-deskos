'use strict'

const { listenDeskData } = require('../../src/desk-data-control')
const { sanitizeRuntimePlugins } = require('../../src/plugin-runtime-report')
const { healthPort } = require('../../src/plugins/health')

function independentMainDiagnostics({ healthPorts = [], runtimePorts = [] } = {}) {
  const declaredHealth = new Set(healthPorts)
  function consumePending(root) {
    const queue = [root], seen = new Set()
    let invalid = false
    while (queue.length) {
      const value = queue.pop()
      if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) continue
      seen.add(value)
      try {
        if (typeof value.then === 'function') { void Promise.resolve(value).catch(() => {}); invalid = true }
        if (Array.isArray(value)) { for (const item of value) queue.push(item) }
        else if (value.components !== undefined) queue.push(value.components)
      } catch { invalid = true }
    }
    return invalid
  }
  function projectHealth(value, nested = false) {
    if (!['healthy', 'degraded', 'failed', 'unknown'].includes(value?.state)
      || (value.reason !== undefined && (typeof value.reason !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value.reason)))
      || (value.updatedAt !== undefined && !Number.isFinite(value.updatedAt))) return null
    const result = { state: value.state, ...(value.reason ? { reason: value.reason } : {}),
      ...(value.updatedAt !== undefined ? { updatedAt: value.updatedAt } : {}) }
    if (value.components !== undefined) {
      if (nested || !Array.isArray(value.components) || value.components.length > 64) return null
      const seen = new Set()
      result.components = []
      for (const item of value.components) {
        const health = projectHealth(item, true)
        if (!health || typeof item?.id !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(item.id) || seen.has(item.id)) return null
        seen.add(item.id)
        result.components.push({ id: item.id, ...health })
      }
      if (result.state === 'healthy' && result.components.some(item => item.state !== 'healthy')) return null
    }
    return result
  }
  function health(provider) {
    if (!provider) return { state: 'unknown', reason: 'provider-unavailable' }
    try {
      const value = provider.snapshot()
      if (!consumePending(value)) {
        const result = projectHealth(value)
        if (result) return result
      }
      return { state: 'failed', reason: 'invalid-health-snapshot' }
    } catch { return { state: 'failed', reason: 'probe-failed' } }
  }
  async function runtime(provider, port) {
    const declaration = /^odk:plugin-runtime\/([a-z][a-z0-9-]*)(?:\/([a-z0-9-]{1,64}))?\/v1$/.exec(port)
    const host = declaration?.[1] || 'unknown', instance = declaration?.[2] || 'runtime'
    const unavailable = reason => [{ host, instance, state: 'unavailable', reason, plugins: [] }]
    if (!declaration) return unavailable('invalid-port')
    if (!provider) return unavailable('provider-unavailable')
    try {
      const values = await provider.snapshot()
      if (!Array.isArray(values) || !values.length || values.length > 9) return unavailable('invalid-report')
      const seen = new Set()
      return values.map(value => {
        if (value?.host !== host || typeof value.instance !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.instance)
          || (declaration[2] && value.instance !== declaration[2]) || seen.has(value.instance)) throw Error('Invalid runtime identity')
        seen.add(value.instance)
        if (value.state === 'available') return { host, instance: value.instance, state: 'available', plugins: sanitizeRuntimePlugins(value, host) }
        if (value.state === 'unavailable' && typeof value.reason === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value.reason)) {
          return { host, instance: value.instance, state: 'unavailable', reason: value.reason, plugins: [] }
        }
        throw Error('Invalid runtime state')
      })
    } catch { return unavailable('probe-failed') }
  }
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.plugin-diagnostics', name: 'Selected Main diagnosis', version: '2.0.0',
      kind: 'system', host: 'electron-main', provides: [], permissions: ['plugin.diagnostics'],
      requires: [...new Set([...declaredHealth, ...runtimePorts])].map(interfaceName => ({ interface: interfaceName, optional: true })) },
    create(ctx) {
      const options = ctx.capability('plugin.diagnostics')
      let listener
      ctx.onCleanup(async () => { if (listener) { await listener.close(); listener = undefined } })
      const control = { async dispatch(request) {
        if (request.command !== 'diagnose') return { ok: false, error: 'invalid-command' }
        const plugins = options.snapshot()
        if (request.pluginId !== undefined && typeof request.pluginId !== 'string') return { ok: false, error: 'unknown-plugin' }
        const selected = request.pluginId ? plugins.filter(plugin => plugin.manifest.id === request.pluginId) : plugins
        const runtimes = request.pluginId && selected.length ? [] : (await Promise.all(runtimePorts.map(port => runtime(ctx.get(port), port)))).flat()
        if (request.pluginId && !selected.length && !runtimes.some(item => item.plugins.some(plugin => plugin.manifest.id === request.pluginId))) {
          return { ok: false, error: runtimes.some(item => item.state === 'unavailable') ? 'runtime-unavailable' : 'unknown-plugin' }
        }
        return { ok: true, scope: 'electron-main', plugins: selected.map(plugin => {
          const port = healthPort(plugin.manifest.id)
          return { ...plugin, health: declaredHealth.has(port) && plugin.manifest.provides.some(item => item.interface === port)
            ? health(ctx.get(port)) : { state: 'unknown', reason: 'not-declared' } }
        }), ...(runtimePorts.length ? { runtimes: runtimes.map(item => ({ ...item,
          plugins: request.pluginId ? item.plugins.filter(plugin => plugin.manifest.id === request.pluginId) : item.plugins })) } : {}) }
      } }
      return { async start() {
        if (ctx.signal.aborted) return
        if (options.smokeMode || !options.endpoint) throw Error('plugin diagnosis channel unavailable')
        listener = await listenDeskData({ ...options, control, requestTimeoutMs: 2000 })
      } }
    },
  }
}

module.exports = { independentMainDiagnostics }
