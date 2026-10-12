const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
delete process.env.ODK_RUNTIME_ROOT
if (process.platform === 'darwin') app.dock.hide()
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-uar-render-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { registerUserAppScheme } = require('../src/user-app-system')
const { selection, runtime, ID } = require('./helpers/user-app-system-replacement')
registerUserAppScheme(protocol)
const callbacks = []
let win
let finishing
app.on('window-all-closed', () => {})
process.once('exit', () => fs.rmSync(profile, { recursive: true, force: true }))
const deadline = setTimeout(() => { void finish(1, Error('USER_APP_SYSTEM_TIMEOUT')) }, 30000)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(deadline)
  if (error) console.error(error)
  finishing = (async () => {
    win?.destroy()
    const failures = []
    for (const callback of callbacks.reverse()) {
      try { await callback() } catch (failure) { failures.push(failure) }
    }
    if (failures.length) throw new AggregateError(failures, 'Installed runtime fixture cleanup failed')
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  const t = { after: callback => callbacks.push(callback) }
  const selected = await selection(t)
  const plugins = await selected.load()
  fs.writeFileSync(selected.stored.entry, 'throw Error("mutated entry")')
  fs.writeFileSync(path.join(selected.stored.root, 'src/user-app-system.js'), 'throw Error("mutated runtime")')
  win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
  } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const js = source => win.webContents.executeJavaScript(source)
  const html = `<p id="value">Counter</p><script>
    document.fonts.load('16px "Zpix"').then(() => document.fonts.ready).then(() => {
      let confined = false;
      try { parent.document.body; } catch { confined = true; }
      parent.postMessage({ type: 'fixture-package', text: document.querySelector('#value').textContent,
        theme: document.documentElement.dataset.theme, font: getComputedStyle(document.body).fontFamily,
        loaded: document.fonts.check('16px "Zpix"'), confined, preload: typeof window.odkUserApps }, '*');
      window.odkPackageData.publish({ count: 37 });
    });
  </script>`
  let baseline
  for (const replacements of [[], plugins]) {
    const current = await runtime(t, replacements, { ui: { app, BrowserWindow, ipcMain, protocol }, html })
    const hostFile = path.join(current.root, 'host.html')
    fs.writeFileSync(hostFile, '<!doctype html><div id="host"></div><script src="frame.js"></script><script src="observe.js"></script>')
    fs.copyFileSync(path.resolve(__dirname, '../src/renderer/core/user-app-frame.js'), path.join(current.root, 'frame.js'))
    fs.writeFileSync(path.join(current.root, 'observe.js'), `window.fixtureRecords=[];window.addEventListener('message',event=>{
      if(event.source===window.instance?.frame.contentWindow && event.data?.type==='fixture-package') window.fixtureRecords.push(event.data);
    });`)
    await win.loadFile(hostFile)
    const results = []
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      current.data.registry.publish('counter', { count: 0 })
      const published = current.published()
      const result = await js(`(async () => {
        document.documentElement.dataset.theme = '${theme}';
        const listed = await window.odkUserApps.list();
        const installed = listed.apps[0];
        window.instance = odkUserAppFrame.mount(document.querySelector('#host'), { ...installed,
          url: 'odk-user-app://app/counter/' + installed.revision });
        await window.instance.ready;
        const until = performance.now() + 4000;
        while (!window.fixtureRecords.length) {
          if (performance.now() > until) throw Error('Package render did not finish');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const result = window.fixtureRecords.shift();
        result.sandbox = window.instance.frame.getAttribute('sandbox');
        return result;
      })()`)
      assert.equal(await published, 'counter')
      assert.equal((await current.data.registry.read('counter')).reading.value.count, 37)
      await js('window.instance.dispose()')
      assert.equal(result.theme, theme)
      assert.equal(result.text, 'Counter')
      assert.equal(result.confined, true)
      assert.equal(result.loaded, true)
      assert.equal(result.preload, 'undefined')
      assert.equal(result.sandbox, 'allow-scripts')
      results.push(result)
    }
    // Package-origin publication has already passed with a distinct value.
    assert.equal((await js("window.odkUserApps.publishData('counter', { count: 42 })")).ok, true)
    assert.equal((await current.data.registry.read('counter')).reading.value.count, 42)
    if (baseline) assert.deepEqual(results, baseline)
    else baseline = results
    await current.host.setEnabled('odk.system.package-catalog', false)
    assert.equal(current.host.list().find(plugin => plugin.manifest.id === ID).state, 'blocked')
    assert.equal(current.handlers.size, 0)
    assert.equal(current.routes.size, 0)
    await assert.rejects(js('window.odkUserApps.list()'), /odk-user-apps-list/)
    await current.host.setEnabled('odk.system.package-catalog', true)
    assert.equal((await js('window.odkUserApps.list()')).apps.length, 1)
    assert.equal((await current.data.registry.read('counter')).reading.value.count, 42)
    await current.host.setEnabled(ID, false)
    assert.equal(current.handlers.size, 0)
    assert.equal(current.routes.size, 0)
    await current.host.setEnabled(ID, true)
    assert.equal((await js('window.odkUserApps.list()')).apps.length, 1)
    await current.host.stop()
  }
  console.log(JSON.stringify({ ok: true, defaultAndSignedInstalledRuntime: true, actualPreload: true, opaquePackages: true, themes: 3, catalogRecovery: true }))
}).then(() => finish(0)).catch(error => finish(1, error))
