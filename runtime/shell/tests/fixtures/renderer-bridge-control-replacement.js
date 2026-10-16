'use strict'

function independentControlBridge(root, manifest) {
  return { manifest, create(ctx) {
    const api = ctx.capability('renderer.control')
    const reply = (pluginId, details) => ({ ok: true, scope: 'electron-renderer', pluginId, ...details })
    async function execute(request) {
      if (ctx.signal.aborted || !root.odkRendererRuntime) return { ok: false, error: 'runtime-unavailable' }
      const targets = new Map()
      for (const [catalog, controller, surface] of [
        [root.odkPlugins, root.odkRendererRuntime, true], [root.odkTheme, root.odkTheme, false],
      ]) {
        if (!catalog) continue
        for (const plugin of catalog.catalog()) {
          if (targets.has(plugin.manifest.id)) return { ok: false, error: 'runtime-unavailable' }
          targets.set(plugin.manifest.id, { catalog, controller, surface })
        }
      }
      if (request.command === 'inventory') return { ok: true, scope: 'electron-renderer',
        plugins: [...targets.keys()].map(pluginId => ({ pluginId, host: 'electron-renderer' })) }
      const failures = { enable: 'lifecycle-failed', disable: 'lifecycle-failed',
        activate: 'activation-failed', 'restore-default': 'restoration-failed' }
      if (!Object.hasOwn(failures, request.command)) return { ok: false, error: 'invalid-command' }
      const target = targets.get(request.pluginId)
      if (!target) return { ok: false, error: 'unknown-plugin' }
      const current = () => target.catalog.catalog().find(p => p.manifest.id === request.pluginId)
      const settled = state => !ctx.signal.aborted && current()?.state === state
        && !(target.surface && target.catalog.hasFailedPlacement(request.pluginId))
      try {
        switch (request.command) {
          case 'enable': case 'disable': {
            const enabled = request.command === 'enable'
            await target.controller.setEnabled(request.pluginId, enabled)
            const state = enabled ? 'running' : 'disabled'
            if (!settled(state)) throw Error('Unsettled lifecycle')
            return reply(request.pluginId, { enabled, state })
          }
          case 'restore-default': {
            const restored = await target.controller.restoreDefault(request.pluginId)
            if (restored?.implementation !== 'built-in' || restored.state !== 'running'
              || !settled('running') || current().manifest.version !== restored.version) throw Error('Unsettled restoration')
            return reply(request.pluginId, restored)
          }
          case 'activate': {
            if (!/^[a-f0-9]{64}$/.test(request.revision) || typeof request.version !== 'string' || !request.version
              || typeof request.entryUrl !== 'string' || !/^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.js$/.test(request.entryUrl)) throw Error('Invalid selection')
            if (target.surface) {
              const definitions = await root.odkRendererDevelopment.load({ runtime: true,
                pluginId: request.pluginId, entryUrl: request.entryUrl, signal: ctx.signal })
              if (ctx.signal.aborted || definitions.length !== 1 || definitions[0].id !== request.pluginId
                || definitions[0].manifest.version !== request.version) throw Error('Changed selection')
              await target.controller.replace(definitions[0])
            } else await target.controller.activate(request, { signal: ctx.signal })
            if (!settled('running') || current().manifest.version !== request.version) throw Error('Unsettled activation')
            return reply(request.pluginId, { revision: request.revision, version: request.version, state: 'running' })
          }
        }
      } catch { return { ok: false, error: failures[request.command] } }
    }
    ctx.onCleanup(api.onRequest(request => {
      if (ctx.signal.aborted || typeof request?.requestId !== 'string') return
      void execute(request).then(result => api.report(request.requestId, result)).catch(() => {})
    }))
    return {}
  } }
}

module.exports = { independentControlBridge }
