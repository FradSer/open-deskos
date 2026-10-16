const { app, BrowserWindow, ipcMain, session } = require('electron')
if (process.platform === 'darwin') app.dock.hide()
const path = require('node:path')
const assert = require('node:assert/strict')
const profile = process.env.ODK_QUOTA_PLUGIN_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Quota acceptance requires a private profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { fixture, channel } = require('./helpers/quota-runtime')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const callbacks = []
let win
let finishing
let releaseRead
const live = { state: 'available', snapshot: { fetchedAt: '2026-10-09T00:00:00.000Z', accounts: [
  { id: 'fixture-codex', provider: 'codex', account: 'fixture@example.test', plan: 'Pro', fileName: 'Long English subscription 与中文订阅.json',
    groups: [{ title: 'Usage', quotas: [{ label: '5 hours', remainingPct: 88.4, resetAt: 'provider-time' },
      { label: 'Weekly', remainingPct: null, resetAt: null }] }] },
  { id: 'fixture-failed', provider: 'xai', account: 'second@example.test', fileName: 'Unavailable account.json', error: 'Fixture account unavailable', groups: [] },
] } }
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { void finish(1, Error('QUOTA_ELECTRON_TIMEOUT')) }, 45000)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(deadline)
  if (error) console.error(error)
  releaseRead?.(live)
  finishing = (async () => {
    win?.destroy()
    const failures = []
    for (const callback of callbacks.reverse()) {
      try { await callback() } catch (failure) { failures.push(failure) }
    }
    if (failures.length) throw new AggregateError(failures, 'Quota fixture cleanup failed')
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  installGeometryFixtures(ipcMain)
  // AI usage is a Widget App now, so the Shell needs the shared App manager the
  // same way every other Widget App fixture carries it.
  const appManager = createAppManagerEndpoint()
  for (const [name, handler] of [
    ['odk-app-manager-list', () => appManager.list()],
    ['odk-app-manager-state', (_event, appId) => appManager.get(appId)],
    ['odk-app-manager-intent', (_event, intent) => appManager.dispatch(intent)],
  ]) { ipcMain.removeHandler(name); ipcMain.handle(name, handler) }
  ipcMain.removeHandler(channel)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false,
  } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const js = source => win.webContents.executeJavaScript(source)
  const waitReady = () => js(`(async () => {
    const deadline = performance.now() + 4000;
    const settled = () => {
      const button = document.querySelector('#quota-refresh');
      if (!button || button.disabled) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth + 1;
    };
    while (!settled()) {
      if (performance.now() > deadline) throw Error('Quota refresh did not settle');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await document.fonts.load('16px "Zpix"');
    await document.fonts.load('16px "Montserrat"');
    await document.fonts.load('16px "Noto Sans SC"');
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`)
  const openUsage = () => js(`(async () => {
    if (odkAppPlatform.active()?.appId !== 'quota') await odkAppPlatform.openApp({ appId: 'quota' });
  })()`)
  const collect = async () => {
    const result = await js(`(async () => { try {
    // AI usage is a Widget App: the Widget opens the App, and the App view owns
    // the quota surface.
    const page = document.querySelector('#app-view');
    if (page.hidden) throw Error('Quota App is not open');
    const button = page.querySelector('#quota-refresh');
    const feedback = page.querySelector('#quota-feedback');
    const metrics = page.querySelector('#quota-metrics');
    const value = metrics.querySelector('.provider-quota-value');
    const rect = button.getBoundingClientRect();
    const bounds = page.getBoundingClientRect();
    if (getComputedStyle(page).visibility === 'hidden' || bounds.right <= 0 || bounds.left >= innerWidth) throw Error('Quota page is not visible');
    if (rect.width <= 0 || rect.right > bounds.right + 1 || rect.left < bounds.left - 1 || rect.right > innerWidth + 1 || rect.left < 0) throw Error('Quota refresh control outside the App surface');
    if (parseFloat(getComputedStyle(button).fontSize) < 14) throw Error('Quota refresh text too small');
    for (const card of metrics.querySelectorAll('.provider-quota-card')) {
      if (card.scrollWidth > card.clientWidth + 1) throw Error('Quota account overflows horizontally');
      for (const meter of card.querySelectorAll('[role="meter"]')) {
        meter.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = card.getBoundingClientRect();
        const reading = meter.getBoundingClientRect();
        const expectedFill = meter.clientWidth * Number(meter.getAttribute('aria-valuenow')) / 100;
        const actualFill = meter.querySelector('.provider-quota-fill').getBoundingClientRect().width;
        if (Math.abs(actualFill - expectedFill) > 1) throw Error('Rendered quota fill does not match its percentage');
        if (reading.width <= 0 || reading.height <= 0 || reading.left < box.left || reading.right > box.right + 1
          || reading.top < box.top || reading.bottom > box.bottom + 1) throw Error('Quota meter outside account');
        if (reading.left < 0 || reading.right > innerWidth + 1 || reading.top < 0 || reading.bottom > innerHeight + 1) throw Error('Quota meter outside viewport');
      }
    }
    return {
      theme: document.documentElement.dataset.theme,
      context: document.querySelector('#page-context').textContent,
      app: odkAppPlatform.active()?.appId || null,
      count: page.querySelector('#quota-count').textContent,
      feedback: feedback.textContent, role: feedback.getAttribute('role'), live: feedback.getAttribute('aria-live'),
      metrics: metrics.textContent.replace(/\\s+/g, ' ').trim(), cards: metrics.querySelectorAll('.provider-quota-card').length,
      meters: [...metrics.querySelectorAll('[role="meter"]')].map(node => ({ label: node.getAttribute('aria-label'),
        value: node.getAttribute('aria-valuenow'), text: node.getAttribute('aria-valuetext') })),
      busy: button.getAttribute('aria-busy'), disabled: button.disabled,
      checked: page.querySelector('#quota-checked').textContent.includes('Last checked'),
      font: value ? getComputedStyle(value).fontFamily : null,
      zpixLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'Zpix' && face.status === 'loaded'),
    };
    } catch (error) { return { error: error.message } }
  })()`)
    assert.equal(result.error, undefined, result.error)
    return result
  }
  const baseline = new Map()
  for (const replacement of [false, 'signed']) {
    let response = live
    let provider = async () => response
    const current = await fixture({ after: callback => callbacks.push(callback) }, replacement, options => provider(options), { ipc: ipcMain })
    for (const size of [[1920, 1280], [480, 854]]) {
      win.setContentSize(...size)
      for (const theme of ['instrument', 'pixel', 'border-beam']) {
        response = live
        await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
        await js('window.odkShellReady')
        await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
        await openUsage()
        await waitReady()
        const results = [await collect()]
        assert.equal(results[0].cards, 2)
        assert.equal(results[0].meters[0].value, '88.4')
        assert.match(results[0].metrics, /Unavailable/)
        assert.match(results[0].metrics, /Fixture account unavailable/)
        assert.equal(results[0].role, 'status')
        assert.equal(results[0].live, 'polite')
        assert.equal(results[0].checked, true)
        assert.equal(results[0].theme, theme)
        assert.equal(results[0].zpixLoaded, true)
        assert.match(results[0].font, theme === 'pixel' ? /Zpix/ : /Montserrat/)
        const ipcResult = await js('window.odkPlatform.getOpenCodeGoStatus()')
        assert.deepEqual(ipcResult, live)
        let entered
        const entering = new Promise(resolve => { entered = resolve })
        provider = () => { entered(); return new Promise(resolve => { releaseRead = resolve }) }
        await js('document.querySelector("#quota-refresh").click()')
        await entering
        const loading = await collect()
        assert.equal(loading.disabled, true)
        assert.equal(loading.busy, 'true')
        assert.match(loading.feedback, /Refreshing quotas/)
        results.push(loading)
        releaseRead(live)
        releaseRead = null
        provider = async () => response
        await waitReady()
        for (const status of [
          { state: 'unavailable', snapshot: live.snapshot, reason: 'Fixture connection unavailable' },
          { state: 'unauthorized' }, { state: 'unconfigured' },
          { state: 'available', snapshot: { accounts: [] } },
        ]) {
          response = status
          await js('document.querySelector("#quota-refresh").click()')
          await waitReady()
          results.push(await collect())
        }
        assert.equal(results[2].cards, 2)
        assert.match(results[2].feedback, /Showing the previous response/)
        assert.match(results[3].metrics, /rejected the management key/)
        assert.equal(results[3].meters.length, 0)
        assert.equal(results[4].cards, 0)
        assert.equal(results[5].count, '0 subscriptions')
        provider = async () => { throw Error('Fixture transport failed') }
        await js('document.querySelector("#quota-refresh").click()')
        await waitReady()
        results.push(await collect())
        assert.match(results[6].metrics, /Fixture transport failed/)
        assert.equal(results[6].meters.length, 0)
        response = live
        provider = async () => response
        await js('document.querySelector("#quota-refresh").click()')
        await waitReady()
        results.push(await collect())
        assert.equal(results[7].cards, 2)
        await js(`odkAppPlatform.closeApp()`)
        await js(`document.querySelectorAll('#dots .dot')[0].click()`)
        assert.match(await js('document.querySelector("#page-context").textContent'), /Home/)
        // The Home Widget is the only way to the App: paging cannot reach it.
        assert.equal(await js(`document.querySelector('#pages-track .page[data-page-id="quota"]') === null`), true)
        await js(`document.querySelector('[data-widget="odk.tile.quota"] .widget-launch').click()`)
        await waitReady()
        assert.equal((await collect()).app, 'quota')
        const key = `${size.join('x')}/${theme}`
        if (replacement) assert.deepEqual(results, baseline.get(key))
        else baseline.set(key, results)
      }
    }
    await current.host.stop()
    assert.equal(current.handlers.size, 0)
  }
  console.log(JSON.stringify({ ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 2 }))
}).then(() => finish(0)).catch(error => finish(1, error))
