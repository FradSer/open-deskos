'use strict'

const { parseArgs } = require('node:util')
const { RemoteBridge } = require('./remote-bridge')
const { RemoteBridgeHost } = require('./remote-bridge-host')
const { EspNowAdapter, radioDeclaration } = require('./esp-now-adapter')
const { UsbCdcAdapter } = require('./usb-cdc-adapter')
const { createBridgePluginRuntime, loadPluginConfig } = require('./plugin-runtime')
const { loadBridgeReplacements, transportPlaceholder } = require('./development-plugins')

const USB_ID = 'odk.remote.transport.usb-cdc'
const usbDeclaration = {
  manifest: { id: USB_ID, name: 'USB CDC Remote transport', version: '1.0.0' },
  priority: 100, transport: 'usb-cdc',
}

function startupSelection(args, env = {}) {
  const { values } = parseArgs({ args, options: {
    'plugin-selection': { type: 'string' },
    'esp-now-config': { type: 'string' },
    'trust-plugins': { type: 'boolean', default: false },
    plugins: { type: 'string' },
  } })
  if (values.plugins !== undefined && !['list', 'validate'].includes(values.plugins)) throw Error('invalid bridge inspection command')
  if (values['plugin-selection'] !== undefined && !values['plugin-selection']) throw Error('bridge selection requires a file path')
  if (values['trust-plugins'] && !values['plugin-selection']) throw Error('bridge trust requires a startup selection')
  const radioConfig = values['esp-now-config'] ?? env.ODK_REMOTE_ESPNOW_CONFIG
  if (radioConfig !== undefined && (!radioConfig || !require('node:path').isAbsolute(radioConfig))) throw Error('ESP-NOW configuration requires an absolute path')
  if (radioConfig && (values['plugin-selection'] || values['trust-plugins'])) throw Error('ESP-NOW mode cannot be combined with external selections')
  const replacementPlugins = values['plugin-selection']
    ? loadBridgeReplacements(values['plugin-selection'], { trusted: values['trust-plugins'] }) : []
  return { inspection: values.plugins, replacementPlugins, radioConfig }
}

function composeTransports(replacementPlugins, defaultTransport) {
  const selected = replacementPlugins.map(transportPlaceholder)
  if (!selected.some(transport => transport.manifest.id === USB_ID)) selected.push(defaultTransport())
  return selected
}

function selectTransports(selection, factories) {
  return selection.radioConfig ? [factories.radio(selection.radioConfig)] : composeTransports(selection.replacementPlugins, factories.usb)
}

async function main(args = process.argv.slice(2), env = process.env) {
  const selection = startupSelection(args, env)
  const { inspection, replacementPlugins } = selection
  const disabled = loadPluginConfig().resolveStartupDisabled(env)
  if (inspection) {
    const runtime = createBridgePluginRuntime({
      transports: selectTransports(selection, { usb: () => usbDeclaration, radio: () => radioDeclaration }), replacementPlugins,
      disabled,
      open() {}, close() {}, handlers: {}, logger: console,
    })
    runtime.host.validate()
    console.log(JSON.stringify({ host: 'remote-bridge', validated: inspection === 'validate', plugins: runtime.host.list() }))
    return
  }
  const transports = selectTransports(selection, { usb: () => new UsbCdcAdapter(), radio: file => new EspNowAdapter({ configFile: file }) })
  const options = { replacementPlugins, disabled }
  const bridge = transports.length === 1
    ? new RemoteBridge({ ...options, adapter: transports[0] })
    : new RemoteBridgeHost({ ...options, transports })
  let stopping
  const stop = () => {
    if (!stopping) stopping = (async () => {
      await bridge.stop()
      const failed = bridge.pluginCatalog().some(item => ['cleanup-failed', 'cleanup-blocked'].includes(item.state))
      process.exit(failed ? 1 : 0)
    })().catch(error => { console.error(`Open DeskOS Remote Bridge shutdown failed: ${error.message}`); process.exit(1) })
    return stopping
  }
  const signal = () => { void stop() }
  process.on('SIGINT', signal)
  process.on('SIGTERM', signal)
  try { await bridge.start() } catch (error) {
    process.off('SIGINT', signal)
    process.off('SIGTERM', signal)
    await bridge.stop()
    throw error
  }
}

function run() {
  void main().catch(error => {
    console.error(`Open DeskOS Remote Bridge failed: ${error.message}`)
    process.exit(1)
  })
}

if (require.main === module) run()
module.exports = { main, run, startupSelection, composeTransports, selectTransports }
