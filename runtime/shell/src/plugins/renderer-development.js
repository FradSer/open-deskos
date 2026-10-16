'use strict'

const RENDERER_DEVELOPMENT_CHANNEL = 'odk-renderer-development-plugins'
const { NATIVE_PLUGIN_SCHEME } = require('../native-renderer-assets')

function createRendererDevelopmentPlugin() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.renderer-development', name: 'Trusted renderer development links', version: '1.0.0',
      kind: 'system', host: 'electron-main', provides: [], requires: [], permissions: ['system.renderer-development'] },
    create(context) {
      const configuration = context.capability('system.renderer-development')
      if (configuration.nativeAssets && (configuration.runtimeNativeAssets === true || configuration.nativeAssets.hasEntries())) {
        const assets = configuration.nativeAssets.fork({ live: configuration.runtimeNativeAssets === true })
        let registered = false
        context.onCleanup(() => {
          if (registered) {
            configuration.protocol.unhandle(NATIVE_PLUGIN_SCHEME)
            registered = false
          }
          assets.close()
        })
        configuration.protocol.handle(NATIVE_PLUGIN_SCHEME, request => context.signal.aborted
          ? new Response(null, { status: 410 }) : assets.response(request))
        registered = true
      }
      configuration.ipc.handle(RENDERER_DEVELOPMENT_CHANNEL, event => {
        if (context.signal.aborted || !configuration.frames().includes(event.sender)
          || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw Error('renderer development access refused')
        const entries = configuration.entries()
        if (!Array.isArray(entries) || entries.length > 32) throw Error('renderer development entry limit exceeded')
        return entries
      })
      context.onCleanup(() => configuration.ipc.removeHandler(RENDERER_DEVELOPMENT_CHANNEL))
      return {}
    },
  }
}

module.exports = { createRendererDevelopmentPlugin, RENDERER_DEVELOPMENT_CHANNEL }
