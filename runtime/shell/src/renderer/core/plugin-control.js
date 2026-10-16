;(function (root) {
  'use strict'

  function createRendererControlPlugin() {
    return {
      manifest: { schemaVersion: 1, id: 'odk.renderer.plugin-control', name: 'Renderer control bridge', version: '1.0.0',
        kind: 'system', host: 'electron-renderer', provides: [], requires: [], permissions: ['renderer.control'] },
      create(ctx) {
        const api = ctx.capability('renderer.control')
        async function dispatch(request) {
          if (!root.odkRendererRuntime || ctx.signal.aborted) return { ok: false, error: 'runtime-unavailable' }
          const runtimes = [{ api: root.odkPlugins, controller: root.odkRendererRuntime, placements: true },
            ...(root.odkTheme ? [{ api: root.odkTheme, controller: root.odkTheme, placements: false }] : [])]
          const owners = new Map()
          for (const runtime of runtimes) {
            for (const plugin of runtime.api.catalog()) {
              if (owners.has(plugin.manifest.id)) return { ok: false, error: 'runtime-unavailable' }
              owners.set(plugin.manifest.id, runtime)
            }
          }
          if (request.command === 'inventory') return { ok: true, scope: 'electron-renderer',
            plugins: [...owners.keys()].map(pluginId => ({ pluginId, host: 'electron-renderer' })) }
          if (!['enable', 'disable', 'activate', 'restore-default'].includes(request.command)) return { ok: false, error: 'invalid-command' }
          const owner = owners.get(request.pluginId)
          if (!owner) return { ok: false, error: 'unknown-plugin' }
          if (request.command === 'restore-default') {
            try {
              if (typeof owner.controller.restoreDefault !== 'function') throw Error('unsupported restoration')
              const result = await owner.controller.restoreDefault(request.pluginId)
              const plugin = owner.api.catalog().find(plugin => plugin.manifest.id === request.pluginId)
              if (ctx.signal.aborted || result?.implementation !== 'built-in' || result.state !== 'running'
                || plugin?.state !== 'running' || plugin.manifest.version !== result.version
                || (owner.placements && owner.api.hasFailedPlacement(request.pluginId))) throw Error('restoration incomplete')
              return { ok: true, scope: 'electron-renderer', pluginId: request.pluginId, ...result }
            } catch { return { ok: false, error: 'restoration-failed' } }
          }
          if (request.command === 'activate') {
            try {
              if (!/^[a-f0-9]{64}$/.test(request.revision)
                || typeof request.version !== 'string' || !request.version
                || typeof request.entryUrl !== 'string' || !/^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.js$/.test(request.entryUrl)) throw Error('invalid activation')
              if (owner.placements) {
                if (!root.odkRendererDevelopment) throw Error('Renderer loader unavailable')
                const definitions = await root.odkRendererDevelopment.load({ runtime: true, pluginId: request.pluginId,
                  entryUrl: request.entryUrl, signal: ctx.signal })
                if (ctx.signal.aborted || definitions.length !== 1 || definitions[0].id !== request.pluginId
                  || definitions[0].manifest.version !== request.version) throw Error('selection changed')
                await owner.controller.replace(definitions[0])
              } else await owner.controller.activate(request, { signal: ctx.signal })
              const plugin = owner.api.catalog().find(plugin => plugin.manifest.id === request.pluginId)
              if (ctx.signal.aborted || plugin?.state !== 'running' || plugin.manifest.version !== request.version
                || (owner.placements && owner.api.hasFailedPlacement(request.pluginId))) throw Error('activation incomplete')
              return { ok: true, scope: 'electron-renderer', pluginId: request.pluginId, revision: request.revision,
                version: request.version, state: 'running' }
            } catch { return { ok: false, error: 'activation-failed' } }
          }
          const enabled = request.command === 'enable'
          try {
            await owner.controller.setEnabled(request.pluginId, enabled)
            const plugin = owner.api.catalog().find(plugin => plugin.manifest.id === request.pluginId)
            if (ctx.signal.aborted || plugin?.state !== (enabled ? 'running' : 'disabled')
              || (owner.placements && root.odkPlugins.hasFailedPlacement(request.pluginId))) return { ok: false, error: 'lifecycle-failed' }
            return { ok: true, scope: 'electron-renderer', pluginId: request.pluginId, enabled, state: plugin.state }
          } catch { return { ok: false, error: 'lifecycle-failed' } }
        }
        ctx.onCleanup(api.onRequest(request => {
          if (ctx.signal.aborted || typeof request?.requestId !== 'string') return
          void dispatch(request).then(result => {
            api.report(request.requestId, result)
          }).catch(() => {
            try { api.report(request.requestId, { ok: false, error: 'lifecycle-failed' }) } catch { /* Closed frames cannot acknowledge operations. */ }
          })
        }))
        return {}
      },
    }
  }

  root.odkRendererControlPlugin = { create: createRendererControlPlugin }
})(typeof window !== 'undefined' ? window : globalThis)
