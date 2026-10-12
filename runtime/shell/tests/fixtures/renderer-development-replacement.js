'use strict'

const { NATIVE_PLUGIN_SCHEME } = require('../../src/native-renderer-assets')
const { RENDERER_DEVELOPMENT_CHANNEL } = require('../../src/plugins/renderer-development')

function independentRendererDevelopment() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.renderer-development', name: 'Selected Renderer discovery', version: '2.0.0',
      kind: 'system', host: 'electron-main', provides: [], requires: [], permissions: ['system.renderer-development'] },
    create(ctx) {
      const options = ctx.capability('system.renderer-development')
      let lease
      let ownsProtocol = false
      ctx.onCleanup(() => {
        if (ownsProtocol) {
          options.protocol.unhandle(NATIVE_PLUGIN_SCHEME)
          ownsProtocol = false
        }
        lease?.close()
        lease = undefined
      })
      if (options.nativeAssets && (options.runtimeNativeAssets === true || options.nativeAssets.hasEntries())) {
        lease = options.nativeAssets.fork({ live: options.runtimeNativeAssets === true })
        options.protocol.handle(NATIVE_PLUGIN_SCHEME, request => ctx.signal.aborted
          ? new Response(null, { status: 410 }) : lease.response(request))
        ownsProtocol = true
      }
      options.ipc.handle(RENDERER_DEVELOPMENT_CHANNEL, event => {
        const authorized = !ctx.signal.aborted && options.frames().includes(event.sender)
          && event.senderFrame && event.senderFrame === event.sender.mainFrame
        if (!authorized) throw Error('renderer development access refused')
        const entries = options.entries()
        if (Array.isArray(entries) && entries.length <= 32) return entries
        throw Error('renderer development entry limit exceeded')
      })
      ctx.onCleanup(() => options.ipc.removeHandler(RENDERER_DEVELOPMENT_CHANNEL))
      return {}
    },
  }
}

module.exports = { independentRendererDevelopment }
