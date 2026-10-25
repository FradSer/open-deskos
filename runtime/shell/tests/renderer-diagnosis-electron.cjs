'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
ipcMain.handle('odk-personal-agent-consumer-ready', () => ({ accepted: false }))
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { requestDiagnostics } = require('../src/plugin-diagnostics')
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const { loadDevelopmentPlugins, loadAppearanceReplacements } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { registerUserAppScheme } = require('../src/user-app-system')
const { selectAppearancePlugins } = require('../src/renderer/core/appearance-plugins')
if (process.platform === 'darwin') app.dock.hide()
registerUserAppScheme(protocol)

const root = fs.mkdtempSync(path.join((process.argv.includes('--diagnosis-selection-proof') || process.argv.includes('--bridge-diagnosis-proof')) && process.platform === 'darwin'
  ? '/tmp' : os.tmpdir(), 'odk-rdiag-'))
app.setPath('userData', path.join(root, 'profile'))
let host
let win
const deadline = setTimeout(() => { console.error('Renderer diagnosis fixture timed out'); app.exit(1) }, 15000)

app.whenReady().then(async () => {
  const diagnosisProof = process.argv.includes('--diagnosis-selection-proof')
  const bridgeDiagnosisProof = process.argv.includes('--bridge-diagnosis-proof')
  const selectedDiagnosisBridge = process.argv.includes('--selected-diagnosis-bridge')
  let bridgeDiagnosisSelection
  const selectedDiagnosis = process.argv.includes('--selected-diagnosis')
  const selectedDiscovery = process.argv.includes('--selected-discovery')
  const selectedControl = process.argv.includes('--selected-renderer-control')
  let diagnosisSelection
  const disabledAppearance = process.argv.includes('--disabled-appearance')
  const rendererControl = process.argv.includes('--renderer-control') || selectedControl
  const linkedAppearance = process.argv.includes('--linked-appearance')
  const invalidAppearanceFactory = process.argv.includes('--invalid-appearance-factory')
  const appearanceFactory = process.argv.includes('--appearance-factory') || invalidAppearanceFactory
  let appearanceScript
  const nativeMode = process.argv.includes('--signed-native-renderer') || process.argv.includes('--failed-native-entry') || process.argv.includes('--corrupt-native-entry')
  const corruptNativeEntry = process.argv.includes('--corrupt-native-entry')
  const nativeAssets = createNativeRendererAssets()
  let nativeEntries = []
  const failedLinkedEntry = process.argv.includes('--failed-linked-entry') || process.argv.includes('--failed-native-entry')
  const unavailableLinkedCss = process.argv.includes('--unavailable-linked-css')
  const rejectedLinkedEntry = failedLinkedEntry || unavailableLinkedCss || corruptNativeEntry
  const linkedMode = process.argv.includes('--linked-development') || rejectedLinkedEntry || nativeMode
  const developmentEnv = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config') }
  const controlEnv = { ...developmentEnv, XDG_RUNTIME_DIR: path.join(root, 'runtime'), XDG_STATE_HOME: path.join(root, 'state-home') }
  fs.mkdirSync(controlEnv.XDG_RUNTIME_DIR, { mode: 0o700 })
  const controlHost = require('../src/platform').resolveShellHost({ env: controlEnv })
  if (linkedAppearance) {
    const folder = path.join(root, 'appearance')
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'odk.theme.pixel', name: 'Selected Pixel', version: '2.0.0',
      host: 'electron-renderer', kind: 'surface', provides: [{ interface: 'odk:theme/pixel/v1' }], requires: [], permissions: [],
      appearance: { theme: 'pixel', name: 'Selected Pixel', css: 'themes/pixel.css', faces: ['zpix'], extra: 'image-rendering:pixelated;', tokens: { '--odk-primary': '#fafafa' } } }))
    const run = require('node:util').promisify(require('node:child_process').execFile)
    await run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'link', folder, '--trust', '--replace'], {
      env: { ...developmentEnv, ELECTRON_RUN_AS_NODE: '1' },
    })
  }
  if (linkedMode) {
    const folder = path.join(root, 'development')
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'odk.tile.year', name: 'Linked Clock', version: '2.0.0',
      kind: 'surface', host: 'electron-renderer', surfaceKind: 'tile', interaction: 'display-only',
      provides: [{ interface: 'odk:surface/odk.tile.year/v1' }], requires: [], permissions: [], entry: 'entry.js', css: 'clock.css' }))
    fs.writeFileSync(path.join(folder, 'clock.css'), '[data-widget="odk.tile.year"] { --odk-linked-css-fixture: loaded; }')
    fs.writeFileSync(path.join(folder, 'entry.js'), `
      (() => {
      const original = window.odkPlugins.get('odk.tile.year');
      window.__odkReplacementTrace = [];
      window.odkRendererDevelopment.define({ id: original.id, kind: 'tile', interaction: 'display-only', app: 'Clock',
        create() { window.__odkReplacementTrace.push('create'); return { stop() { window.__odkReplacementTrace.push('stop'); } }; },
        mount(el, ctx) { window.__odkReplacementTrace.push('mount'); return original.lifecycle.mount.call(original, el, ctx); },
        unmount(el, ctx) { window.__odkReplacementTrace.push('unmount'); return original.lifecycle.unmount.call(original, el, ctx); },
      });
      if (${failedLinkedEntry}) throw Error('entry failed after registration');
      })();
    `)
    const execFile = require('node:util').promisify(require('node:child_process').execFile)
    if (nativeMode) {
      fs.mkdirSync(path.join(folder, 'assets'))
      fs.writeFileSync(path.join(folder, 'assets', 'extra.css'), '[data-widget="odk.tile.year"] { --odk-native-relative-fixture: captured; }')
      fs.writeFileSync(path.join(folder, 'clock.css'), '@import url("assets/extra.css");\n' + fs.readFileSync(path.join(folder, 'clock.css'), 'utf8'))
      fs.writeFileSync(path.join(folder, 'assets', 'value.json'), '{"value":42}')
      // Use an independent factory with the same Clock behavior and scoped tick.
      fs.writeFileSync(path.join(folder, 'entry.js'), `(() => {
        window.__odkReplacementTrace = [];
        window.odkRendererDevelopment.define({ id: 'odk.tile.year', kind: 'tile', app: 'Clock', state: 'Available', interaction: 'display-only',
          create() { window.__odkReplacementTrace.push('create'); return { stop() { window.__odkReplacementTrace.push('stop'); } }; },
          mount(el, ctx) {
            window.__odkReplacementTrace.push('mount');
            el.innerHTML = '<div class="widget-signal clock-body"><time class="w-clock-time">--:--</time></div>';
            const time = el.querySelector('time');
            ctx.onTick(now => { const reading = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
              if (time.textContent !== reading) { time.textContent = reading; time.dateTime = reading; } });
          },
          unmount() { window.__odkReplacementTrace.push('unmount'); },
        });
        if (${failedLinkedEntry}) throw Error('signed entry failed after registration');
      })();`)
      const crypto = require('node:crypto')
      const keys = crypto.generateKeyPairSync('ed25519')
      const files = ['assets/extra.css', 'assets/value.json', 'clock.css', 'entry.js', 'manifest.json'].map(name => ({ path: name,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex') }))
      const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
      fs.writeFileSync(path.join(folder, 'bundle.json'), JSON.stringify({ ...payload,
        signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
      const policy = path.join(root, 'publishers.json')
      fs.writeFileSync(policy, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), identities: ['odk.tile.year'], hosts: ['electron-renderer'],
      } } }))
      controlEnv.ODK_NATIVE_KEYRING = policy
      await execFile(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'native', 'install', folder, '--trust', '--keyring', policy], {
        env: { ...controlEnv, ELECTRON_RUN_AS_NODE: '1' },
      })
      const config = readConfig(resolveConfigPath(controlEnv))
      const revision = config.plugins['odk.tile.year'].native.revision
      const stored = path.join(controlHost.stateDir, 'plugins', 'native', 'revisions', revision)
      if (corruptNativeEntry) fs.writeFileSync(path.join(stored, 'entry.js'), 'unverified before discovery')
      nativeEntries = await loadNativeRendererPlugins(config, { env: controlEnv, assets: nativeAssets, report() {} })
      fs.writeFileSync(path.join(stored, 'entry.js'), 'throw Error("unverified entry must not execute")')
      fs.writeFileSync(path.join(stored, 'clock.css'), 'body { display:none }')
      fs.writeFileSync(path.join(stored, 'assets', 'extra.css'), 'body { display:none }')
    } else {
      await execFile(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'link', folder, '--trust', '--replace'], {
        env: { ...developmentEnv, ELECTRON_RUN_AS_NODE: '1' },
      })
    }
  }
  const values = {
    'odk-pi-sessions': { ok: true, sessions: [] }, 'odk-pi-session-events': { ok: true, events: [] },
    'odk-app-manager-list': [], 'odk-user-apps-list': [],
    'odk-personal-agent-status': { state: 'unavailable' }, 'odk-remote-link-state': { state: 'disconnected', sequence: 0 },
  }
  const remoteStates = []
  for (const channel of ['odk-opencode-go-status', 'odk-camera-frame', 'odk-pi-sessions', 'odk-pi-session-events',
    'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-app-manager-list',
    'odk-app-manager-state', 'odk-app-manager-intent', 'odk-user-apps-list', 'odk-user-apps-dispatch',
    'odk-user-apps-publish', 'odk-personal-agent-status', 'odk-personal-agent-toggle', 'odk-personal-agent-proposal',
    'odk-remote-link-state', 'odk-remote-publish-page-state']) {
    ipcMain.handle(channel, (_event, payload) => {
      if (channel === 'odk-remote-publish-page-state') remoteStates.push(payload)
      return values[channel] || { status: 'unconfigured', state: 'unavailable' }
    })
  }
  const endpoint = diagnosisProof ? controlHost.endpoint('plugin-diagnostics') : path.join(root, 'diag.sock')
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: appearanceFactory, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true,
  } })
  const runtimeLifecycle = process.argv.includes('--runtime-lifecycle')
  const invalidReplacement = process.argv.includes('--invalid-replacement')
  const replacementMode = process.argv.includes('--replacement') || invalidReplacement || runtimeLifecycle
  if (replacementMode) {
    await win.loadURL('about:blank')
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Page.enable')
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__odkReplacementTrace = [];
      Object.defineProperty(window, 'odkRendererReplacements', { get() {
        const original = window.odkPlugins.get('odk.tile.year');
        if (${invalidReplacement}) return [{ ...original, kind: 'page' }];
        original.create = () => { throw Error('unselected factory must not execute'); };
        return [{ ...original, manifest: { ...original.manifest, version: '2.0.0' },
          create() { window.__odkReplacementTrace.push('create'); return { stop() { window.__odkReplacementTrace.push('stop'); } }; },
          lifecycle: {
            mount(el, ctx) { window.__odkReplacementTrace.push('mount'); return original.lifecycle.mount.call(original, el, ctx); },
            unmount(el, ctx) { window.__odkReplacementTrace.push('unmount'); return original.lifecycle.unmount.call(original, el, ctx); },
          },
        }];
      } });
    ` })
  }
  if (appearanceFactory) {
    if (!win.webContents.debugger.isAttached()) {
      await win.loadURL('about:blank')
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Page.enable')
    }
    appearanceScript = await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__odkAppearanceTrace = [];
      let cleanups = 0;
      window.__odkAppearanceReleased = new Promise(resolve => { window.__odkAppearanceRelease = resolve; });
      Object.defineProperty(window, 'odkAppearanceFactoryReplacements', { get() {
        const original = window.odkAppearancePlugins.selectAppearancePlugins([]).find(item => item.manifest.id === 'odk.theme.pixel');
        return [{ ...original, manifest: { ...original.manifest, version: '3.0.0' },
          appearance: ${invalidAppearanceFactory} ? { ...original.appearance, faces: [] } : original.appearance,
          create(ctx) {
            window.__odkAppearanceTrace.push('create');
            ctx.onCleanup(() => {
              window.__odkAppearanceTrace.push('cleanup');
              if (++cleanups === 2) window.__odkAppearanceRelease();
            });
            return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) },
              start() { window.__odkAppearanceTrace.push('start'); },
              stop() { window.__odkAppearanceTrace.push('stop'); },
              destroy() { window.__odkAppearanceTrace.push('destroy'); },
            };
          },
        }];
      } });
    ` })
  }
  host = createPluginHost({ capabilities: {
    'system.renderer-control': { ipc: ipcMain, frames: () => [{ sender: win.webContents,
      mainFrame: () => win.webContents.mainFrame, send: win.webContents.send.bind(win.webContents) }],
      endpoint: controlHost.endpoint('renderer-plugin-control'), stateDir: controlHost.stateDir, platform: controlHost.platform },
    'system.renderer-diagnostics': { ipc: ipcMain, frames: () => [{ id: win.webContents.id, sender: win.webContents,
      mainFrame: () => win.webContents.mainFrame, send: win.webContents.send.bind(win.webContents) }] },
    'system.renderer-development': { ipc: ipcMain, protocol, nativeAssets, frames: () => [win.webContents], entries: () => {
      if (nativeMode) return nativeEntries
      if (!linkedMode) return []
      const entries = loadDevelopmentPlugins(readConfig(resolveConfigPath(developmentEnv)), { host: 'electron-renderer' })
      if (unavailableLinkedCss) fs.unlinkSync(path.join(root, 'development', 'clock.css'))
      return entries
    } },
    'plugin.diagnostics': { endpoint, stateDir: path.join(root, 'state'), platform: process.platform, snapshot: () => host.list() },
  } })
  const diagnosisId = 'odk.system.renderer-diagnostics'
  const replacementPlugins = selectedDiagnosis ? [require('./fixtures/renderer-diagnostics-replacement').independentRendererDiagnostics()] : []
  if (selectedDiscovery) replacementPlugins.push(require('./fixtures/renderer-development-replacement').independentRendererDevelopment())
  if (selectedControl) replacementPlugins.push(require('./fixtures/renderer-control-replacement').independentRendererControl())
  createMainPlugins({ replacementPlugins, onDefaults(defaults) {
    if (selectedDiagnosis) defaults.find(plugin => plugin.manifest.id === diagnosisId).create = () => { throw Error('default Renderer diagnosis factory executed') }
    if (selectedDiscovery) defaults.find(plugin => plugin.manifest.id === 'odk.system.renderer-development').create = () => { throw Error('default Renderer discovery factory executed') }
    if (selectedControl) defaults.find(plugin => plugin.manifest.id === 'odk.system.renderer-control').create = () => { throw Error('default Renderer control factory executed') }
  } }).filter(plugin => ['odk.system.renderer-diagnostics', 'odk.system.plugin-diagnostics', 'odk.system.renderer-development',
    ...(rendererControl ? ['odk.system.renderer-control'] : [])].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  if (selectedDiscovery) {
    const discovery = host.list().find(plugin => plugin.manifest.id === 'odk.system.renderer-development')
    assert.equal(discovery.manifest.version, '2.0.0')
    assert.equal(discovery.state, 'running')
  }
  if (diagnosisProof) assert.equal(host.list().find(plugin => plugin.manifest.id === diagnosisId).manifest.version,
    process.env.ODK_DIAGNOSIS_EXPECTED_VERSION, 'selected Renderer diagnosis is missing')
  if (disabledAppearance) {
    const run = require('node:util').promisify(require('node:child_process').execFile)
    await run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'disable', 'odk.theme.pixel'], {
      env: { ...developmentEnv, ELECTRON_RUN_AS_NODE: '1' },
    })
  }
  const { resolveStartupDisabled } = require('../src/plugin-config')
  const statusReconcile = process.argv.includes('--status-reconcile')
  const runtimeController = process.argv.includes('--runtime-controller')
  const disabled = ['odk.tile.weather', ...(statusReconcile || runtimeController || rendererControl ? ['odk.status.clock'] : []),
    ...(runtimeController ? ['odk.page.dashboard'] : []), ...resolveStartupDisabled(developmentEnv)]
  const appearances = loadAppearanceReplacements(readConfig(resolveConfigPath(developmentEnv)))
  const query = { disabledPlugins: disabled.join(','), ...(appearances.length ? { appearanceReplacements: JSON.stringify(appearances) } : {}) }
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), { query })
  await win.webContents.executeJavaScript('Promise.all([window.odkShellReady, window.odkRendererDiagnosis.ready, window.odkTheme.ready])')
  if (bridgeDiagnosisProof) {
    await win.webContents.executeJavaScript(`(async () => {
      window.bridgeRetainedDocument = document;
      window.bridgeRetainedClock = document.querySelector('[data-widget="odk.tile.year"]');
      if (${selectedDiagnosisBridge}) {
        const runtime = window.odkRendererDiagnosis;
        const manifest = runtime.catalog().find(plugin => plugin.manifest.id === 'odk.renderer.plugin-diagnostics').manifest;
        await runtime.replace({ manifest: { ...manifest, version: '2.0.0' }, create(ctx) {
          const api = ctx.capability('renderer.diagnosis');
          const unsubscribe = api.onRequest(request => {
            if (ctx.signal.aborted) return;
            api.report(request.requestId, [...window.odkPlugins.catalog(), ...window.odkTheme.catalog(), ...runtime.catalog()]);
          });
          ctx.onCleanup(() => { unsubscribe(); window.bridgeSelectedSubscriptionReleased = true; });
          return {};
        } });
      }
    })()`)
    const version = await win.webContents.executeJavaScript(`odkRendererDiagnosis.catalog()
      .find(plugin => plugin.manifest.id === 'odk.renderer.plugin-diagnostics').manifest.version`)
    assert.equal(version, process.env.ODK_RENDERER_BRIDGE_EXPECTED_VERSION, 'selected Renderer diagnosis bridge is missing')
  }
  const report = await requestDiagnostics({ endpoint, platform: process.platform })
  const renderer = report.runtimes.find(runtime => runtime.host === 'electron-renderer')
  const resident = report.runtimes.find(runtime => runtime.host === 'personal-agent' && runtime.instance === 'runtime')
  assert.equal(resident.state, 'unavailable')
  assert.equal(resident.reason, 'provider-unavailable')
  const hosted = report.runtimes.find(runtime => runtime.host === 'personal-agent' && runtime.instance === 'hosted-pi')
  assert.equal(hosted.state, 'unavailable')
  assert.equal(hosted.reason, 'provider-unavailable')
  const bridge = report.runtimes.find(runtime => runtime.host === 'remote-bridge')
  assert.equal(bridge.state, 'unavailable')
  assert.equal(bridge.reason, 'provider-unavailable')
  assert.equal(renderer.state, 'available')
  assert.equal(renderer.plugins.find(plugin => plugin.manifest.id === 'odk.tile.weather').state, 'disabled')
  assert.equal(renderer.plugins.find(plugin => plugin.manifest.id === 'odk.theme.pixel').state, disabledAppearance ? 'disabled' : 'running')
  if (linkedAppearance) {
    assert.equal(renderer.plugins.find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version, '2.0.0')
    assert.deepEqual(await win.webContents.executeJavaScript(`({ theme: window.odkTheme.get(), value: getComputedStyle(document.documentElement).getPropertyValue('--odk-primary').trim() })`),
      { theme: 'pixel', value: '#fafafa' })
    const { createUserAppResponse } = require('../src/user-app-protocol')
    const { buildUserAppDocument, USER_APP_CSP } = require('../src/user-app-content')
    const plugins = selectAppearancePlugins(appearances)
    const store = { getContent: async () => ({ ok: true, app: { id: 'fixture', revision: 'a'.repeat(32) }, html: '<html><body><p>Fixture</p></body></html>' }) }
    protocol.handle('odk-user-app', request => createUserAppResponse(request.url, store, buildUserAppDocument, USER_APP_CSP, { appearancePlugins: plugins }))
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const frame = document.createElement('iframe'); frame.hidden = true; frame.sandbox = 'allow-scripts';
      frame.onload = resolve; frame.onerror = reject;
      frame.src = 'odk-user-app://app/fixture/${'a'.repeat(32)}?theme=pixel'; document.body.appendChild(frame);
    })`)
    const frame = win.webContents.mainFrame.frames.find(item => item.url.includes('/fixture/'))
    assert.ok(frame)
    assert.equal(await frame.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--odk-primary').trim()"), '#fafafa')
    assert.deepEqual(await frame.executeJavaScript(`({ radius: getComputedStyle(document.documentElement).getPropertyValue('--odk-radius-card').trim(), font: getComputedStyle(document.documentElement).getPropertyValue('--odk-font').trim() })`),
      { radius: '0px', font: '"Zpix", monospace' })
    protocol.unhandle('odk-user-app')
    const run = require('node:util').promisify(require('node:child_process').execFile)
    await run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'remove', 'odk.theme.pixel'], {
      env: { ...developmentEnv, ELECTRON_RUN_AS_NODE: '1' },
    })
    assert.equal(loadAppearanceReplacements(readConfig(resolveConfigPath(developmentEnv))).length, 0)
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), { query: { disabledPlugins: disabled.join(',') } })
    await win.webContents.executeJavaScript('Promise.all([window.odkShellReady, window.odkRendererDiagnosis.ready, window.odkTheme.ready])')
    assert.equal(await win.webContents.executeJavaScript("window.odkTheme.catalog().find(item => item.manifest.id === 'odk.theme.pixel').manifest.version"), '1.0.0')
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--odk-primary').trim()"), '#ffffff')
    assert.equal(fs.existsSync(path.join(root, 'appearance', 'manifest.json')), true)
  }
  if (disabledAppearance) {
    assert.deepEqual(await win.webContents.executeJavaScript(`({ theme: window.odkTheme.get(), saved: localStorage.getItem('odk.theme') })`),
      { theme: 'instrument', saved: 'pixel' })
    const run = require('node:util').promisify(require('node:child_process').execFile)
    await run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'enable', 'odk.theme.pixel'], {
      env: { ...developmentEnv, ELECTRON_RUN_AS_NODE: '1' },
    })
    const enabled = ['odk.tile.weather', ...resolveStartupDisabled(developmentEnv)]
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), { query: { disabledPlugins: enabled.join(',') } })
    await win.webContents.executeJavaScript('Promise.all([window.odkShellReady, window.odkRendererDiagnosis.ready, window.odkTheme.ready])')
    assert.equal(await win.webContents.executeJavaScript('window.odkTheme.get()'), 'pixel')
    assert.equal(await win.webContents.executeJavaScript("window.odkTheme.catalog().find(item => item.manifest.id === 'odk.theme.pixel').state"), 'running')
  }
  assert.equal(renderer.plugins.find(plugin => plugin.manifest.id === 'odk.renderer.plugin-diagnostics').state, 'running')
  if (bridgeDiagnosisProof) {
    const plugin = renderer.plugins.find(plugin => plugin.manifest.id === 'odk.renderer.plugin-diagnostics')
    assert.equal(plugin.manifest.version, process.env.ODK_RENDERER_BRIDGE_EXPECTED_VERSION)
    const documentRetained = await win.webContents.executeJavaScript(`document === bridgeRetainedDocument
      && bridgeRetainedClock.isConnected && document.querySelector('[data-widget="odk.tile.year"]') === bridgeRetainedClock`)
    assert.equal(documentRetained, true)
    bridgeDiagnosisSelection = { version: plugin.manifest.version, documentRetained, plugins: renderer.plugins }
  }
  const selected = await requestDiagnostics({ endpoint, platform: process.platform, pluginId: 'odk.tile.weather' })
  assert.equal(selected.plugins.length, 0)
  const selectedRenderer = selected.runtimes.find(runtime => runtime.host === 'electron-renderer')
  assert.equal(selectedRenderer.plugins.length, 1)
  assert.equal(selectedRenderer.plugins[0].manifest.id, 'odk.tile.weather')
  if (diagnosisProof) {
    const port = require('../src/renderer-diagnostics').RENDERER_RUNTIME_PORT
    const provider = host.get(port)
    const before = await win.webContents.executeJavaScript(`(() => {
      window.diagnosisDocument = document;
      window.diagnosisNodes = [...document.querySelectorAll('[data-widget], [data-status-plugin], [data-built-by=composer]')];
      return JSON.stringify(window.odkPlugins.catalog());
    })()`)
    const run = require('node:util').promisify(require('node:child_process').execFile)
    const cli = await run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'diagnose', 'odk.tile.weather'], {
      env: { ...controlEnv, ELECTRON_RUN_AS_NODE: '1' },
    })
    const { id: cliRequestId, preferences, ...cliReport } = JSON.parse(cli.stdout)
    const { id: publicRequestId, ...publicReport } = selected
    assert.match(cliRequestId, /^[a-f0-9-]{36}$/)
    assert.match(publicRequestId, /^[a-f0-9-]{36}$/)
    assert.deepEqual(preferences, {})
    assert.equal(fs.existsSync(resolveConfigPath(controlEnv)), false)
    assert.deepEqual(cliReport, publicReport)
    await host.setEnabled(diagnosisId, false)
    assert.equal(ipcMain.listenerCount('odk-plugin-runtime-report'), 0)
    assert.equal((await provider.snapshot())[0].reason, 'stopped')
    const unavailable = await requestDiagnostics({ endpoint, platform: process.platform })
    assert.equal(unavailable.runtimes.find(runtime => runtime.host === 'electron-renderer').reason, 'provider-unavailable')
    await host.setEnabled(diagnosisId, true)
    assert.notEqual(host.get(port), provider)
    assert.equal(ipcMain.listenerCount('odk-plugin-runtime-report'), 1)
    const resumed = await requestDiagnostics({ endpoint, platform: process.platform })
    assert.deepEqual(resumed.runtimes.find(runtime => runtime.host === 'electron-renderer'), renderer)
    assert.equal(await win.webContents.executeJavaScript(`document === window.diagnosisDocument
      && window.diagnosisNodes.every(node => node.isConnected)
      && document.querySelectorAll('[data-widget], [data-status-plugin], [data-built-by=composer]').length === window.diagnosisNodes.length
      && [...document.querySelectorAll('[data-widget], [data-status-plugin], [data-built-by=composer]')]
        .every((node, index) => node === window.diagnosisNodes[index])`), true)
    assert.equal(await win.webContents.executeJavaScript('JSON.stringify(window.odkPlugins.catalog())'), before)
    diagnosisSelection = { version: host.list().find(plugin => plugin.manifest.id === diagnosisId).manifest.version,
      consumer: { plugins: renderer.plugins, weather: selectedRenderer.plugins } }
  }
  if (replacementMode || linkedMode) {
    const selection = await win.webContents.executeJavaScript(`({
      trace: [...(window.__odkReplacementTrace || [])],
      version: window.odkPlugins.catalog().find(plugin => plugin.manifest.id === 'odk.tile.year').manifest.version,
      count: document.querySelectorAll('[data-widget="odk.tile.year"]').length,
      role: document.querySelector('[data-widget="odk.tile.year"]').dataset.interaction,
    })`)
    assert.deepEqual(selection, { trace: invalidReplacement || rejectedLinkedEntry ? [] : ['create', 'mount'], version: invalidReplacement || rejectedLinkedEntry ? '1.0.0' : '2.0.0', count: 1, role: 'display-only' })
    if (linkedMode && !rejectedLinkedEntry) await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const link = document.querySelector('link[data-plugin="odk.tile.year"]');
      if (!link) return reject(Error('linked stylesheet not mounted'));
      if (link.sheet) return resolve();
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(Error('linked stylesheet failed')), { once: true });
    })`)
    if (nativeMode && !rejectedLinkedEntry) {
      assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-widget="odk.tile.year"]')).getPropertyValue('--odk-native-relative-fixture').trim()`), 'captured')
      const jsonUrl = new URL('assets/value.json', nativeEntries[0].entryUrl).href
      assert.deepEqual(await win.webContents.executeJavaScript(`fetch(${JSON.stringify(jsonUrl)}).then(response => response.json())`), { value: 42 })
      const reading = await win.webContents.executeJavaScript(`({ text: document.querySelector('[data-widget="odk.tile.year"] time').textContent,
        dateTime: document.querySelector('[data-widget="odk.tile.year"] time').dateTime })`)
      assert.match(reading.text, /^\d{2}:\d{2}$/)
      assert.equal(reading.dateTime, reading.text)
    }
    if (runtimeLifecycle) {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const registry = window.odkPlugins;
        const def = registry.get('odk.tile.year');
        const element = document.querySelector('[data-widget="odk.tile.year"]');
        await registry.setEnabled(def.id, false);
        const disabled = registry.catalog().find(plugin => plugin.manifest.id === def.id).state;
        const cleared = element.childElementCount === 0;
        const refused = registry.activate(def, element, { onTick: window.odkServices.onTick }) === false;
        await registry.setEnabled(def.id, true);
        const mounted = Boolean(element.querySelector('time'));
        return { disabled, cleared, refused, mounted, sameElement: document.querySelector('[data-widget="odk.tile.year"]') === element,
          reading: element.querySelector('time').textContent,
          weather: registry.catalog().find(plugin => plugin.manifest.id === 'odk.tile.weather').state };
      })()`)
      assert.equal(result.disabled, 'disabled')
      assert.equal(result.cleared, true)
      assert.equal(result.sameElement, true)
      assert.equal(result.refused, true)
      assert.equal(result.mounted, true)
      assert.match(result.reading, /^\d{2}:\d{2}$/)
      assert.equal(result.weather, 'disabled')
    }
    await win.webContents.executeJavaScript('window.odkPlugins.stop()')
    assert.deepEqual(await win.webContents.executeJavaScript('[...(window.__odkReplacementTrace || [])]'), invalidReplacement || rejectedLinkedEntry ? [] : runtimeLifecycle ? ['create', 'mount', 'unmount', 'stop', 'create', 'mount', 'unmount', 'stop'] : ['create', 'mount', 'unmount', 'stop'])
  }
  if (linkedMode) {
    const style = await win.webContents.executeJavaScript(`({
      applied: getComputedStyle(document.querySelector('[data-widget="odk.tile.year"]')).getPropertyValue('--odk-linked-css-fixture').trim(),
      staged: document.querySelectorAll('link[media="not all"]').length,
    })`)
    assert.deepEqual(style, { applied: rejectedLinkedEntry ? '' : 'loaded', staged: 0 })
  }
  if (process.argv.includes('--composer-reconcile')) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const registry = window.odkPlugins;
      const track = document.getElementById('pages-track');
      const retained = document.querySelector('[data-widget="odk.tile.pomodoro"]');
      const layout = window.DESKTOP_LAYOUT;
      const context = { onTick: window.odkServices.onTick };
      await registry.setEnabled('odk.tile.year', false);
      await window.odkComposer.reconcile(layout, track, context);
      const removed = !document.querySelector('[data-widget="odk.tile.year"]');
      await registry.setEnabled('odk.tile.year', true);
      await window.odkComposer.reconcile(layout, track, context);
      const clock = document.querySelector('[data-widget="odk.tile.year"]');
      return { removed, reading: clock.querySelector('.year-pct').textContent,
        retained: document.querySelector('[data-widget="odk.tile.pomodoro"]') === retained,
        retiredWidgetsAbsent: ['odk.tile.camera', 'odk.tile.chat', 'odk.tile.settings'].every(id => !document.querySelector('[data-widget="' + id + '"]')) };
    })()`)
    assert.equal(result.removed, true)
    assert.equal(result.retained, true)
    assert.equal(result.retiredWidgetsAbsent, true)
    assert.match(result.reading, /^\d+%$/)
  }
  if (statusReconcile) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const registry = window.odkPlugins;
      const selector = '[data-status-plugin="odk.status.clock"]';
      const absent = !document.querySelector(selector);
      const connection = document.querySelector('[data-status-plugin="odk.status.connection"]');
      const context = { onTick: window.odkServices.onTick };
      await registry.setEnabled('odk.status.clock', true);
      await window.odkComposer.reconcileStatus(context);
      const host = document.querySelector(selector);
      const reading = host.querySelector('.sb-time').textContent;
      await registry.setEnabled('odk.status.clock', false);
      await window.odkComposer.reconcileStatus(context);
      const removed = !document.querySelector(selector);
      await registry.setEnabled('odk.status.clock', true);
      await window.odkComposer.reconcileStatus(context);
      await document.fonts.ready;
      const bar = document.getElementById('status-bar').getBoundingClientRect();
      const dots = document.getElementById('dots').getBoundingClientRect();
      const clock = document.querySelector(selector).querySelector('.sb-time').getBoundingClientRect();
      const network = connection.querySelector('#sb-net').getBoundingClientRect();
      return { absent, reading, removed, restored: Boolean(document.querySelector(selector)),
        preserved: connection === document.querySelector('[data-status-plugin="odk.status.connection"]'),
        bounds: { bar: bar.toJSON(), dots: dots.toJSON(), clock: clock.toJSON(), network: network.toJSON() },
        geometry: clock.width > 0 && clock.height > 0 && network.width > 0 && network.height > 0
          && clock.left >= dots.right && network.right <= dots.left
          && clock.top >= bar.top && clock.bottom <= bar.bottom
          && network.top >= bar.top && network.bottom <= bar.bottom };

    })()`)
    assert.equal(result.absent, true)
    assert.match(result.reading, /^\d{2}:\d{2}$/)
    assert.equal(result.removed, true)
    assert.equal(result.restored, true)
    assert.equal(result.preserved, true)
    assert.equal(result.geometry, true, JSON.stringify(result.bounds))
  }
  if (runtimeController) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const controller = window.odkRendererRuntime;
      const track = document.getElementById('pages-track');
      const reading = document.querySelector('#pages-track [data-page-id="reading"]');
      const index = [...track.children].indexOf(reading);
      document.querySelectorAll('#dots .dot')[index].click();
      const activeId = () => track.children[[...document.querySelectorAll('#dots .dot')].findIndex(dot => dot.classList.contains('active'))].dataset.pageId;
      await controller.setEnabled('odk.page.dashboard', true);
      const inserted = Boolean(document.querySelector('#home-summary [data-page-id="today"]'));
      const preserved = document.querySelector('#pages-track [data-page-id="reading"]') === reading;
      const samePage = activeId() === 'reading';
      await window.odkRemote.publishPageState({ fixtureBarrier: 'inserted' });
      await controller.setEnabled('odk.status.clock', true);
      const clock = document.querySelector('[data-status-plugin="odk.status.clock"] .sb-time').textContent;
      await window.odkRemote.publishPageState({ fixtureBarrier: 'status' });
      await controller.setEnabled('odk.page.dashboard', false);
      const retainedSelection = activeId() === 'reading' && !document.querySelector('#home-summary [data-page-id="today"]');
      await window.odkRemote.publishPageState({ fixtureBarrier: 'removed' });
      await controller.setEnabled('odk.tile.weread', false);
      const widgetRemoved = !reading.querySelector('[data-widget="odk.tile.weread"]');
      const emptyGridRetained = activeId() === 'reading' && reading.isConnected;
      await controller.setEnabled('odk.tile.weread', true);
      return { inserted, preserved, samePage, retainedSelection, clock, widgetRemoved, emptyGridRetained,
        restored: Boolean(reading.querySelector('[data-widget="odk.tile.weread"]')) && activeId() === 'reading',
        context: document.getElementById('page-context').textContent,
        pages: track.children.length, dots: document.querySelectorAll('#dots .dot').length,
        retiredWidgetsAbsent: ['odk.tile.camera', 'odk.tile.chat', 'odk.tile.settings'].every(id => !document.querySelector('[data-widget="' + id + '"]')) };
    })()`)
    for (const key of ['inserted', 'preserved', 'samePage', 'retainedSelection', 'widgetRemoved', 'emptyGridRetained', 'restored', 'retiredWidgetsAbsent']) assert.equal(result[key], true, key)
    assert.match(result.clock, /^\d{2}:\d{2}$/)
    assert.equal(result.pages, 3)
    assert.equal(result.dots, 3)
    assert.match(result.context, /^Reading/)
    // Drain publication through the same renderer-to-Main channel.
    await win.webContents.executeJavaScript('window.odkRemote.publishPageState({ fixtureBarrier: true })')
    for (const phase of ['inserted', 'status', 'removed']) {
      const index = remoteStates.findIndex(state => state.fixtureBarrier === phase)
      assert.ok(index > 0)
      const state = remoteStates[index - 1]
      assert.equal(state.name, 'Reading')
      assert.equal(state.focus, 'controls')
      assert.deepEqual(state.actions, [])
      assert.equal(state.page, 4)
      assert.equal(state.pages, 3)
    }
  }
  if (rendererControl) {
    const managed = host.list().find(plugin => plugin.manifest.id === 'odk.system.renderer-control')
    assert.equal(managed.manifest.version, selectedControl ? '2.0.0' : '1.0.0')
    assert.equal(managed.state, 'running', managed.error)
    assert.equal(await win.webContents.executeJavaScript('Boolean(window.odkRendererRuntime)'), true)
    const inventory = await require('../src/local-control-client').requestLocalControl({ endpoint: controlHost.endpoint('renderer-plugin-control'),
      tokenFile: controlHost.localChannelTokenFile, platform: controlHost.platform, label: 'renderer fixture inventory', request: { command: 'inventory' } })
    assert.ok(inventory.plugins.some(plugin => plugin.pluginId === 'odk.status.clock'))
    assert.ok(inventory.plugins.some(plugin => plugin.pluginId === 'odk.theme.pixel'))
    const run = require('node:util').promisify(require('node:child_process').execFile)
    const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')
    const env = { ...controlEnv, ELECTRON_RUN_AS_NODE: '1' }
    const command = async (verb, id) => JSON.parse((await run(process.execPath, [cli, verb, id, '--runtime'], { env })).stdout)
    assert.equal((await command('enable', 'odk.status.clock')).scope, 'electron-renderer')
    assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-status-plugin=\\"odk.status.clock\\"] .sb-time").textContent'), /^\d{2}:\d{2}$/)
    assert.equal((await command('disable', 'odk.tile.year')).state, 'disabled')
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("[data-widget=\\"odk.tile.year\\"]") === null'), true)
    assert.equal((await command('enable', 'odk.tile.year')).state, 'running')
    assert.match(await win.webContents.executeJavaScript('document.querySelector("[data-widget=\\"odk.tile.year\\"] .year-pct").textContent'), /^\d+%$/)
    assert.equal(await win.webContents.executeJavaScript(`['odk.tile.camera', 'odk.tile.chat', 'odk.tile.settings'].every(id => !document.querySelector('[data-widget="' + id + '"]'))`), true)
    await win.webContents.executeJavaScript("window.odkTheme.set('pixel')")
    assert.equal((await command('disable', 'odk.theme.pixel')).state, 'disabled')
    assert.deepEqual(await win.webContents.executeJavaScript(`({ theme: window.odkTheme.get(), saved: localStorage.getItem('odk.theme') })`),
      { theme: 'instrument', saved: 'pixel' })
    assert.equal((await command('enable', 'odk.theme.pixel')).state, 'running')
    assert.equal(await win.webContents.executeJavaScript('window.odkTheme.get()'), 'pixel')
    assert.equal(fs.existsSync(resolveConfigPath(controlEnv)), false)
  }
  if (appearanceFactory) {
    assert.deepEqual(await win.webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })'), { width: 1920, height: 1280 })
    assert.equal(renderer.plugins.find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version, invalidAppearanceFactory ? '1.0.0' : '3.0.0')
    assert.deepEqual(await win.webContents.executeJavaScript('window.__odkAppearanceTrace'), invalidAppearanceFactory ? [] : ['create', 'start'])
    const measure = async () => win.webContents.executeJavaScript(`(async () => {
      const results = [];
      for (const theme of ['instrument', 'pixel', 'border-beam']) {
        window.odkTheme.set(theme);
        for (const font of ['16px "Noto Sans SC"', '700 16px "Montserrat"', '16px "Zpix"']) {
          if (!(await document.fonts.load(font)).length) throw Error('Fixture font did not load: ' + font);
        }
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const style = getComputedStyle(document.documentElement);
        const widget = document.querySelector('[data-widget="odk.tile.year"]');
        const rect = widget.getBoundingClientRect();
        results.push({ theme: window.odkTheme.get(), primary: style.getPropertyValue('--odk-primary').trim(),
          radius: style.getPropertyValue('--odk-radius-card').trim(), font: getComputedStyle(document.body).fontFamily,
          textFont: getComputedStyle(widget.querySelector('.year-pct')).fontFamily,
          bounds: [rect.x, rect.y, rect.width, rect.height] });
      }
      window.odkTheme.set('pixel');
      return results;
    })()`)
    const selectedAppearance = await measure()
    const expectedAppearances = selectAppearancePlugins(appearances)
    for (const measured of selectedAppearance) {
      const declaration = expectedAppearances.find(plugin => plugin.appearance.theme === measured.theme).appearance
      assert.equal(measured.primary, declaration.tokens['--odk-primary'])
      assert.equal(measured.radius, declaration.tokens['--odk-radius-card'])
      assert.match(measured.font, measured.theme === 'pixel' ? /Zpix/ : /Noto Sans SC/)
      assert.ok(measured.bounds[2] > 0 && measured.bounds[3] > 0)
      assert.ok(measured.textFont.length > 0)
    }
    if (!invalidAppearanceFactory) {
      assert.deepEqual(await win.webContents.executeJavaScript(`(async () => {
        await window.odkTheme.setEnabled('odk.theme.pixel', false);
        const disabled = { theme: window.odkTheme.get(), saved: localStorage.getItem('odk.theme') };
        await window.odkTheme.setEnabled('odk.theme.pixel', true);
        return { disabled, enabled: window.odkTheme.get(), trace: window.__odkAppearanceTrace };
      })()`), { disabled: { theme: 'instrument', saved: 'pixel' }, enabled: 'pixel',
        trace: ['create', 'start', 'stop', 'destroy', 'cleanup', 'create', 'start'] })
      await win.webContents.executeJavaScript(`(async () => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        await window.__odkAppearanceReleased;
      })()`)
      assert.deepEqual(await win.webContents.executeJavaScript('window.__odkAppearanceTrace'),
        ['create', 'start', 'stop', 'destroy', 'cleanup', 'create', 'start', 'stop', 'destroy', 'cleanup'])
    }
    await win.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: appearanceScript.identifier })
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), { query })
    await win.webContents.executeJavaScript('Promise.all([window.odkShellReady, window.odkRendererDiagnosis.ready, window.odkTheme.ready])')
    assert.equal(await win.webContents.executeJavaScript("window.odkTheme.catalog().find(item => item.manifest.id === 'odk.theme.pixel').manifest.version"), '1.0.0')
    assert.deepEqual(await measure(), selectedAppearance)
  }
  if (bridgeDiagnosisProof) {
    bridgeDiagnosisSelection.subscriptionReleased = await win.webContents.executeJavaScript(`(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      const deadline = performance.now() + 2000;
      while (!odkRendererDiagnosis.catalog().every(plugin => plugin.state === 'stopped')) {
        if (performance.now() > deadline) throw Error('Renderer bridge shutdown did not settle');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return ${selectedDiagnosisBridge} ? window.bridgeSelectedSubscriptionReleased === true : true;
    })()`)
    assert.equal(bridgeDiagnosisSelection.subscriptionReleased, true)
  }
  await host.stop()
  if (rendererControl) {
    assert.equal(ipcMain.listenerCount('odk-renderer-control-report'), 0)
    assert.equal(fs.existsSync(controlHost.endpoint('renderer-plugin-control')), false)
  }
  if (diagnosisProof) {
    assert.equal(ipcMain.listenerCount('odk-plugin-runtime-report'), 0)
    assert.equal(fs.existsSync(endpoint), false)
    Object.assign(diagnosisSelection, { listenerReleased: true, endpointReleased: true })
  }
  nativeAssets.close()
  console.log(JSON.stringify({ ok: true, ...(diagnosisSelection ? { diagnosisSelection } : {}), ...(bridgeDiagnosisSelection ? { bridgeDiagnosisSelection } : {}), nativeMode, corruptNativeEntry, rendererPlugins: renderer.plugins.length, appearanceFactory, invalidAppearanceFactory, rendererControl, runtimeController, statusReconcile, composerReconcile: process.argv.includes('--composer-reconcile'), runtimeLifecycle, disabledAppearance, linkedAppearance, replacement: replacementMode || linkedMode, linked: linkedMode, rejectedEntry: rejectedLinkedEntry, unavailableStylesheet: unavailableLinkedCss }))
  win.destroy()
  app.quit()
}).catch(async error => {
  console.error(error)
  await host?.stop()
  win?.destroy()
  app.exit(1)
}).finally(() => {
  clearTimeout(deadline)
  fs.rmSync(root, { recursive: true, force: true })
})
