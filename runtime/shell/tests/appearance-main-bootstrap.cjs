'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const run = require('node:util').promisify(require('node:child_process').execFile)
const { resolveConfigPath } = require('../src/plugin-config')
const { resolveShellHost } = require('../src/platform')
const { capturePaintedPage } = require('./helpers/native-page-capture')

// Inject before parsing: sheet association alone does not prove @import completion.
function installAppearanceStylesheetReadiness() {
  const terminal = new WeakMap()
  const waiters = new Set()
  const stylesheet = node => node?.tagName === 'LINK' && node.rel === 'stylesheet'
  const record = event => {
    if (!stylesheet(event.target)) return
    terminal.set(event.target, event.type)
    for (const notify of [...waiters]) notify()
  }
  document.addEventListener('load', record, true)
  document.addEventListener('error', record, true)
  window.addEventListener('pagehide', () => {
    document.removeEventListener('load', record, true)
    document.removeEventListener('error', record, true)
  }, { once: true })
  window.__appearanceSelectThemeReady = async (theme, timeoutMs = 4000) => {
    if (!['pixel', 'instrument', 'border-beam', 'liquid-glass'].includes(theme)) throw Error('Unknown measured Appearance')
    if (theme === 'instrument') { window.odkTheme.set(theme); return }
    const href = new URL(`themes/${theme}.css`, document.baseURI).href
    let link, timer, check
    const loaded = new Promise((resolve, reject) => {
      check = () => {
        if (!link) return
        const state = terminal.get(link)
        if (state === 'error') reject(Error(`Appearance stylesheet failed: ${href}`))
        if (state === 'load') {
          if (!link.sheet || link.disabled) reject(Error(`Appearance stylesheet unavailable after load: ${href}`))
          else resolve()
        }
      }
      waiters.add(check) // Arm before set() may synchronously append or finish a cached link.
      timer = setTimeout(() => reject(Error(`Appearance stylesheet timed out: ${href}`)), timeoutMs)
    })
    try {
      window.odkTheme.set(theme)
      const matches = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(node => node.href === href)
      if (matches.length !== 1) throw Error(`Expected one Appearance stylesheet: ${href}`)
      link = matches[0]
      if (link.dataset.plugin && link.dataset.plugin !== `odk.theme.${theme}`) throw Error('Appearance stylesheet plugin differs')
      check()
      await loaded
    } finally {
      clearTimeout(timer)
      waiters.delete(check)
    }
  }
}

const profile = process.env.ODK_APPEARANCE_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Appearance acceptance requires a private parent-owned profile')
assert.notEqual(process.platform, 'win32', 'Windows management requires private named-pipe isolation')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const emptyStartup = process.env.ODK_APPEARANCE_EMPTY === '1'
const holdStylesheet = process.env.ODK_APPEARANCE_HOLD_STYLESHEET === '1'
const heldRequests = new Set()
let holdingStylesheet = holdStylesheet
const rejectPackage = process.env.ODK_APPEARANCE_REJECT_PACKAGE === '1'
const verifierModule = require('../src/user-app-verifier')
const createVerifier = verifierModule.createUserAppVerifier
let lastVerification
verifierModule.createUserAppVerifier = options => {
  const verifier = createVerifier(options)
  const verify = verifier.verify.bind(verifier)
  verifier.verify = async (...args) => {
    const result = await verify(...args)
    // Keep the real verdict while excluding bundle contents and subprocess details.
    lastVerification = { ok: result.ok, ...(typeof result.error === 'string' ? { error: result.error } : {}) }
    return result
  }
  return verifier
}
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
process.env.ODK_DISABLED_PLUGINS += ',' + layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
  .filter(id => id !== 'odk.tile.year').join(',')

// Capture the production Host without replacing its capabilities or handlers.
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const current = createHost(options)
  if (options?.capabilities?.['system.renderer-control']) host = current
  return current
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
const command = args => run(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), ...args], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
})
let report
let failed = false
const appearanceFixtureTimeout = process.platform === 'linux' && process.arch === 'arm64' ? 90000 : 45000
const deadline = setTimeout(() => { void fail(Error('APPEARANCE_MAIN_TIMEOUT')) }, appearanceFixtureTimeout)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  assert.equal(win.webContents.isOffscreen(), true)
  assert.equal(win.webContents.isPainting(), true)
  const loadFile = win.loadFile.bind(win)
  win.loadFile = async (...args) => {
    try {
      await win.loadURL('about:blank')
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Page.enable')
      if (holdStylesheet) {
        win.webContents.debugger.on('message', (_event, method, params) => {
          if (method === 'Fetch.requestPaused') heldRequests.add(params.requestId)
        })
        await win.webContents.debugger.sendCommand('Fetch.enable', {
          patterns: [{ urlPattern: '*themes/liquid-glass.css', resourceType: 'Stylesheet', requestStage: 'Response' }],
        })
      }
      await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
        (${installAppearanceStylesheetReadiness.toString()})();
        const NativeDate = Date;
        const fixtureTime = NativeDate.parse('2026-10-09T12:34:00+08:00');
        window.Date = class extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [fixtureTime])); }
          static now() { return fixtureTime; }
        };
        try { localStorage.setItem('odk.theme', 'pixel'); } catch {}
      ` })
      return await loadFile(...args)
    } catch (error) { await fail(error) }
  }
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL() === 'about:blank') return
    void (async () => {
      const js = source => win.webContents.executeJavaScript(source)
      await js('Promise.all([window.odkShellReady, window.odkTheme.ready, window.odkRendererDiagnosis.ready])')
      assert.ok(host)
      assert.equal(win.isVisible(), false)
      const running = host.list().filter(record => record.state !== 'disabled')
      assert.ok(running.every(record => record.state === 'running'), JSON.stringify(running))
      for (const channel of ['renderer-plugin-control', 'user-app-control']) {
        assert.equal(fs.statSync(resolveShellHost().endpoint(channel)).isSocket(), true)
      }
      assert.equal(protocol.isProtocolHandled('odk-native-plugin'), true)
      assert.equal(protocol.isProtocolHandled('odk-user-app'), true)
      assert.equal(await js("odkTheme.catalog().find(record => record.manifest.id === 'odk.theme.pixel').manifest.version"), emptyStartup ? '1.0.0' : '2.0.0')
      const installed = await js("odkUserApps.dispatch({command:'install',appId:'counter'})")
      if (rejectPackage) {
        assert.deepEqual(installed, { ok: false, error: 'verification-failed' })
        assert.deepEqual(lastVerification, { ok: false, error: 'Controlled Appearance verification rejection' })
        assert.deepEqual(await js("odkUserApps.dispatch({command:'list'})"), { ok: true, apps: [] })
        assert.equal(await js("Boolean(document.querySelector('[data-user-app-id=\"counter\"]'))"), false)
        assert.equal(await js("odkTheme.catalog().find(record => record.manifest.id === 'odk.theme.pixel').manifest.version"), '2.0.0')
        report = { productionMain: true, actualPreload: true, actualInstallation: false, actualVerification: true,
          emptyStartup, rejected: true, verifierError: lastVerification.error, pid: process.pid }
        await js('window.odkRendererRuntime.stop()')
        app.quit()
        return
      }
      assert.equal(installed.ok, true, JSON.stringify({ installed, verifier: lastVerification }))
      assert.deepEqual(lastVerification, { ok: true })
      await js(`(async () => {
        const until = performance.now() + 8000;
        let selected = false;
        while (!selected || document.querySelector('[data-user-app-id="counter"]')?.dataset.state !== 'ready') {
          if (performance.now() > until) throw Error('Installed App did not mount: ' + JSON.stringify({
            selected, state: document.querySelector('[data-user-app-id="counter"]')?.dataset.state,
            markers: [...document.querySelectorAll('#dots .dot')].map(node => node.getAttribute('aria-label')),
            frame: Boolean(document.querySelector('[data-user-app-id="counter"] iframe')),
          }));
          if (!selected) {
            const marker = document.querySelector('#dots .dot[aria-label^="Counter, page "]');
            if (marker) { marker.click(); selected = true; }
          }
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        window.__retainedDocument = document;
        window.__retainedClock = document.querySelector('.sb-time');
        window.__retainedFrame = document.querySelector('[data-user-app-id="counter"] iframe');
      })()`)
      const appFrame = win.webContents.mainFrame.frames.find(frame => frame.url.startsWith('odk-user-app://app/counter/'))
      assert.ok(appFrame)
      await appFrame.executeJavaScript('counter.click()')
      let capturedBaseline = false
      const evidence = []
      const evidenceDir = process.env.ODK_APPEARANCE_EVIDENCE_DIR
      if (evidenceDir) assert.ok(path.isAbsolute(evidenceDir), 'Appearance evidence requires an absolute directory')
      const settleCapturePage = pageId => js(`(async () => {
        const page = [...document.querySelectorAll('#pages-track > .page')]
          .find(node => node.dataset.pageId === ${JSON.stringify(pageId)});
        if (!page) throw Error('Capture page is absent');
        const track = document.querySelector('#pages-track');
        const viewport = document.querySelector('#pages-viewport');
        const deadline = performance.now() + 4000;
        let stable = 0;
        while (stable < 2) {
          const box = page.getBoundingClientRect();
          const bounds = viewport.getBoundingClientRect();
          const moving = track.getAnimations().some(animation =>
            animation.playState === 'running' || animation.pending);
          stable = !moving && Math.abs(box.left - bounds.left) < 0.5
            && Math.abs(box.width - bounds.width) < 0.5 ? stable + 1 : 0;
          if (performance.now() > deadline) throw Error('Capture pager did not settle');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const box = page.getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        const reading = page.querySelector('.year-pct');
        const readingBox = reading?.getBoundingClientRect();
        return { pageId: page.dataset.pageId, leftOffset: box.left - bounds.left,
          pageWidth: box.width, viewportWidth: bounds.width, stableFrames: stable,
          ...(readingBox ? { fixtureReading: { text: reading.textContent, left: readingBox.left,
            right: readingBox.right, width: readingBox.width,
            clipped: readingBox.left < bounds.left || readingBox.right > bounds.right } } : {}) };

      })()`)
      const measure = async () => {
        const results = {}
        for (const theme of ['pixel', 'instrument', 'border-beam', 'liquid-glass']) {
          const shell = await js(`(async () => {
            document.querySelector('#dots .dot[aria-label^="Home, page "]').click();
            await window.__appearanceSelectThemeReady(${JSON.stringify(theme)});
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const clock = document.querySelector('.sb-time');
            const box = clock.getBoundingClientRect(); const style = getComputedStyle(clock);
            return { text: clock.textContent, font: style.fontFamily, size: style.fontSize, width: box.width, height: box.height,
              primary: getComputedStyle(document.documentElement).getPropertyValue('--odk-primary').trim(),
              radius: getComputedStyle(document.documentElement).getPropertyValue('--odk-radius-card').trim() };
          })()`)
          assert.ok(shell.width > 0 && shell.height > 0, JSON.stringify(shell))
          let shellCapture
          if (evidenceDir && !capturedBaseline) {
            shellCapture = await settleCapturePage('home')
            fs.mkdirSync(evidenceDir, { recursive: true })
            if (!(holdingStylesheet && theme === 'liquid-glass')) {
              fs.writeFileSync(path.join(evidenceDir, `${theme}-shell.png`), (await capturePaintedPage(win)).toPNG())
            }
          }
          await js(`document.querySelector('#dots .dot[aria-label^="Counter, page "]').click()`)
          const installedApp = await appFrame.executeJavaScript(`(async () => {
            const until = performance.now() + 4000;
            while (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) {
              if (performance.now() > until) throw Error('App theme did not update');
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
            await document.fonts.load('16px "Zpix"'); await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            let confined = false; try { parent.document.body; } catch { confined = true; }
            const style = getComputedStyle(document.body);
            return { theme: document.documentElement.dataset.theme, count: counter.textContent, font: style.fontFamily,
              primary: style.getPropertyValue('--odk-primary').trim(), radius: style.getPropertyValue('--odk-radius-card').trim(),
              loaded: document.fonts.check('16px "Zpix"'), confined, preload: typeof window.odkUserApps };
          })()`)
          assert.equal(installedApp.count, '1')
          assert.equal(installedApp.confined, true)
          assert.equal(installedApp.preload, 'undefined')
          assert.equal(installedApp.loaded, true)
          if (holdingStylesheet && theme === 'liquid-glass') {
            assert.equal(heldRequests.size, 1, 'the theme response must still be held at the color comparison')
            assert.equal(await js(`Boolean(document.querySelector('link[href="themes/liquid-glass.css"]').sheet)`), false)
          }
          if (evidenceDir && !capturedBaseline) {
            const appCapture = await settleCapturePage('installed:counter')
            const image = await capturePaintedPage(win)
            fs.writeFileSync(path.join(evidenceDir, `${theme}-app.png`), image.toPNG())
            evidence.push({ synthetic: true, emptyStartup, theme, viewport: win.getContentSize(),
              captures: { shell: { ...shellCapture, phase: holdingStylesheet && theme === 'liquid-glass' ? 'held-css-comparison-only' : 'resolved-theme' },
                app: { ...appCapture, phase: holdingStylesheet && theme === 'liquid-glass' ? 'held-css-comparison' : 'resolved-theme' } },
              sources: { clockAndYear: 'Fixture Date fixed to 2026-10-09T12:34:00+08:00',
                counter: 'Temporary locally installed synthetic package; one programmatic click',
                serviceReadings: 'Provider, account, remote, camera and resident Bot plugins disabled; private configuration and state',
                networkIndicator: 'Browser navigator.onLine capability; no account or remote service reading' },
              heldThemeResponses: heldRequests.size, imagePixels: image.getSize(),
              rendering: await js('({ deviceScaleFactor: devicePixelRatio, zoom: visualViewport.scale, fonts: document.fonts.status })'), shell, installedApp })
            fs.writeFileSync(path.join(evidenceDir, 'measurements.json'), JSON.stringify(evidence, null, 2))
          }
          assert.equal(installedApp.primary, shell.primary)
          assert.equal(installedApp.radius, shell.radius)
          results[theme] = { shell, installedApp }
        }
        await js("odkTheme.set('pixel')")
        return results
      }
      const baseline = await measure()
      capturedBaseline = true
      if (holdStylesheet) {
        const stylesheetLoaded = js(`(async () => {
          const link = document.querySelector('link[href="themes/liquid-glass.css"]');
          if (link.sheet) return;
          await new Promise((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timer);
              link.removeEventListener('load', loaded);
              link.removeEventListener('error', failed);
            };
            const loaded = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(Error('Released theme stylesheet failed to load')); };
            const timer = setTimeout(() => { cleanup(); reject(Error('Released theme stylesheet did not load')); }, 4000);
            link.addEventListener('load', loaded, { once: true });
            link.addEventListener('error', failed, { once: true });
          });
        })()`)
        for (const requestId of heldRequests) await win.webContents.debugger.sendCommand('Fetch.continueResponse', { requestId })
        await stylesheetLoaded
        assert.equal(await js(`Boolean(document.querySelector('link[href="themes/liquid-glass.css"]').sheet)`), true)
        await win.webContents.debugger.sendCommand('Fetch.disable')
        heldRequests.clear()
        holdingStylesheet = false
        if (evidenceDir) {
          await js(`(async () => {
            document.querySelector('#dots .dot[aria-label^="Home, page "]').click();
            await odkTheme.set('liquid-glass');
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          })()`)
          const completedShell = await settleCapturePage('home')
          fs.writeFileSync(path.join(evidenceDir, 'liquid-glass-shell.png'), (await capturePaintedPage(win)).toPNG())
          const row = evidence.find(entry => entry.theme === 'liquid-glass')
          row.captures.heldCssShell = row.captures.shell
          row.captures.shell = { ...completedShell, phase: 'after-stylesheet-load', heldThemeResponses: 0,
            stylesheetLoaded: true, primary: await js(`getComputedStyle(document.documentElement).getPropertyValue('--odk-primary').trim()`) }
          fs.writeFileSync(path.join(evidenceDir, 'measurements.json'), JSON.stringify(evidence, null, 2))
          await js("odkTheme.set('pixel')")
        }
      }
      const retained = async () => {
        assert.equal(await js(`document === __retainedDocument &&
          document.querySelector('.sb-time') === __retainedClock &&
          document.querySelector('[data-user-app-id="counter"] iframe') === __retainedFrame &&
          __retainedFrame.getAttribute('sandbox') === 'allow-scripts' && localStorage.getItem('odk.theme') === 'pixel'`), true)
        assert.equal(win.webContents.mainFrame.frames.find(frame => frame.url.startsWith('odk-user-app://app/counter/')), appFrame)
        assert.deepEqual(await measure(), baseline)
      }
      if (emptyStartup) await command(['native', 'install', process.env.ODK_APPEARANCE_FIRST, '--trust', '--keyring', process.env.ODK_NATIVE_KEYRING])
      const configPath = resolveConfigPath(process.env)
      let previous = emptyStartup ? null : '2.0.0'
      const expectedTrace = emptyStartup ? [] : ['create:2.0.0', 'start:2.0.0']
      for (const version of ['2.0.0', '3.0.0']) {
        if (version === '3.0.0') await command(['native', 'update', 'odk.theme.pixel', process.env.ODK_APPEARANCE_NEXT,
          '--trust', '--keyring', process.env.ODK_NATIVE_KEYRING])
        const config = fs.readFileSync(configPath)
        const receipt = JSON.parse((await command(['activate', 'odk.theme.pixel', '--runtime'])).stdout)
        assert.equal(receipt.ok, true)
        assert.equal(receipt.scope, 'electron-renderer')
        assert.equal(receipt.version, version)
        assert.equal(receipt.state, 'running')
        assert.equal(receipt.revision, JSON.parse(config).plugins['odk.theme.pixel'].native.revision)
        assert.deepEqual(fs.readFileSync(configPath), config)
        assert.equal(await js('window.__appearanceRunning'), version)
        assert.equal(await js("odkTheme.catalog().find(record => record.manifest.id === 'odk.theme.pixel').manifest.version"), version)
        if (previous) expectedTrace.push(`stop:${previous}`, `destroy:${previous}`, `cleanup:${previous}`)
        expectedTrace.push(`create:${version}`, `start:${version}`)
        assert.deepEqual(await js('window.__appearanceTrace'), expectedTrace)
        previous = version
        await retained()
      }
      assert.equal(await js('window.__appearanceExecutions'), emptyStartup ? 2 : 3)
      const config = fs.readFileSync(configPath)
      const policyPath = process.env.ODK_NATIVE_KEYRING
      const policy = fs.readFileSync(policyPath)
      const broken = Buffer.from('{malformed fixture configuration')
      const revoked = Buffer.from(JSON.stringify({ schemaVersion: 1, publishers: {} }))
      fs.writeFileSync(configPath, broken)
      fs.writeFileSync(policyPath, revoked)
      try {
        const receipt = JSON.parse((await command(['restore-default', 'odk.theme.pixel', '--runtime'])).stdout)
        assert.equal(receipt.implementation, 'built-in')
        assert.equal(receipt.version, '1.0.0')
        assert.equal(receipt.state, 'running')
        assert.deepEqual(fs.readFileSync(configPath), broken)
        assert.deepEqual(fs.readFileSync(policyPath), revoked)
        expectedTrace.push('stop:3.0.0', 'destroy:3.0.0', 'cleanup:3.0.0')
        assert.deepEqual(await js('window.__appearanceTrace'), expectedTrace)
        assert.equal(await js("odkTheme.catalog().find(record => record.manifest.id === 'odk.theme.pixel').manifest.version"), '1.0.0')
        await retained()
      } finally { fs.writeFileSync(configPath, config); fs.writeFileSync(policyPath, policy) }
      report = { productionMain: true, actualPreload: true, actualInstallation: true, actualVerification: true, emptyStartup,
        themes: 3, retainedAppState: true, pid: process.pid }
      await js('window.odkRendererRuntime.stop()')
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.size, 0, JSON.stringify([...handlers]))
    assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
    assert.equal(protocol.isProtocolHandled('odk-user-app'), false)
    assert.ok(host.list().every(record => ['stopped', 'disabled'].includes(record.state)))
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, released: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
// Preserve production Main while giving its single hidden test window an offscreen render target.
const Module = require('node:module')
const loadModule = Module._load
const AcceptanceWindow = new Proxy(BrowserWindow, {
  construct(Window, [options]) {
    return new Window({ ...options, webPreferences: { ...options.webPreferences, offscreen: true } })
  },
})
Module._load = function (request, parent, ...args) {
  if (request === 'electron' && parent?.filename === require.resolve('../src/main')) {
    return { ...require('electron'), BrowserWindow: AcceptanceWindow }
  }
  return loadModule.call(this, request, parent, ...args)
}
try { require('../src/main') } finally { Module._load = loadModule }
