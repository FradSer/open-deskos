'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const profile = process.env.ODK_HYDRA_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Hydra bootstrap requires a private parent-owned profile')
const exitPhase = event => fs.appendFileSync(path.join(profile, 'exit-phases.jsonl'),
  JSON.stringify({ event, at: Date.now() }) + '\n', { mode: 0o600 })
for (const event of ['before-quit', 'will-quit', 'quit']) app.on(event, () => exitPhase(event))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const version = process.env.ODK_HYDRA_BOOTSTRAP_VERSION
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
const signed = version !== '1.0.0'
const runtime = process.env.ODK_HYDRA_BOOTSTRAP_RUNTIME === '1'
assert.ok(!runtime || process.platform !== 'win32', 'Runtime activation requires isolated channels; Windows named pipes remain unverified')
const surfaceRuntime = process.env.ODK_HYDRA_BOOTSTRAP_SURFACE_RUNTIME === '1'
const cssRecovery = process.env.ODK_HYDRA_BOOTSTRAP_CSS_RECOVERY === '1'
assert.ok(!cssRecovery || process.platform !== 'win32', 'Renderer CSS recovery requires private Windows named pipes')
assert.ok(!surfaceRuntime || process.platform !== 'win32', 'Renderer runtime activation requires private Windows named pipes')
const surfaceVersion = process.env.ODK_HYDRA_BOOTSTRAP_SURFACE_VERSION
assert.ok(!surfaceVersion || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceVersion))
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS += ',' + surfaces.filter(id => !surfaceVersion || id !== 'odk.tile.hydra').join(',')
const sourceModule = require('../src/hydra-mqtt')
const defaultCreate = sourceModule.createHydraSource
let defaultConstructions = 0
sourceModule.createHydraSource = options => {
  defaultConstructions++
  assert.ok(!signed || runtime, 'Signed startup must not construct default Hydra outside runtime restoration')
  return defaultCreate(options)
}
const updates = new EventEmitter()
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  if (options?.capabilities?.['source.hydra']) {
    const capability = options.capabilities['source.hydra']
    assert.equal(capability.connect, sourceModule.connectHydraMqtt)
    const notify = capability.options.onUpdate
    capability.options = { ...capability.options, now: () => 1700000000000,
      onUpdate() { notify(); updates.emit('update') } }
    host = createHost(options)
    return host
  }
  return createHost(options)
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
const deadline = setTimeout(() => { void fail(Error('HYDRA_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      assert.ok(host)
      let selected = host.list().find(record => record.manifest.id === 'odk.source.hydra')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      let source = host.get('odk:source/hydra/v1')
      assert.equal(source.fixtureRevision, signed ? version : undefined)
      assert.ok(host.list().filter(record => !['odk.source.hydra', 'odk.system.renderer-development', ...(runtime ? ['odk.system.plugin-control'] : []), ...(surfaceRuntime || cssRecovery ? ['odk.system.renderer-control'] : [])].includes(record.manifest.id))
        .every(record => record.state === 'disabled'))
      const waitLive = source => new Promise(resolve => {
        const check = () => {
          const value = source.cachedSnapshot()
          if (value.mainOnline && value.env?.tempC === 24.5 && value.nodes[0]?.status === 'PULSE') {
            updates.removeListener('update', check)
            resolve()
          }
        }
        updates.on('update', check)
        check()
      })
      await waitLive(source)
      const runtimeVersions = []
      if (runtime) {
        const run = require('node:util').promisify(require('node:child_process').execFile)
        const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')
        const command = args => run(process.execPath, [cli, ...args], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
        })
        const { readConfig, resolveConfigPath } = require('../src/plugin-config')
        const configPath = resolveConfigPath(process.env)
        const baseline = await win.webContents.executeJavaScript('window.odkPlatform.getHydraStatus()')
        for (const target of ['2.0.0', '3.0.0']) {
          await command(['native', 'rollback', 'odk.source.hydra', '--keyring', process.env.ODK_NATIVE_KEYRING])
          const before = fs.readFileSync(configPath)
          const receipt = JSON.parse((await command(['activate', 'odk.source.hydra', '--runtime'])).stdout)
          assert.equal(receipt.version, target)
          assert.equal(receipt.revision, readConfig(configPath).plugins['odk.source.hydra'].native.revision)
          assert.deepEqual(fs.readFileSync(configPath), before)
          assert.equal(host.list().find(record => record.manifest.id === 'odk.source.hydra').manifest.version, target)
          source = host.get('odk:source/hydra/v1')
          assert.equal(source.fixtureRevision, target)
          await waitLive(source)
          assert.deepEqual(await win.webContents.executeJavaScript('window.odkPlatform.getHydraStatus()'), baseline)
          runtimeVersions.push(target)
          if (target === '2.0.0') {
            const restored = JSON.parse((await command(['restore-default', 'odk.source.hydra', '--runtime'])).stdout)
            assert.equal(restored.implementation, 'built-in')
            assert.equal(restored.version, '1.0.0')
            assert.equal(restored.revision, undefined)
            assert.deepEqual(fs.readFileSync(configPath), before)
            source = host.get('odk:source/hydra/v1')
            assert.equal(source.fixtureRevision, undefined)
            assert.equal(defaultConstructions, 1)
            await waitLive(source)
            assert.deepEqual(await win.webContents.executeJavaScript('window.odkPlatform.getHydraStatus()'), baseline)
            assert.equal(host.get('odk:plugin-health/odk.source.hydra/v1').snapshot().state, 'healthy')
            runtimeVersions.push('1.0.0')
          }
        }
        selected = host.list().find(record => record.manifest.id === 'odk.source.hydra')
      }
      const snapshot = await win.webContents.executeJavaScript('window.odkPlatform.getHydraStatus()')
      assert.equal(snapshot.connected, true)
      assert.equal(snapshot.mainOnline, true)
      let surface
      if (surfaceVersion) {
        const readSurface = () => win.webContents.executeJavaScript(`(async () => {
          await window.odkShellReady;
          const deadline = performance.now() + 8000;
          let tile;
          while (!(tile = document.querySelector('[data-widget="odk.tile.hydra"]'))
            || tile.querySelector('#hydra-env-temp .hydra-env-value')?.textContent !== '24.5'
            || tile.querySelector('#hydra-plant-1 .hydra-plant-soil')?.textContent !== '42%'
            || tile.getBoundingClientRect().width < 480
            || tile.getBoundingClientRect().height < 186
            || tile.querySelector('.hydra-body')?.dataset.shape !== 'wide-short') {
            if (performance.now() > deadline) throw Error('Actual Main Hydra Widget did not render');
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          return { version: window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.hydra').manifest.version,
            executedVersion: window.odkHydraSurfaceRevision || null,
            readings: ['temp', 'humidity', 'pressure', 'lux'].map(key => tile.querySelector('#hydra-env-' + key + ' .hydra-env-value').textContent),
            units: ['temp', 'humidity', 'pressure', 'lux'].map(key => tile.querySelector('#hydra-env-' + key + ' .hydra-env-unit').textContent),
            badge: tile.querySelector('#hydra-badge').textContent,
            plant: { text: tile.querySelector('#hydra-plant-1 .hydra-plant-soil').textContent,
              watering: tile.querySelector('#hydra-plant-1').classList.contains('hydra-watering'),
              meter: tile.querySelector('#hydra-plant-1 .hydra-meter-fill').style.transform },
            rendered: [...tile.querySelectorAll('*')].map(node => ({ tag: node.tagName,
              attributes: [...node.attributes].map(attribute => [attribute.name, attribute.value]).sort((a, b) => a[0].localeCompare(b[0])),
              text: node.children.length ? null : node.textContent })) };
        })()`)
        surface = await readSurface()
        assert.equal(surface.version, surfaceVersion)
        assert.equal(surface.executedVersion, surfaceVersion === '1.0.0' ? null : surfaceVersion)
        assert.deepEqual(surface.readings, ['24.5', '61', '1003', '12.3k'])
        assert.deepEqual(surface.units, ['°C', '%', 'hPa', 'lx'])
        assert.equal(surface.badge, 'Live')
        assert.deepEqual(surface.plant, { text: '42%', watering: true, meter: 'scaleX(0.42)' })
        const entries = await win.webContents.executeJavaScript('window.odkRendererPluginBridge.list()')
        surface.entries = entries.length
        assert.equal(entries.length, surfaceVersion === '1.0.0' ? 0 : 1)
        if (entries.length) {
          assert.equal(entries[0].manifest.id, 'odk.tile.hydra')
          assert.equal(entries[0].manifest.version, surfaceVersion)
          assert.match(entries[0].entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/entry\.js$/)
          if (cssRecovery) assert.match(entries[0].cssUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/surface\.css$/)
          else assert.equal(entries[0].cssUrl, undefined)
        }
        surface.protocolActive = protocol.isProtocolHandled('odk-native-plugin')
        assert.equal(surface.protocolActive, surfaceVersion !== '1.0.0' || surfaceRuntime)
        if (cssRecovery) {
          const selector = '[data-widget="odk.tile.hydra"]'
          assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue('--odk-fixture-css').trim()`), 'selected')
          await win.webContents.executeJavaScript(`window.odkRetainedDocument = document;
            window.odkRetainedDesktop = document.querySelector(${JSON.stringify(selector)});`)
          const run = require('node:util').promisify(require('node:child_process').execFile)
          const { resolveConfigPath } = require('../src/plugin-config')
          const configPath = resolveConfigPath(process.env)
          const before = fs.readFileSync(configPath)
          const receipt = JSON.parse((await run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'),
            'restore-default', 'odk.tile.hydra', '--runtime'], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
          })).stdout)
          assert.equal(receipt.implementation, 'built-in')
          assert.equal(receipt.version, '1.0.0')
          assert.deepEqual(fs.readFileSync(configPath), before)
          const restored = await readSurface()
          assert.equal(restored.version, '1.0.0')
          assert.deepEqual(restored.rendered, surface.rendered)
          assert.equal(await win.webContents.executeJavaScript(`document === window.odkRetainedDocument
            && document.querySelector(${JSON.stringify(selector)}) === window.odkRetainedDesktop
            && !document.querySelector('link[data-plugin="odk.tile.hydra"]')
            && getComputedStyle(window.odkRetainedDesktop).getPropertyValue('--odk-fixture-css').trim() === ''`), true)
          assert.equal(host.get('odk:source/hydra/v1'), source)
          surface.stylesheetRestored = true
        }
        if (surfaceRuntime) {
          assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-control').state, 'running')
          await win.webContents.executeJavaScript(`window.odkRetainedDocument = document;
            window.odkRetainedDesktop = document.querySelector('[data-widget="odk.tile.hydra"]');`)
          const run = require('node:util').promisify(require('node:child_process').execFile)
          const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')
          const command = args => run(process.execPath, [cli, ...args], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
          })
          const { readConfig, resolveConfigPath } = require('../src/plugin-config')
          const configPath = resolveConfigPath(process.env)
          surface.runtimeVersions = []
          for (const target of ['2.0.0', '3.0.0']) {
            if (surfaceVersion === '1.0.0') {
              const bundle = process.env[target === '2.0.0' ? 'ODK_HYDRA_BOOTSTRAP_SURFACE_FIRST' : 'ODK_HYDRA_BOOTSTRAP_SURFACE_NEXT']
              assert.ok(bundle && path.isAbsolute(bundle), 'Runtime surface install requires a private parent-owned bundle')
              await command(['native', ...(target === '2.0.0' ? ['install', bundle] : ['update', 'odk.tile.hydra', bundle]),
                '--keyring', process.env.ODK_NATIVE_KEYRING, '--trust'])
            } else await command(['native', 'rollback', 'odk.tile.hydra', '--keyring', process.env.ODK_NATIVE_KEYRING])
            const before = fs.readFileSync(configPath)
            const receipt = JSON.parse((await command(['activate', 'odk.tile.hydra', '--runtime'])).stdout)
            assert.equal(receipt.scope, 'electron-renderer')
            assert.equal(receipt.version, target)
            assert.equal(receipt.revision, readConfig(configPath).plugins['odk.tile.hydra'].native.revision)
            assert.deepEqual(fs.readFileSync(configPath), before)
            const running = await readSurface()
            assert.equal(running.version, target)
            assert.equal(running.executedVersion, target)
            assert.deepEqual(running.rendered, surface.rendered)
            assert.equal(await win.webContents.executeJavaScript(`document === window.odkRetainedDocument
              && document.querySelector('[data-widget="odk.tile.hydra"]') === window.odkRetainedDesktop`), true)
            assert.equal(host.get('odk:source/hydra/v1'), source)
            surface.runtimeVersions.push(target)
            if (target === '2.0.0') {
              const policyPath = process.env.ODK_NATIVE_KEYRING
              const policy = fs.readFileSync(policyPath)
              const broken = Buffer.from('{ malformed fixture configuration')
              const revoked = Buffer.from(JSON.stringify({ schemaVersion: 1, publishers: {} }))
              fs.writeFileSync(configPath, broken)
              fs.writeFileSync(policyPath, revoked)
              try {
                const restored = JSON.parse((await command(['restore-default', 'odk.tile.hydra', '--runtime'])).stdout)
                assert.equal(restored.scope, 'electron-renderer')
                assert.equal(restored.implementation, 'built-in')
                assert.equal(restored.version, '1.0.0')
                assert.equal(restored.revision, undefined)
                assert.deepEqual(fs.readFileSync(configPath), broken)
                assert.deepEqual(fs.readFileSync(policyPath), revoked)
                const builtin = await readSurface()
                assert.equal(builtin.version, '1.0.0')
                assert.deepEqual(builtin.rendered, surface.rendered)
                assert.equal(await win.webContents.executeJavaScript(`document === window.odkRetainedDocument
                  && document.querySelector('[data-widget="odk.tile.hydra"]') === window.odkRetainedDesktop`), true)
                assert.equal(host.get('odk:source/hydra/v1'), source)
                surface.runtimeVersions.push('1.0.0')
              } finally {
                fs.writeFileSync(configPath, before)
                fs.writeFileSync(policyPath, policy)
              }
              const resumed = JSON.parse((await command(['activate', 'odk.tile.hydra', '--runtime'])).stdout)
              assert.equal(resumed.version, '2.0.0')
              assert.deepEqual((await readSurface()).rendered, surface.rendered)
              assert.deepEqual(fs.readFileSync(configPath), before)
              surface.runtimeVersions.push('2.0.0')
            }
          }
        }
      }
      const cached = source.cachedSnapshot
      let cachedReads = 0
      source.snapshot = () => { throw Error('Health must not call ordinary Hydra snapshot') }
      source.cachedSnapshot = (...args) => { cachedReads++; return cached(...args) }
      const cachedHealth = host.get('odk:plugin-health/odk.source.hydra/v1')
      const health = cachedHealth.snapshot()
      assert.deepEqual(cachedHealth.snapshot(), health)
      assert.equal(cachedReads, 2)
      report = { ...(surfaceVersion ? { surface } : {}), ...(runtime ? { runtimeVersions } : {}), productionMain: true, actualPreload: true, pid: process.pid, version: selected.manifest.version,
        executedVersion: signed ? source.fixtureRevision : selected.manifest.version,
        defaultConstructions, hidden: !win.isVisible(), consumer: { snapshot, health } }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.has('odk-hydra-status'), false)
    assert.equal(host.list().find(record => record.manifest.id === 'odk.source.hydra').state, 'stopped')
    if (runtime) assert.equal(host.list().find(record => record.manifest.id === 'odk.system.plugin-control').state, 'stopped')
    if (surfaceRuntime || cssRecovery) assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-control').state, 'stopped')
    if (surfaceVersion) {
      assert.equal(handlers.has('odk-renderer-development-plugins'), false)
      assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
      assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-development').state, 'stopped')
      report.surface.released = true
    }
    clearTimeout(deadline)
    exitPhase('release-verified')
    console.log(JSON.stringify({ ...report, handlerReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
