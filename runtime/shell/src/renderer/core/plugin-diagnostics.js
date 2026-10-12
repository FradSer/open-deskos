;(function (root) {
  'use strict'

  const bridge = root.odkPluginDiagnosis
  if (!bridge) return
  const host = root.odkPluginHost.createPluginHost({ capabilities: {
    'renderer.diagnosis': bridge, 'renderer.control': root.odkRendererControlBridge,
  } })
  if (root.odkRendererControlBridge && root.odkRendererControlPlugin) host.register(root.odkRendererControlPlugin.create())
  host.register({
    manifest: { schemaVersion: 1, id: 'odk.renderer.plugin-diagnostics', name: 'Renderer diagnosis bridge',
      version: '1.0.0', kind: 'system', host: 'electron-renderer', provides: [], requires: [], permissions: ['renderer.diagnosis'] },
    create(ctx) {
      const api = ctx.capability('renderer.diagnosis')
      ctx.onCleanup(api.onRequest(request => {
        if (ctx.signal.aborted) return
        try {
          api.report(request.requestId, [...root.odkPlugins.catalog(), ...root.odkTheme.catalog(), ...host.list()])
        } catch {
          try { api.report(request.requestId, null) } catch { /* A closed frame cannot return a report. */ }
        }
      }))
      return {}
    },
  })
  const ready = host.start().catch(error => console.error(`renderer diagnosis failed: ${error.message}`))
  root.odkRendererDiagnosis = { ready, catalog: host.list, replace: host.replace }
  root.addEventListener('pagehide', event => {
    if (!event.persisted) void host.stop().catch(error => console.error(`renderer diagnosis stop failed: ${error.message}`))
  })
})(window)
