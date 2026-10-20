const { app, BrowserWindow, ipcMain } = require('electron')
if (process.platform === 'darwin') app.dock.hide()
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const suppliedProfile = process.env.ODK_FUTU_FIXTURE_PROFILE
if (suppliedProfile) assert.equal(path.isAbsolute(suppliedProfile), true)
const profile = suppliedProfile || require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'odk-futu-render-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { fixture, publisher } = require('./helpers/futu-service')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

let win
let current
const scopes = []
let finishing
const timedOut = () => { void finish(1, Error('FUTU_SERVICE_TIMEOUT')) }
const timeout = setTimeout(timedOut, 30000)
installGeometryFixtures(ipcMain)
ipcMain.removeHandler('odk-futu-holdings')
ipcMain.handle('odk-futu-holdings', (event, request) => current.handlers.get('odk-futu-holdings')(event, request))
app.on('window-all-closed', () => {})

async function cleanup() {
  win?.destroy()
  const failures = []
  for (const scope of scopes.reverse()) for (const callback of scope.reverse()) {
    try { await callback() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Futu fixture cleanup failed')
}
if (!suppliedProfile) process.once('exit', () => require('node:fs').rmSync(profile, { recursive: true, force: true }))

function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timeout)
  if (error) console.error(error)
  finishing = cleanup().then(() => app.exit(code), cleanupError => { console.error(cleanupError); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  const timeoutAfterConnect = process.argv.includes('--timeout-after-connect')
  if (!timeoutAfterConnect) win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
  } })
  const baseline = {}
  const js = source => win.webContents.executeJavaScript(source)
  for (const signed of timeoutAfterConnect ? [true] : [false, true]) {
    const scope = []
    scopes.push(scope)
    current = await fixture({ after: callback => scope.push(callback) }, signed)
    const peer = await publisher({ after: callback => scope.push(callback) }, current.endpoint)
    if (signed && timeoutAfterConnect) {
      assert.equal((await require('node:fs/promises').stat(current.capturedRoot)).isDirectory(), true)
      console.log(JSON.stringify({ timeoutFixture: true, signedFactory: true, root: current.root,
        storedRoot: current.capturedRoot, profile, endpoint: current.endpoint, rendererUrl: win?.webContents.getURL() || '', windows: BrowserWindow.getAllWindows().length }))
      setImmediate(timedOut)
      await new Promise(() => {})
    }
    const snapshot = { totals: { plRatio: 0.0123 }, positions: [{ code: 'US.TEST', price: 42.5, dayRatio: -0.0234 }] }
    await peer.send({ type: 'data', snapshot, updatedAt: current.now() })
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
    await js('window.odkShellReady')
    const refresh = () => js(`(async () => {
      await window.odkRendererRuntime.setEnabled('odk.tile.futu', false);
      await window.odkRendererRuntime.setEnabled('odk.tile.futu', true);
    })()`)
    const settled = () => js(`(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const tile = document.querySelector('[data-widget="odk.tile.futu"]');
      const box = tile.getBoundingClientRect(); const style = getComputedStyle(document.querySelector('#futu-value'));
      return { value: document.querySelector('#futu-value').textContent,
        rows: document.querySelector('#futu-rows').textContent.trim(),
        name: document.querySelector('.futu-holding')?.getAttribute('aria-label'),
        interaction: tile.dataset.interaction,
        geometry: { width: box.width, height: box.height, font: style.fontFamily, size: style.fontSize } };
    })()`)
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      await js(`window.odkTheme.set('${theme}')`)
      await refresh()
      const value = await settled()
      assert.equal(value.value, '+1.23%')
      assert.match(value.rows, /TEST/)
      assert.match(value.rows, /-2.34%/)
      assert.equal(value.name, 'TEST, price 42.50, today -2.34%')
      assert.equal(value.interaction, 'display-only')
      if (signed) assert.deepEqual(value, baseline[theme])
      else baseline[theme] = value
    }
    current.advance(180001)
    await refresh()
    assert.equal(await js("document.querySelector('#futu-value').textContent"), '+1.23%')
    assert.equal(await js("document.querySelector('#futu-value').classList.contains('is-stale')"), true)
    assert.equal(await js("document.querySelector('#futu-value').getAttribute('aria-label')"), 'Stale holdings +1.23%')
    await peer.send({ type: 'data', snapshot: { positions: [], totals: {} }, updatedAt: current.now() })
    await refresh()
    assert.equal(await js("document.querySelector('#futu-detail').textContent"), 'No positions')
    assert.equal(await js("document.querySelector('#futu-rows').children.length"), 0)
    await peer.send({ type: 'auth-required', secrets: ['fixture-secret'], updatedAt: current.now() })
    await refresh()
    assert.equal(await js("document.querySelector('#futu-detail').textContent"), 'Check access')
    await peer.send({ type: 'error', message: 'fixture-provider-error', updatedAt: current.now() })
    await refresh()
    assert.equal(await js("document.querySelector('#futu-value').textContent"), '--')
    await current.host.stop()
  }
  console.log(JSON.stringify({ ok: true, defaultAndSignedFutu: true, themes: 3, actualPublisher: true, capturedEntryAndProjection: true }))
}).then(() => finish(0)).catch(error => finish(1, error))
