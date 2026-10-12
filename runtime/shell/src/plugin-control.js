'use strict'

const { listenDeskData } = require('./desk-data-control')
const ID = 'odk.system.plugin-control'

function createPluginControl({ snapshot, inventorySnapshot = snapshot, setEnabled, activate, signal, scope = 'electron-main', protectedIds = [ID] }) {
  return { async dispatch(request) {
    if (request?.command === 'inventory') {
      if (Object.keys(request).some(key => !['v', 'id', 'command'].includes(key))) return { ok: false, error: 'invalid-command' }
      if (signal?.aborted) return { ok: false, error: 'runtime-stopped' }
      try {
        const snapshot = inventorySnapshot()
        if (typeof snapshot?.then === 'function') {
          void Promise.resolve(snapshot).catch(() => {})
          throw Error('asynchronous inventory')
        }
        const plugins = snapshot.map(plugin => ({ pluginId: plugin.manifest.id, host: plugin.manifest.host }))
        if (!plugins.length || plugins.length > 128 || Buffer.byteLength(JSON.stringify(plugins)) > 16384) throw Error('invalid inventory')
        return { ok: true, scope, plugins }
      } catch { return { ok: false, error: 'inventory-unavailable' } }
    }
    if (!request || !['enable', 'disable', 'activate', 'restore-default'].includes(request.command)
      || Object.keys(request).some(key => !['v', 'id', 'command', 'pluginId'].includes(key))) return { ok: false, error: 'invalid-command' }
    if (typeof request.pluginId !== 'string' || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(request.pluginId)) return { ok: false, error: 'unknown-plugin' }
    if (protectedIds.includes(request.pluginId)) return { ok: false, error: 'protected-plugin' }
    if (signal?.aborted) return { ok: false, error: 'runtime-stopped' }
    if (!snapshot().some(plugin => plugin.manifest.id === request.pluginId)) return { ok: false, error: 'unknown-plugin' }
    if (['activate', 'restore-default'].includes(request.command)) {
      const restoring = request.command === 'restore-default'
      if (scope !== 'electron-main' || typeof activate !== 'function') return { ok: false, error: 'activation-unavailable' }
      try {
        const receipt = await activate(request.pluginId, { signal, ...(restoring ? { restoreDefault: true } : {}) })
        const plugin = snapshot().find(plugin => plugin.manifest.id === request.pluginId)
        if (signal?.aborted || plugin?.state !== 'running' || plugin.manifest.version !== receipt?.version
          || receipt.state !== 'running' || (restoring ? receipt.implementation !== 'built-in' : !/^[a-f0-9]{64}$/.test(receipt.revision))) throw Error('invalid activation result')
        return { ok: true, scope, pluginId: request.pluginId,
          ...(restoring ? { implementation: 'built-in' } : { revision: receipt.revision }), version: receipt.version, state: 'running' }
      } catch { return { ok: false, error: restoring ? 'restoration-failed' : 'activation-failed' } }
    }
    const enabled = request.command === 'enable'
    try {
      await setEnabled(request.pluginId, enabled)
      const plugin = snapshot().find(plugin => plugin.manifest.id === request.pluginId)
      if (signal?.aborted || !plugin || plugin.state !== (enabled ? 'running' : 'disabled')) return { ok: false, error: 'lifecycle-failed' }
      return { ok: true, scope, pluginId: request.pluginId, enabled, state: plugin.state }
    } catch { return { ok: false, error: 'lifecycle-failed' } }
  } }
}

function createPluginControlPlugin() {
  return {
    manifest: { schemaVersion: 1, id: ID, name: 'Plugin runtime control', version: '1.0.0',
      kind: 'system', host: 'electron-main', provides: [], requires: [], permissions: ['plugin.control'] },
    create(ctx) {
      const config = ctx.capability('plugin.control')
      let server
      ctx.onCleanup(async () => { if (server) { await server.close(); server = null } })
      return { async start() {
        if (ctx.signal.aborted) return
        if (config.smokeMode || !config.endpoint) throw Error('plugin control channel unavailable')
        server = await listenDeskData({ ...config, requestTimeoutMs: 30000,
          control: createPluginControl({ ...config, signal: ctx.signal }) })
      } }
    },
  }
}

module.exports = { createPluginControl, createPluginControlPlugin }
