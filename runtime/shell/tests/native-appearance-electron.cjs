'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadNativeAppearancePlugins } = require('../src/native-plugin-loader')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { registerUserAppScheme } = require('../src/user-app-system')
const { createRendererControlPlugin } = require('../src/renderer-management')
const { createNativeRendererActivator } = require('../src/native-renderer-activation')
const appearances = require('../src/renderer/core/appearance-plugins')

if (process.platform === 'darwin') app.dock.hide()
registerUserAppScheme(protocol)
const root = process.env.ODK_APPEARANCE_ROOT
assert.ok(root && path.isAbsolute(root), 'Appearance requires a private parent-owned root')
app.setPath('userData', path.join(root, 'profile'))
app.setPath('sessionData', path.join(root, 'session'))
const assets = createNativeRendererAssets()
let host
let win
const deadline = setTimeout(() => app.exit(1), 20000)

app.whenReady().then(async () => {
  const failedEntry = process.argv.includes('--failed-entry')
  const invalidPort = process.argv.includes('--invalid-port')
  const emptyStartup = process.argv.includes('--empty-startup')
  const source = path.join(root, 'source')
  fs.mkdirSync(source)
  const original = appearances.createAppearancePlugins().find(plugin => plugin.manifest.id === 'odk.theme.pixel')
  const manifest = { ...original.manifest, version: '3.0.0', entry: 'entry.js', appearance: {
    theme: 'pixel', name: 'Pixel', css: 'themes/pixel.css', tokens: {}, faces: ['zpix'], extra: 'image-rendering:pixelated;',
  } }
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(source, 'entry.js'), `(() => {
    const appearance = ${JSON.stringify(original.appearance)};
    window.__nativeAppearanceTrace = [];
    window.__nativeAppearanceVersion = '3.0.0';
    window.__nativeAppearanceExecutions = (window.__nativeAppearanceExecutions || 0) + 1;
    window.odkAppearanceNative.define({ id: 'odk.theme.pixel', appearance: structuredClone(appearance),
      create(ctx) {
        window.__nativeAppearanceTrace.push('create');
        window.__nativeAppearanceReleased = new Promise(resolve => { window.__nativeAppearanceRelease = resolve; });
        ctx.onCleanup(() => { window.__nativeAppearanceTrace.push('cleanup'); window.__nativeAppearanceRelease(); });
        return { ports: { 'odk:theme/pixel/v1': ${invalidPort} ? { ...appearance, faces: [] } : structuredClone(appearance) },
          start() { window.__nativeAppearanceTrace.push('start'); }, stop() { window.__nativeAppearanceTrace.push('stop'); },
          destroy() { window.__nativeAppearanceTrace.push('destroy'); } };
      } });
    if (${failedEntry}) throw Error('signed Appearance entry failed after registration');
  })();`)
  const keys = crypto.generateKeyPairSync('ed25519')
  function signSource() {
    const files = ['entry.js', 'manifest.json'].map(name => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(source, name))).digest('hex') }))
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
    fs.writeFileSync(path.join(source, 'bundle.json'), JSON.stringify({ ...payload,
      signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
  }
  signSource()
  const policy = path.join(root, 'publishers.json')
  fs.writeFileSync(policy, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), identities: [manifest.id], hosts: [manifest.host],
  } } }))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), XDG_RUNTIME_DIR: path.join(root, 'runtime'), OPEN_DESKOS_NATIVE_KEYRING: policy }
  fs.mkdirSync(env.XDG_RUNTIME_DIR, { mode: 0o700 })
  const run = require('node:util').promisify(require('node:child_process').execFile)
  await run(process.execPath, [path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js'), 'native', 'install', source, '--trust', '--keyring', policy], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  })
  let entries = emptyStartup ? [] : await loadNativeAppearancePlugins(readConfig(resolveConfigPath(env)), { env, assets })
  const revision = readConfig(resolveConfigPath(env)).plugins[manifest.id].native.revision
  const shellHost = require('../src/platform').resolveShellHost({ env })
  const stateDir = shellHost.stateDir
  fs.writeFileSync(path.join(stateDir, 'plugins', 'native', 'revisions', revision, 'entry.js'), 'throw Error("unverified stored entry")')
  const values = { 'odk-pi-sessions': { ok: true, sessions: [] }, 'odk-pi-session-events': { ok: true, events: [] },
    'odk-app-manager-list': [], 'odk-user-apps-list': [], 'odk-personal-bot-status': { state: 'unavailable' },
    'odk-remote-link-state': { state: 'disconnected', sequence: 0 } }
  for (const channel of ['odk-opencode-go-status', 'odk-camera-frame', 'odk-pi-sessions', 'odk-pi-session-events',
    'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-app-manager-list',
    'odk-app-manager-state', 'odk-app-manager-intent', 'odk-user-apps-list', 'odk-user-apps-dispatch', 'odk-user-apps-publish',
    'odk-personal-bot-status', 'odk-personal-bot-toggle', 'odk-personal-bot-proposal', 'odk-remote-link-state', 'odk-remote-publish-page-state']) {
    ipcMain.handle(channel, () => values[channel] || { status: 'unconfigured', state: 'unavailable' })
  }
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false,
  } })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    const NativeDate = Date;
    const fixtureTime = NativeDate.parse('2026-10-09T12:34:00+08:00');
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixtureTime])); }
      static now() { return fixtureTime; }
    };
  ` })
  const activate = createNativeRendererActivator({ env, assets, entries: () => entries,
    publishSelection(entry) { entries = [...entries.filter(current => current.manifest.id !== entry.manifest.id), entry] } })
  host = createPluginHost({ capabilities: { 'system.renderer-development': { ipc: ipcMain, protocol, nativeAssets: assets, runtimeNativeAssets: true,
    frames: () => [win.webContents], entries: () => entries },
    ...(process.platform === 'win32' ? {} : { 'system.renderer-control': { ipc: ipcMain,
      frames: () => [{ sender: win.webContents, mainFrame: () => win.webContents.mainFrame, send: win.webContents.send.bind(win.webContents) }],
      prepareActivation: activate, endpoint: shellHost.endpoint('renderer-plugin-control'), stateDir, platform: shellHost.platform } }),
  } })
  host.register(createRendererDevelopmentPlugin())
  if (process.platform !== 'win32') host.register(createRendererControlPlugin())
  await host.start()
  assert.ok(host.list().every(plugin => plugin.state === 'running'), JSON.stringify(host.list()))
  const load = async () => {
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), { query: { disabledPlugins: 'odk.tile.camera' } })
    await win.webContents.executeJavaScript('Promise.all([window.odkShellReady, window.odkTheme.ready, window.odkRendererDiagnosis.ready])')
  }
  await load()
  const pixel = await win.webContents.executeJavaScript("window.odkTheme.catalog().find(plugin => plugin.manifest.id === 'odk.theme.pixel')")
  const trace = () => win.webContents.executeJavaScript('window.__nativeAppearanceTrace')
  if (failedEntry) {
    assert.equal(pixel.manifest.version, '1.0.0')
    assert.deepEqual(await trace(), [])
  } else if (invalidPort) {
    assert.equal(pixel.state, 'failed')
    assert.deepEqual(await trace(), ['create', 'stop', 'destroy', 'cleanup'])
    assert.equal(await win.webContents.executeJavaScript('window.odkTheme.get()'), 'instrument')
  } else {
    assert.equal(pixel.manifest.version, emptyStartup ? '1.0.0' : '3.0.0')
    if (!emptyStartup) assert.deepEqual(await trace(), ['create', 'start'])
    await win.webContents.executeJavaScript("window.odkTheme.setEnabled('odk.theme.pixel', false)")
    assert.deepEqual(await win.webContents.executeJavaScript("({ theme: window.odkTheme.get(), saved: localStorage.getItem('odk.theme') })"),
      { theme: 'instrument', saved: 'pixel' })
    await win.webContents.executeJavaScript("window.odkTheme.setEnabled('odk.theme.pixel', true)")
    if (!emptyStartup) assert.deepEqual(await trace(), ['create', 'start', 'stop', 'destroy', 'cleanup', 'create', 'start'])
    const measure = () => win.webContents.executeJavaScript(`(async () => {
      const result = {};
      for (const theme of ['pixel', 'instrument', 'border-beam']) {
        window.odkTheme.set(theme); await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const el = document.querySelector('[data-widget="odk.tile.clock"] time'); const box = el.getBoundingClientRect(); const style = getComputedStyle(el);
        result[theme] = { text: el.textContent, font: style.fontFamily, size: style.fontSize, width: box.width, height: box.height,
          radius: getComputedStyle(document.documentElement).getPropertyValue('--odk-radius-card').trim(),
          primary: getComputedStyle(document.documentElement).getPropertyValue('--odk-primary').trim() };
      }
      window.odkTheme.set('pixel'); return result;
    })()`)
    const selected = await measure()
    if (process.platform !== 'win32') {
      await win.webContents.executeJavaScript(`window.__appearanceDocument = document;
        window.__appearanceClock = document.querySelector('[data-widget="odk.tile.clock"] time');`)
      const configPath = resolveConfigPath(env)
      const validConfig = fs.readFileSync(configPath, 'utf8')
      const validPolicy = fs.readFileSync(policy, 'utf8')
      fs.writeFileSync(configPath, '{malformed external selection')
      fs.writeFileSync(policy, JSON.stringify({ schemaVersion: 1, publishers: {} }))
      const configBefore = fs.readFileSync(configPath, 'utf8')
      const policyBefore = fs.readFileSync(policy, 'utf8')
      const result = await run(process.execPath, [path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js'),
        'restore-default', manifest.id, '--runtime'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
      const { id, v, ...receipt } = JSON.parse(result.stdout)
      assert.equal(v, 1)
      assert.match(id, /^[a-f0-9-]{36}$/)
      assert.deepEqual(receipt, { ok: true, scope: 'electron-renderer', pluginId: manifest.id,
        implementation: 'built-in', version: '1.0.0', state: 'running' })
      assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore)
      assert.equal(fs.readFileSync(policy, 'utf8'), policyBefore)
      assert.equal(await win.webContents.executeJavaScript(`document === window.__appearanceDocument &&
        document.querySelector('[data-widget="odk.tile.clock"] time') === window.__appearanceClock`), true)
      if (!emptyStartup) assert.deepEqual((await trace()).slice(-3), ['stop', 'destroy', 'cleanup'])
      assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('odk.theme')"), 'pixel')
      assert.deepEqual(await measure(), selected)
      assert.equal(await win.webContents.executeJavaScript("window.odkTheme.catalog().find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version"), '1.0.0')
      const command = args => run(process.execPath, [path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js'), ...args],
        { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
      await assert.rejects(command(['activate', manifest.id, '--runtime']))
      fs.writeFileSync(configPath, validConfig)
      await assert.rejects(command(['activate', manifest.id, '--runtime']), /activation-failed/)
      fs.writeFileSync(policy, validPolicy)
      await assert.rejects(command(['activate', manifest.id, '--runtime']), /hash mismatch|activation-failed/)
      const capturedEntry = fs.readFileSync(path.join(source, 'entry.js'), 'utf8')
      fs.writeFileSync(path.join(stateDir, 'plugins', 'native', 'revisions', revision, 'entry.js'), capturedEntry)
      fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: '4.0.0' }))
      fs.writeFileSync(path.join(source, 'entry.js'), capturedEntry.replace("__nativeAppearanceVersion = '3.0.0'", "__nativeAppearanceVersion = '4.0.0'"))
      signSource()
      await command(['native', 'update', manifest.id, source, '--trust', '--keyring', policy])
      const updatedConfig = fs.readFileSync(configPath, 'utf8')
      const updatedRevision = readConfig(configPath).plugins[manifest.id].native.revision
      for (let attempt = 0; attempt < 2; attempt++) {
        const activated = JSON.parse((await command(['activate', manifest.id, '--runtime'])).stdout)
        assert.equal(activated.pluginId, manifest.id)
        assert.equal(activated.scope, 'electron-renderer')
        assert.equal(activated.version, '4.0.0')
        assert.equal(activated.revision, updatedRevision)
        assert.equal(activated.state, 'running')
        assert.equal(fs.readFileSync(configPath, 'utf8'), updatedConfig)
        assert.equal(await win.webContents.executeJavaScript(`document === window.__appearanceDocument &&
          document.querySelector('[data-widget="odk.tile.clock"] time') === window.__appearanceClock &&
          window.__nativeAppearanceVersion === '4.0.0' && localStorage.getItem('odk.theme') === 'pixel'`), true)
        assert.deepEqual(await measure(), selected)
        assert.deepEqual(await trace(), attempt ? ['stop', 'destroy', 'cleanup', 'create', 'start'] : ['create', 'start'])
      }
      assert.equal(await win.webContents.executeJavaScript('window.__nativeAppearanceExecutions'), emptyStartup ? 2 : 3)
      await command(['restore-default', manifest.id, '--runtime'])
      assert.deepEqual((await trace()).slice(-3), ['stop', 'destroy', 'cleanup'])
      assert.deepEqual(await measure(), selected)
    }
    await win.webContents.executeJavaScript(`(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); await window.__nativeAppearanceReleased;
    })()`)
    assert.deepEqual((await trace()).slice(-3), ['stop', 'destroy', 'cleanup'])
    entries = []
    await load()
    assert.equal(await win.webContents.executeJavaScript("window.odkTheme.catalog().find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version"), '1.0.0')
    assert.deepEqual(await measure(), selected)
  }
  assert.equal(await win.webContents.executeJavaScript("localStorage.getItem('odk.theme')"), 'pixel')
  await host.stop()
  assets.close()
  console.log(JSON.stringify({ ok: true, signedAppearance: true, failedEntry, invalidPort, emptyStartup, capturedMutation: !emptyStartup, comparisonThemes: failedEntry || invalidPort ? 0 : 3, runtimeRecovery: !failedEntry && !invalidPort && process.platform !== 'win32', runtimeActivation: !failedEntry && !invalidPort && process.platform !== 'win32' }))
  win.destroy()
  app.quit()
}).catch(async error => {
  console.error(error)
  await host?.stop()
  assets.close()
  win?.destroy()
  app.exit(1)
}).finally(() => clearTimeout(deadline))
