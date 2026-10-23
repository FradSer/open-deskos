'use strict'

const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const { installPiPageCompatibilityFixture } = require('./helpers/pi-page-compatibility.cjs')
if (process.platform === 'linux') app.disableHardwareAcceleration()
if (process.platform === 'darwin') app.dock.hide()
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const externalViews = process.env.ODK_PI_EXTERNAL_VIEWS
assert.ok(externalViews === undefined || ['development', 'native'].includes(externalViews))
const signedViews = externalViews === 'native'
const capturedViews = process.env.ODK_PI_CAPTURED_VIEWS === '1' || externalViews
const releasedViews = process.env.ODK_PI_RELEASED_VIEWS === '1'
const profile = process.env.ODK_PI_FIXTURE_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Pi fixture needs its parent-owned absolute profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { createPiSessionsSource, createConfiguredPiSessionReader } = require('../src/pi-sessions-source')
const { createPiSessionEventsSource } = require('../src/pi-session-events-source')
const { install } = require('./helpers/pi-events-selection')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { installPiViews, viewTimeouts } = require('./helpers/pi-view-selection')
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')
const assets = signedViews ? createNativeRendererAssets() : null
if (signedViews) require('../src/user-app-system').registerUserAppScheme(protocol)
const { CHANNELS: appChannels } = require('./helpers/app-manager')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const ids = ['odk.source.pi-sessions', 'odk.source.pi-events']
const channels = ['odk-pi-sessions', 'odk-pi-session-events']
const sessions = ['running', 'settled', 'exited'].map((status, index) => ({
  sessionId: `fixture-${index}`, uuid: `fixture-${index}`, status,
  cwd: `/fixture/long-English-directory/中文项目-${index}`, workspaceName: `Project ${index}`,
  latestGoal: `Preserve multiline English and 中文 goals\nSecond line ${index}`, activity: 'Fixture tool activity',
  updatedAt: 1791504000000,
}))
const snapshot = values => ({ ok: true, updatedAt: 1791504000000, scannedAt: 1791504000000, sessions: values,
  workspaces: [], summary: { total: values.length, running: values.filter(value => value.status === 'running').length,
    settled: values.filter(value => value.status === 'settled').length,
    exited: values.filter(value => value.status === 'exited').length, workspacesCount: values.length } })
const events = { ok: true, events: [
  { kind: 'user', text: 'Keep English and 中文\nSecond prompt line' },
  { kind: 'thinking', text: 'Private reasoning fixture' },
  { kind: 'tool', text: 'bash: fixture-command', toolCallId: 'fixture-call' },
  { kind: 'result', text: 'First result line\n\n**中文结果**', toolName: 'bash', toolCallId: 'fixture-call', isError: false },
  { kind: 'result', text: 'Independent failed result', toolName: 'fixture', toolCallId: 'different-call', isError: true },
] }
let win
let host
let releaseScan
let releaseEvents
let releaseReply
let finishing
let phase = 'setup'
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { void finish(1, Error(`PI_ELECTRON_TIMEOUT: ${phase}`)) }, viewTimeouts().fixture)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(deadline)
  if (error) console.error(error)
  releaseScan?.(snapshot(sessions))
  releaseEvents?.(events)
  releaseReply?.()
  finishing = (async () => { win?.destroy(); await host?.stop(); assets?.close() })()
    .then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  assert.equal(app.getPath('userData'), profile)
  assert.equal(app.getPath('sessionData'), profile)
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  installGeometryFixtures(ipcMain)
  for (const channel of [...channels, ...appChannels]) ipcMain.removeHandler(channel)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let captured
  if (capturedViews) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/renderer/plugins/pi-sessions.js'), 'utf8')
    const ending = "})(typeof window !== 'undefined' ? window : globalThis)"
    assert.equal(source.endsWith(`${ending}\n`), true, 'Capture the complete Pi module through its root argument')
    captured = source.slice(0, source.lastIndexOf(ending)) + '})(captureRoot)'
    await win.loadURL('about:blank')
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Page.enable')
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      if (${releasedViews}) {
        window.piTickSubscriptions = [];
        let services;
        Object.defineProperty(window, 'odkServices', { configurable: true, get() { return services; }, set(value) {
          const subscribe = value.onTick;
          value.onTick = callback => {
            const id = window.piTickOwner;
            const cancel = subscribe(callback);
            if (!id) return cancel;
            const record = { id, active: true, attempts: 0, failRelease: false };
            piTickSubscriptions.push(record);
            return () => {
              if (!record.active) return;
              record.attempts++;
              if (record.failRelease) throw Error('Controlled Pi Tick cancellation failure');
              cancel(); record.active = false;
            };
          };
          services = value;
        } });
      }
      if (new URL(location.href).searchParams.get('piCapturedViews') !== '1') return;
      const identities = new Set(['odk.app.pi-sessions', 'odk.page.pi-sessions']);
      const replacements = [];
      const captureRoot = Object.create(window);
      Object.defineProperty(captureRoot, 'odkPlugins', { value: { register(definition) {
        if (identities.has(definition.id)) replacements.push({ ...definition,
          manifest: { ...definition.manifest, version: '2.0.0' } });
      } } });
      ${externalViews ? '' : captured}
      ${externalViews ? '' : `
      if (replacements.length !== 2) throw Error('Pi capture must own exactly the App and Page');
      window.odkRendererReplacements = ${process.env.ODK_PI_CAPTURED_VIEWS_DEFAULT === '1'}
        ? replacements.filter(definition => definition.kind !== 'page') : replacements;
      `}
      window.piPackagedMounts = 0;
      let registry;
      Object.defineProperty(window, 'odkPlugins', { configurable: true, get() { return registry; }, set(value) {
        registry = value;
        const register = value.register;
        value.register = function(definition) {
          if (identities.has(definition.id)) {
            const refuse = () => { window.piPackagedMounts++; throw Error('Selected Pi factory called a packaged mount'); };
            definition = { ...definition, mount: refuse, lifecycle: { ...definition.lifecycle, mount: refuse } };
          }
          return register.call(this, definition);
        };
      } });
    })()` })
  }
  const js = source => win.webContents.executeJavaScript(source)
  const reload = () => new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    win.reload()
  })
  const wait = predicate => js(`(async () => {
    const deadline = performance.now() + 4000;
    while (!(${predicate})) {
      if (performance.now() > deadline) throw Error('Pi consumer did not settle: ' + ${JSON.stringify(predicate)});
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await document.fonts.load('16px "Zpix"');
    await document.fonts.load('16px "Montserrat"');
    await document.fonts.load('16px "Noto Sans SC"');
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`)
  const refresh = () => js(`document.querySelector('.page[data-page-id="pi-sessions"]')
    .dispatchEvent(new CustomEvent('odk-page-shown'))`)
  const input = input => js(`document.querySelector('.page[data-page-id="pi-sessions"]')
    .dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: ${JSON.stringify(input)} }, bubbles: true }))`)
  const collect = () => js(`(() => {
    const page = document.querySelector('.page[data-page-id="pi-sessions"]');
    const box = page.getBoundingClientRect();
    if (box.width <= 0 || box.right <= 0 || box.left >= innerWidth) throw Error('Pi page is not visible');
    for (const node of page.querySelectorAll('.pi-overview-cell, .pi-filter-btn')) {
      if (node.closest('[hidden]')) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.left < box.left - 1 || rect.right > box.right + 1) throw Error('Pi control outside page');
    }
    return {
      title: page.querySelector('#pi-title-text').textContent,
      subtitle: page.querySelector('#pi-view-subtitle').textContent,
      overview: !page.querySelector('#pi-overview').hidden,
      detailInert: page.querySelector('#pi-detail').inert,
      rows: [...page.querySelectorAll('.pi-overview-cell')].map(row => ({
        state: row.querySelector('.pi-state-text').textContent,
        path: row.querySelector('.pi-overview-path').textContent,
        goal: row.querySelector('.pi-overview-goal').textContent,
      })),
      filters: [...page.querySelectorAll('.pi-filter-btn')].map(button => ({
        label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed'),
      })),
      events: [...page.querySelectorAll('.pi-event')].map(row => ({
        text: row.textContent.replace(/\\s+/g, ' ').trim(), classes: row.className,
        body: row.querySelector('.pi-event-text').innerHTML,
      })),
      note: page.querySelector('#pi-events-host').textContent.replace(/\\s+/g, ' ').trim(),
      status: page.querySelector('#pi-status').textContent,
      statusRole: page.querySelector('#pi-status').getAttribute('role'),
      statusLive: page.querySelector('#pi-status').getAttribute('aria-live'),
      empty: page.querySelector('.pi-empty-state')?.textContent || '',
    };
  })()`)
  const baseline = new Map()
  let isolatedPageMounts = 0, isolatedAppMounts = 0, releasedViewChecks = 0, delayedViewChecks = 0, failedReleaseChecks = 0
  // Negative entries fail at the first selected consumer; positive cases retain both baselines.
  const missingExternalPage = Boolean(externalViews) && process.env.ODK_PI_EXTERNAL_MISSING_PAGE === '1'
  for (const signed of missingExternalPage ? [true] : [false, true]) {
    phase = `sources:${signed ? 'signed' : 'default'}`
    if (missingExternalPage) console.error(`PI_EXTERNAL_GUARD_PHASE:${signed ? 'signed' : 'default'}`)
    let scanResponse = snapshot(sessions)
    let eventResponse = events
    let eventRead = () => eventResponse
    let scan = async () => scanResponse
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(profile, 'config'),
      XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
    const native = signed ? await install(profile, env, { sessions: true }) : null
    const replacements = native ? await native.load() : []
    assert.deepEqual(replacements.map(plugin => plugin.manifest.id).sort(), signed ? [...ids].sort() : [])
    let entries = []
    if (externalViews && signed) {
      await installPiViews(profile, env, { mode: externalViews, captured, omitPage: process.env.ODK_PI_EXTERNAL_MISSING_PAGE === '1' })
      const configuration = readConfig(resolveConfigPath(env))
      entries = signedViews ? await loadNativeRendererPlugins(configuration, { env, assets })
        : loadDevelopmentPlugins(configuration, { host: 'electron-renderer' })
      assert.deepEqual(entries.map(entry => entry.manifest.id).sort(), ['odk.app.pi-sessions', 'odk.page.pi-sessions'])
      if (signedViews) for (const entry of entries) {
        assert.match(entry.entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/entry\.js$/)
        assert.equal(assets.response({ url: entry.entryUrl }).status, 200)
      }
    }
    if (externalViews) ipcMain.removeHandler('odk-renderer-development-plugins')
    const handlers = new Set()
    let discoveryRegistered = false
    let sessionRequests = 0
    let heldReply
    const sourceOptions = { env: {}, scanLocal: () => scan() }
    host = createPluginHost({ capabilities: {
      ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); ipcMain.handle(name, async (...args) => {
        if (name === 'odk-pi-sessions') sessionRequests++
        const gate = heldReply?.channel === name ? heldReply : null
        if (gate) heldReply = null
        const result = await handler(...args)
        if (gate) {
          gate.entered.resolve()
          await gate.release.promise
          gate.completed.resolve()
        }
        return result
      }); handlers.add(name) },
        removeHandler(name) { ipcMain.removeHandler(name); handlers.delete(name) } },
      'system.app-manager': { create: () => createAppManagerEndpoint() },
      ...(externalViews ? { 'system.renderer-development': {
        ipc: { handle(...args) { ipcMain.handle(...args); discoveryRegistered = true },
          removeHandler(name) { ipcMain.removeHandler(name); discoveryRegistered = false } },
        frames: () => [win.webContents], entries: () => entries,
        ...(signedViews ? { protocol, nativeAssets: assets } : {}),
      } } : {}),
      'source.odk-link': { create: () => ({ machines: async () => [], hostedSessions: async () => ({ ok: false, sessions: [] }),
        sessionEvents: async () => ({ ok: false, reason: 'odk-link-unavailable' }) }) },
      'source.pi-sessions': { configured: () => createConfiguredPiSessionReader(sourceOptions), create: options => {
        assert.equal(signed, false, 'Signed Sessions cannot call the default factory')
        return createPiSessionsSource({ ...options, ...sourceOptions })
      } },
      'source.pi-events': { readLocal: () => eventRead(), create: options => {
        assert.equal(signed, false, 'Signed Events cannot call the default factory')
        return createPiSessionEventsSource({ ...options, readLocal: () => eventRead() })
      } },
    } })
    createMainPlugins({ replacementPlugins: replacements }).filter(plugin => [...ids, 'odk.source.odk-link', 'odk.system.app-manager'].includes(plugin.manifest.id))
      .forEach(plugin => host.register(plugin))
    if (externalViews) host.register(createRendererDevelopmentPlugin())
    await host.start()
    if (externalViews) assert.equal(discoveryRegistered, true)
    for (const [index, id] of ids.entries()) {
      assert.equal(host.list().find(record => record.manifest.id === id).state, 'running')
      assert.equal(host.get(index ? DATA_PORTS.piEvents : DATA_PORTS.piSessions).fixtureRevision, signed ? '2.0.0' : undefined)
    }
    for (const size of [[1920, 1280], [480, 854]]) for (const theme of ['instrument', 'pixel', 'border-beam']) {
      const context = `${signed ? 'signed' : 'default'}:${size.join('x')}:${theme}`
      phase = `${context}:load`
      scanResponse = snapshot(sessions)
      eventResponse = events
      eventRead = () => eventResponse
      scan = async () => scanResponse
      win.setContentSize(...size)
      await installPiPageCompatibilityFixture(win)
      await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), {
        query: capturedViews && signed ? { piCapturedViews: '1' } : {},
      })
      await js('window.odkShellReady')
      phase = `${context}:app-isolation`
      if (capturedViews && signed) {
        assert.equal(await js('window.piPackagedMounts'), 0, 'Captured Pi views must not call packaged mounts')
        assert.equal(await js("odkPlugins.get('odk.app.pi-sessions').manifest.version"), '2.0.0')
        assert.equal(await js("odkPlugins.get('odk.page.pi-sessions').manifest.version"), '2.0.0')
        if (externalViews) assert.deepEqual(await js('window.piExternalExecutions'), {
          'odk.app.pi-sessions': 1, 'odk.page.pi-sessions': 1,
        })
        if (externalViews) assert.deepEqual(await js('window.piExternalVersions'), {
          'odk.app.pi-sessions': '2.0.0', 'odk.page.pi-sessions': '2.0.0',
        })
      }
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      assert.equal(await js('document.documentElement.dataset.theme'), theme)
      async function delayedView(kind, channel) {
        phase = `${context}:${kind}:${channel}:delayed-response`
        const isApp = kind === 'App'
        const selector = isApp ? '#app-runtime' : '.page[data-page-id="pi-sessions"]'
        const open = () => js(isApp ? "odkAppPlatform.openApp({ appId: 'pi-sessions' })"
          : "odkRendererRuntime.setEnabled('odk.page.pi-sessions', true)")
        const close = () => js(isApp ? 'odkAppPlatform.closeApp()'
          : "odkRendererRuntime.setEnabled('odk.page.pi-sessions', false)")
        if (!isApp) await close()
        const gate = { channel, entered: Promise.withResolvers(), release: Promise.withResolvers(), completed: Promise.withResolvers() }
        heldReply = gate
        releaseReply = gate.release.resolve
        scanResponse = channel === 'odk-pi-sessions'
          ? snapshot([{ ...sessions[0], cwd: '/fixture/retired-response' }]) : snapshot(sessions)
        eventResponse = channel === 'odk-pi-session-events'
          ? { ok: true, events: [{ kind: 'user', text: 'Retired event response' }] } : events
        await open()
        await gate.entered.promise
        const nodeSelector = channel === 'odk-pi-sessions' ? '#pi-overview' : '#pi-events-host'
        await js(`window.piRetiredNode = document.querySelector(${JSON.stringify(selector)}).querySelector(${JSON.stringify(nodeSelector)})`)
        await close()
        const retired = await js('piRetiredNode.outerHTML')
        scanResponse = snapshot(sessions)
        eventResponse = events
        await open()
        await wait(`document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-overview-cell').length === 2
          && document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-event').length === 5`)
        const current = () => js(`(() => {
          const root = document.querySelector(${JSON.stringify(selector)});
          return { paths: [...root.querySelectorAll('.pi-overview-path')].map(node => node.textContent),
            events: root.querySelector('#pi-events-host').textContent };
        })()`)
        const before = await current()
        gate.release.resolve()
        await gate.completed.promise
        await js('odkPlatform.listApps()')
        await wait('true')
        assert.equal(await js('piRetiredNode.outerHTML'), retired, `${kind} changed released nodes after ${channel}`)
        assert.deepEqual(await current(), before, `${kind} consumed a former instance response`)
        assert.equal(await js('piRetiredNode.isConnected'), false)
        delayedViewChecks++
        releaseReply = null
        if (isApp) await close()
      }
      async function failedRelease(kind) {
        phase = `${context}:${kind}:failed-tick-release`
        const isApp = kind === 'App'
        const id = `odk.${isApp ? 'app' : 'page'}.pi-sessions`
        const selector = isApp ? '#app-runtime' : '.page[data-page-id="pi-sessions"]'
        const open = () => js(isApp ? "odkAppPlatform.openApp({ appId: 'pi-sessions' })"
          : "odkRendererRuntime.setEnabled('odk.page.pi-sessions', true)")
        const close = () => js(isApp ? 'odkAppPlatform.closeApp()'
          : "odkRendererRuntime.setEnabled('odk.page.pi-sessions', false)")
        if (!isApp) await close()
        await open()
        await wait(`document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-overview-cell').length === 2
          && document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-event').length === 5`)
        await js(`window.piFailedTick = piViewTicks.findLast(value => value.id === ${JSON.stringify(id)});
          if (!piFailedTick?.subscription?.active) throw Error('Pi Tick acquisition observation missing');
          piFailedTick.subscription.failRelease = true;
          window.piFailedNode = document.querySelector(${JSON.stringify(selector)}).querySelector('#pi-overview');`)
        if (isApp) assert.equal(await close(), false)
        else {
          await assert.rejects(close(), /renderer runtime reconciliation failed/)
          assert.equal(await js(`odkPlugins.catalog().find(plugin => plugin.manifest.id === ${JSON.stringify(id)}).state`), 'cleanup-failed')
        }
        assert.equal(await js('piFailedTick.subscription.active'), true)
        const attempts = await js('piFailedTick.subscription.attempts')
        assert.ok(attempts > 0)
        const released = await js('piFailedNode.outerHTML')
        await js('odkPlatform.listApps()')
        const before = sessionRequests
        await js('(async () => { for (let index = 0; index < 5; index++) piFailedTick.callback(); await odkPlatform.listApps() })()')
        assert.equal(sessionRequests, before, `${kind} retained read permission after failed cancellation`)
        assert.equal(await js('piFailedNode.outerHTML'), released)
        await js('piFailedTick.subscription.failRelease = false')
        await close()
        assert.deepEqual(await js('({active: piFailedTick.subscription.active, attempts: piFailedTick.subscription.attempts})'), { active: false, attempts: attempts + 1 })
        await open()
        await wait(`document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-overview-cell').length === 2
          && document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-event').length === 5`)
        await js('odkPlatform.listApps()')
        const fresh = sessionRequests
        await js('(async () => { for (let index = 0; index < 5; index++) piFailedTick.callback(); await odkPlatform.listApps() })()')
        assert.equal(sessionRequests, fresh)
        assert.equal(await js('piFailedNode.outerHTML'), released)
        scanResponse = snapshot([{ ...sessions[0], cwd: '/fixture/refreshed-response' }, sessions[1]])
        await js(`(async () => {
          const current = piViewTicks.findLast(value => value.id === ${JSON.stringify(id)});
          if (current === piFailedTick || !current.subscription.active) throw Error('Fresh Pi Tick acquisition missing');
          for (let index = 0; index < 5; index++) current.callback();
          await odkPlatform.listApps();
        })()`)
        assert.equal(sessionRequests, fresh + 1, `${kind} fresh callback did not reach preload`)
        await wait(`[...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-overview-path')]
          .some(node => node.textContent.includes('refreshed-response'))`)
        assert.equal(await js('piFailedNode.outerHTML'), released)
        scanResponse = snapshot(sessions)
        await js(`(async () => {
          const current = piViewTicks.findLast(value => value.id === ${JSON.stringify(id)});
          for (let index = 0; index < 5; index++) current.callback();
          await odkPlatform.listApps();
        })()`)
        await wait(`document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-overview-cell').length === 2
          && ![...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.pi-overview-path')]
            .some(node => node.textContent.includes('refreshed-response'))`)
        failedReleaseChecks++
        if (isApp) await close()
      }
      if (releasedViews) {
        await js(`(async () => {
          window.piViewTicks = [];
          await odkRendererRuntime.setEnabled('odk.tile.pi-sessions', false);
          await odkRendererRuntime.setEnabled('odk.status.pi-sessions', false);
          for (const id of ['odk.app.pi-sessions', 'odk.page.pi-sessions']) {
            const definition = odkPlugins.get(id);
            const mount = definition.lifecycle.mount;
            const observe = (el, ctx) => mount(el, { ...ctx, onTick(callback) {
              // Keep the real subscription and cleanup, but drive view ticks explicitly.
              window.piTickOwner = id;
              try {
                const cancel = ctx.onTick(() => {});
                const subscription = piTickSubscriptions.at(-1);
                if (subscription?.id !== id || !subscription.active) throw Error('Pi Tick subscription observation missing');
                piViewTicks.push({ id, callback, subscription });
                return cancel;
              } finally { delete window.piTickOwner; }
            } });
            await odkRendererRuntime.replace({ ...definition, mount: observe,
              lifecycle: { ...definition.lifecycle, mount: observe } });
          }
        })()`)
      }
      await js(`(async () => {
        window.originalPiPage = odkPlugins.get('odk.page.pi-sessions');
        window.replacementPageMounts = 0;
        await odkRendererRuntime.setEnabled('odk.page.pi-sessions', false);
        const refusePageMount = () => { replacementPageMounts++; throw Error('Pi page mount must not own the Pi App'); };
        await odkRendererRuntime.replace({ ...originalPiPage, mount: refusePageMount, manifest: { ...originalPiPage.manifest, version: '2.0.0' },
          lifecycle: { ...originalPiPage.lifecycle, mount: refusePageMount } });
      })()`)
      if (releasedViews) {
        await js('odkPlatform.listApps()')
        const before = sessionRequests
        await js(`(async () => {
          const retained = piViewTicks.findLast(value => value.id === 'odk.page.pi-sessions');
          if (!retained) throw Error('Pi Page Tick was not observed');
          for (let index = 0; index < 5; index++) retained.callback();
          await odkPlatform.listApps();
        })()`)
        assert.equal(sessionRequests, before, 'Released Pi Page Tick must not start another scan')
        releasedViewChecks++
      }
      if (process.env.ODK_PI_APP_DELEGATES_PAGE === '1') {
        await js(`(async () => {
          const app = odkPlugins.get('odk.app.pi-sessions');
          await odkRendererRuntime.replace({ ...app, lifecycle: { ...app.lifecycle,
            mount(el, ctx) { return odkPlugins.get('odk.page.pi-sessions').lifecycle.mount(el, ctx); } } });
        })()`)
      }
      assert.equal(await js("odkPlugins.get('odk.page.pi-sessions').manifest.version"), '2.0.0')
      assert.equal(await js("odkAppPlatform.openApp({ appId: 'pi-sessions' })"), true, 'Pi App must open independently of the selected page')
      await wait(`document.querySelectorAll('#app-runtime .pi-overview-cell').length === 2 && document.querySelectorAll('#app-runtime .pi-event').length === 5`)
      assert.deepEqual(await js(`[...document.querySelectorAll('#app-runtime .pi-state-text')].map(node => node.textContent)`), ['Working...', 'Idle'])
      await js(`document.querySelector('#app-runtime .pi-filter-btn[data-filter="exited"]').click()`)
      await wait(`document.querySelectorAll('#app-runtime .pi-overview-cell').length === 1 && document.querySelector('#app-runtime .pi-state-text').textContent === 'Exited'`)
      await js(`(() => { const cell = document.querySelector('#app-runtime .pi-overview-cell'); cell.focus();
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
      await wait(`document.querySelector('#app-runtime #pi-overview').hidden && !document.querySelector('#app-runtime #pi-detail').inert`)
      assert.match(await js(`document.querySelector('#app-runtime #pi-view-subtitle').textContent`), /中文项目-2/)
      await js('odkAppPlatform.closeApp()')
      if (releasedViews) {
        await js('odkPlatform.listApps()')
        const before = sessionRequests
        await js(`(async () => {
          const retained = piViewTicks.findLast(value => value.id === 'odk.app.pi-sessions');
          if (!retained) throw Error('Pi App Tick was not observed');
          for (let index = 0; index < 5; index++) retained.callback();
          await odkPlatform.listApps();
        })()`)
        assert.equal(sessionRequests, before, 'Released Pi App Tick must not start another scan')
        releasedViewChecks++
      }
      assert.equal(await js('odkAppPlatform.active()'), null)
      assert.equal(await js('replacementPageMounts'), 0, 'Pi App delegated to the replacement page')
      isolatedAppMounts++
      if (releasedViews) for (const channel of channels) await delayedView('App', channel)
      if (releasedViews) await failedRelease('App')
      phase = `${context}:page-isolation`
      await js(`(async () => {
        await odkRendererRuntime.replace(originalPiPage);
        await odkRendererRuntime.setEnabled('odk.page.pi-sessions', true);
      })()`)
      if (releasedViews) for (const channel of channels) await delayedView('Page', channel)
      if (releasedViews) await failedRelease('Page')
      await js(`(async () => {
        const app = odkPlugins.get('odk.app.pi-sessions');
        window.replacementAppMounts = 0;
        await odkRendererRuntime.replace({ ...app, manifest: { ...app.manifest, version: '2.0.0' },
          lifecycle: { ...app.lifecycle, mount() { replacementAppMounts++; throw Error('Pi App mount must not own the Pi page'); } } });
        await odkRendererRuntime.setEnabled('odk.page.pi-sessions', false);
        await odkRendererRuntime.setEnabled('odk.page.pi-sessions', true);
      })()`)
      assert.equal(await js('replacementAppMounts'), 0, 'Pi page delegated to the replacement App')
      isolatedPageMounts++
      await js(`const index = window.DESKTOP_LAYOUT.pages.filter(page => !page.persistent).findIndex(page => page.id === 'pi-sessions');
        document.querySelectorAll('#dots .dot')[index].click()`)
      await wait(`document.querySelectorAll('.pi-overview-cell').length === 2 && document.querySelectorAll('.pi-event').length === 5`)
      const results = [await collect()]
      phase = `${context}:page-states`
      assert.equal(results[0].statusRole, 'status')
      assert.equal(results[0].statusLive, 'polite')
      assert.deepEqual(results[0].rows.map(row => row.state), ['Working...', 'Idle'])
      assert.equal(results[0].note.includes('Private reasoning fixture'), false)
      assert.match(results[0].note, /Thinking/)
      assert.ok(results[0].events.some(row => row.classes.includes('pi-continues') && row.classes.includes('pi-tool-success')))
      assert.ok(results[0].events.some(row => row.classes.includes('pi-tool-error')))
      const multiline = results[0].events.find(row => row.classes.includes('pi-continues'))
      assert.match(multiline.body, /<p>First result line<\/p>\s*<p><strong>中文结果<\/strong><\/p>/)
      await js(`document.querySelector('.pi-filter-btn[data-filter="exited"]').click()`)
      await wait(`document.querySelectorAll('.pi-overview-cell').length === 1 && document.querySelector('.pi-overview-cell .pi-state-text').textContent === 'Exited'`)
      results.push(await collect())
      await js(`document.querySelector('.pi-filter-btn[data-filter="live"]').click();
        const cell = document.querySelector('.pi-overview-cell'); cell.focus();
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
      await wait(`document.querySelector('#pi-overview').hidden && document.querySelectorAll('.pi-event').length === 5`)
      results.push(await collect())
      assert.equal(results[2].detailInert, false)
      assert.match(results[2].subtitle, /中文项目-0/)
      await input('back')
      assert.equal((await collect()).overview, true)
      eventResponse = { ok: true, events: [] }
      await refresh()
      await wait(`document.querySelector('#pi-events-host').textContent.includes('No session events recorded yet')`)
      results.push(await collect())
      eventResponse = { ok: false, reason: 'session-log-unreadable' }
      await refresh()
      await wait(`document.querySelector('#pi-events-host').textContent.includes('could not be read')`)
      results.push(await collect())
      eventResponse = { ok: true, events: [{ kind: 'result', text: null }] }
      await refresh()
      await wait(`document.querySelector('#pi-events-host').textContent.includes('No session log is available')`)
      results.push(await collect())
      scanResponse = snapshot([])
      await refresh()
      await wait(`document.querySelectorAll('.pi-overview-cell').length === 0 && document.querySelector('.pi-empty-state')?.textContent.includes('No session matches')`)
      results.push(await collect())
      scanResponse = { ok: false, sessions: [], error: 'Fixture unavailable' }
      await refresh()
      await wait(`document.querySelector('#pi-view-subtitle').textContent.includes('unavailable')`)
      results.push(await collect())
      scanResponse = snapshot(sessions)
      await refresh()
      await wait(`document.querySelectorAll('.pi-overview-cell').length === 2 && document.querySelector('#pi-view-subtitle').textContent === ''`)
      scanResponse = snapshot([{ status: 'invalid-fixture', sessionId: 'malformed' }])
      await refresh()
      await wait(`document.querySelector('#pi-view-subtitle').textContent.includes('unavailable') && document.querySelectorAll('.pi-overview-cell').length === 0`)
      results.push(await collect())
      scanResponse = snapshot(sessions)
      eventResponse = events
      await refresh()
      await wait(`document.querySelectorAll('.pi-overview-cell').length === 2 && document.querySelectorAll('.pi-event').length === 5`)
      results.push(await collect())
      const pendingEvents = new Promise(resolve => { releaseEvents = resolve })
      eventRead = () => pendingEvents
      await reload()
      await js('window.odkShellReady')
      await wait(`document.querySelector('#pi-events-host')?.textContent.includes('Reading session events') && document.querySelectorAll('.pi-overview-cell').length === 2`)
      await js(`const index = window.DESKTOP_LAYOUT.pages.filter(page => !page.persistent).findIndex(page => page.id === 'pi-sessions');
        document.querySelectorAll('#dots .dot')[index].click()`)
      results.push(await collect())
      releaseEvents(events)
      releaseEvents = null
      eventRead = () => eventResponse
      await wait(`document.querySelectorAll('.pi-event').length === 5`)
      let entered
      const entering = new Promise(resolve => { entered = resolve })
      scan = () => { entered(); return new Promise(resolve => { releaseScan = resolve }) }
      // Reload exercises the actual initial loading state, rather than inventing a refresh indicator.
      await reload()
      await entering
      await js('window.odkShellReady')
      await wait(`document.querySelector('#pi-view-subtitle').textContent.includes('Loading Pi sessions')`)
      assert.equal(await js(`document.querySelector('.pi-filter-btn').getAttribute('aria-label').includes('count unavailable')`), true)
      await js(`const index = window.DESKTOP_LAYOUT.pages.filter(page => !page.persistent).findIndex(page => page.id === 'pi-sessions');
        document.querySelectorAll('#dots .dot')[index].click()`)
      results.push(await collect())
      releaseScan(snapshot(sessions))
      releaseScan = null
      scan = async () => scanResponse
      await wait(`document.querySelectorAll('.pi-overview-cell').length === 2`)
      const key = `${size.join('x')}/${theme}`
      if (!signed) baseline.set(key, results)
      else assert.deepEqual(results, baseline.get(key), `Pi rendered parity ${key}`)
      if (capturedViews && signed) assert.equal(await js('window.piPackagedMounts'), 0)
    }
    await host.stop()
    if (externalViews) assert.equal(discoveryRegistered, false)
    if (signedViews) assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), false)
    assert.equal(handlers.size, 0)
    assert.equal(host.list().some(record => ['cleanup-failed', 'cleanup-blocked'].includes(record.state)), false)
    host = null
  }
  console.log(JSON.stringify({ ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 2, isolatedPageMounts, isolatedAppMounts, actualAppManager: true,
    ...(capturedViews ? { capturedAppPage: true } : {}), ...(externalViews ? { externalAppPage: externalViews } : {}),
    ...(releasedViews ? { releasedViewChecks, delayedViewChecks, failedReleaseChecks } : {}) }))
  await finish(0)
}).catch(error => { void finish(1, error) })
