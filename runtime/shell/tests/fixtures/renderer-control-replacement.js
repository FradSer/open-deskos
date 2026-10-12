'use strict'

const { createRendererManagement } = require('../../src/renderer-management')
const { listenDeskData } = require('../../src/desk-data-control')

function independentRendererControl() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.renderer-control', name: 'Selected Renderer control channel', version: '2.0.0',
      kind: 'system', host: 'electron-main', provides: [], requires: [], permissions: ['system.renderer-control'] },
    create(ctx) {
      const options = ctx.capability('system.renderer-control')
      const control = createRendererManagement({ ...options, signal: ctx.signal })
      let endpoint
      ctx.onCleanup(async () => {
        control.close()
        if (endpoint) {
          await endpoint.close()
          endpoint = undefined
        }
      })
      return { async start() {
        if (ctx.signal.aborted) return
        if (options.smokeMode || !options.endpoint) throw Error('renderer control channel unavailable')
        endpoint = await listenDeskData({ ...options, control, requestTimeoutMs: 30000 })
      } }
    },
  }
}

module.exports = { independentRendererControl }
