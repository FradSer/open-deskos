'use strict'

const assert = require('node:assert/strict')
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createPluginControl } = require('../../src/plugin-control')
const { listenOdkData } = require('../../src/odk-data-control')

function independentPluginControl() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.plugin-control', name: 'Selected plugin control', version: '2.0.0',
      kind: 'system', host: 'electron-main', provides: [], requires: [], permissions: ['plugin.control'] },
    create(ctx) {
      const options = ctx.capability('plugin.control')
      let listener
      ctx.onCleanup(async () => {
        if (!listener) return
        await listener.close()
        listener = undefined
      })
      return { async start() {
        if (ctx.signal.aborted) return
        if (options.smokeMode || !options.endpoint) throw Error('plugin control channel unavailable')
        listener = await listenOdkData({ ...options, requestTimeoutMs: 30000,
          control: createPluginControl({ ...options, signal: ctx.signal }) })
      } }
    },
  }
}

function selectedPluginControl() {
  const id = 'odk.system.plugin-control'
  const replacement = independentPluginControl()
  const composition = createMainPlugins({ replacementPlugins: [replacement], onDefaults(defaults) {
    defaults.find(plugin => plugin.manifest.id === id).create = () => { throw Error('default management factory executed') }
  } })
  const selected = composition.find(plugin => plugin.manifest.id === id)
  assert.equal(selected, replacement)
  return selected
}

module.exports = { selectedPluginControl, independentPluginControl }
