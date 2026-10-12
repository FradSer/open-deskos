'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { requestDiagnostics } = require('../../src/plugin-diagnostics')
const { resolveShellHost } = require('../../src/platform')
const { runCommand } = require('./hydra-wire-lifecycle')
const { requestLocalControl } = require('../../src/local-control-client')

function prepareDiagnosticMain(mode) {
  assert.ok(['default', 'development', 'missing', 'missing-management', 'missing-renderer', 'missing-discovery', 'missing-control', 'missing-main-diagnosis',
    'missing-refresh', 'missing-notifications', 'missing-frame-status'].includes(mode))
  const ids = [...['personal-bot', 'remote-bridge', 'hosted-pi', 'futu-runtime'].map(name => `odk.system.${name}-diagnostics`),
    'odk.system.plugin-control', 'odk.system.renderer-diagnostics', 'odk.system.renderer-development', 'odk.system.renderer-control', 'odk.system.plugin-diagnostics',
    'odk.system.service-refresh', 'odk.system.service-notifications', 'odk.system.frame-status']
  const fallback = new Map(ids.map(id => [id, 0]))
  if (mode !== 'default') {
    const composition = require('../../src/plugins/main-composition')
    const original = composition.createMainPlugins
    composition.createMainPlugins = options => original(options).map(plugin => {
      if (!fallback.has(plugin.manifest.id) || plugin.manifest.version !== '1.0.0') return plugin
      return { ...plugin, create() {
        fallback.set(plugin.manifest.id, fallback.get(plugin.manifest.id) + 1)
        throw Error('Packaged diagnostic construction refused')
      } }
    })
  }
  const assertNoFallback = () => assert.equal([...fallback.values()].reduce((total, count) => total + count, 0), 0,
    'Production diagnostic fallback guard triggered')
  return { assertNoFallback, async exercise(win, host, configPath) {
    assertNoFallback()
    const version = mode === 'default' ? '1.0.0' : '2.0.0'
    for (const id of ids) {
      const record = host.list().find(plugin => plugin.manifest.id === id)
      assert.equal(record.manifest.version, version)
      assert.equal(record.state, 'running')
    }
    const entries = globalThis.odkDiagnosticMainEntries || []
    assert.deepEqual([...entries].sort(), mode === 'default' ? [] : [...ids].sort())
    const records = host.list()
    const notificationResult = host.get('odk:system/service-notifications/v1').publish(['odk.test.acceptance'])
    assert.equal(notificationResult, false)
    const appState = host.get('odk:system/app-manager/v1').captureState()
    const ports = records.flatMap(plugin => plugin.manifest.provides.map(port => [port.interface, host.get(port.interface)]))
    const saved = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null
    await win.webContents.executeJavaScript('window.diagnosticDocument=document;window.diagnosticNodes=[...document.querySelectorAll("[data-widget], [data-status-plugin], [data-built-by=composer]")]')
    const discover = () => win.webContents.executeJavaScript('window.odkRendererPluginBridge.list()')
    const discoveryEntries = await discover()
    await host.setEnabled('odk.system.renderer-development', false)
    assert.equal(await win.webContents.executeJavaScript('window.odkRendererPluginBridge.list().then(()=>false,()=>true)'), true)
    await host.setEnabled('odk.system.renderer-development', true)
    assert.deepEqual(await discover(), discoveryEntries)
    const endpoint = resolveShellHost().endpoint('plugin-diagnostics')
    const result = await requestDiagnostics({ endpoint })
    for (const plugin of result.plugins) {
      const port = `odk:plugin-health/${plugin.manifest.id}/v1`
      const provider = plugin.manifest.provides.some(item => item.interface === port) ? host.get(port) : null
      assert.deepEqual(plugin.health, provider ? provider.snapshot() : { state: 'unknown', reason: 'not-declared' })
    }
    // Separate processes acquire readings at different times. Check exact local
    // provider values above, then compare timestamp presence across processes.
    const healthShape = health => ({ ...health,
      ...(health.updatedAt !== undefined ? { updatedAt: Number.isFinite(health.updatedAt) ? 'timestamp' : 'invalid-timestamp' } : {}),
      ...(health.components ? { components: health.components.map(healthShape) } : {}) })
    const mainStates = result.plugins.map(plugin => ({ pluginId: plugin.manifest.id, state: plugin.state, enabled: plugin.enabled, health: healthShape(plugin.health) }))
    const expectedRuntimes = ['personal-agent:resident', 'remote-bridge:bridge', 'personal-agent:hosted-pi', 'python-agent:futu-poller'].sort()
    const selectedReports = result.runtimes.filter(runtime => expectedRuntimes.includes(`${runtime.host}:${runtime.instance}`))
    assert.deepEqual(selectedReports.map(runtime => `${runtime.host}:${runtime.instance}`).sort(), expectedRuntimes)
    assert.ok(selectedReports.every(runtime => runtime.state === 'unavailable'))
    assert.ok(result.runtimes.some(runtime => runtime.host === 'electron-renderer' && runtime.state === 'available' && runtime.plugins.length > 0))
    await assert.rejects(runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), 'diagnose'],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 1024 * 1024 }), error => {
      assert.equal(error.code, 1)
      const report = JSON.parse(error.stdout)
      assert.deepEqual(report.runtimes, result.runtimes)
      assert.deepEqual(report.plugins, result.plugins)
      return true
    })
    const inventory = await requestLocalControl({ endpoint: resolveShellHost().endpoint('plugin-control'), request: { command: 'inventory' } })
    assert.deepEqual(inventory.plugins, host.list().map(plugin => ({ pluginId: plugin.manifest.id, host: plugin.manifest.host })))
    const managedId = 'odk.system.frame-status'
    for (const command of ['disable', 'enable']) {
      const operation = await runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), command, managedId, '--runtime'],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 1024 * 1024 })
      const { v, id, ...receipt } = JSON.parse(operation.stdout)
      assert.equal(v, 1)
      assert.match(id, /^[a-f0-9-]{36}$/)
      assert.deepEqual(receipt, { ok: true, scope: 'electron-main', pluginId: managedId,
        enabled: command === 'enable', state: command === 'enable' ? 'running' : 'disabled' })
    }
    const rendererEndpoint = resolveShellHost().endpoint('renderer-plugin-control')
    const rendererInventory = () => requestLocalControl({ endpoint: rendererEndpoint, request: { command: 'inventory' } })
    const beforeControl = await rendererInventory()
    assert.ok(beforeControl.plugins.some(plugin => plugin.pluginId === 'odk.theme.pixel'))
    await host.setEnabled('odk.system.renderer-control', false)
    await assert.rejects(rendererInventory())
    await host.setEnabled('odk.system.renderer-control', true)
    assert.deepEqual((await rendererInventory()).plugins, beforeControl.plugins)
    const appearanceState = () => win.webContents.executeJavaScript('({theme:window.odkTheme.get(),saved:localStorage.getItem("odk.theme")})')
    const appearance = await appearanceState()
    for (const command of ['disable', 'enable']) {
      const operation = await runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), command, 'odk.theme.pixel', '--runtime'],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 1024 * 1024 })
      const { v, id, ...receipt } = JSON.parse(operation.stdout)
      assert.equal(v, 1)
      assert.match(id, /^[a-f0-9-]{36}$/)
      assert.deepEqual(receipt, { ok: true, scope: 'electron-renderer', pluginId: 'odk.theme.pixel',
        enabled: command === 'enable', state: command === 'enable' ? 'running' : 'disabled' })
    }
    assert.deepEqual(await appearanceState(), appearance)
    assert.deepEqual(host.list(), records)
    assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), appState)
    for (const [name, value] of ports) assert.equal(host.get(name), value)
    assert.deepEqual(fs.existsSync(configPath) ? fs.readFileSync(configPath) : null, saved)
    assert.equal(await win.webContents.executeJavaScript('document===diagnosticDocument&&diagnosticNodes.length>0&&diagnosticNodes.every(node=>node.isConnected)'), true)
    return { version, entries: entries.length, runtimes: result.runtimes, mainStates, discoveryEntries, notificationResult, managementCommands: 2, rendererCommands: 2 }
  } }
}

module.exports = { prepareDiagnosticMain }
