'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
if (process.platform === 'darwin') app.dock.hide()
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const profile = process.env.ODK_APP_MANAGER_PROFILE
if (!profile) throw Error('App Manager browser requires a parent-owned profile')
const mode = process.env.ODK_APP_MANAGER_MODE
const invalid = process.env.ODK_APP_MANAGER_INVALID
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { selection, runtime, CHANNELS } = require('./helpers/app-manager')
const { exerciseNavigation } = require('./helpers/app-manager-navigation')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const callbacks = []
let current
let win
let finishing
installGeometryFixtures(ipcMain)
for (const channel of CHANNELS) ipcMain.removeHandler(channel)
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => { void finish(1, Error('APP_MANAGER_TIMEOUT')) }, 30000)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timeout)
  if (error) console.error(error)
  finishing = (async () => {
    const failures = []
    for (const callback of callbacks.reverse()) {
      try { await callback() } catch (failure) { failures.push(failure) }
    }
    if (failures.length) throw new AggregateError(failures, 'App Manager fixture cleanup failed')
    win?.destroy()
  })().then(() => {
    if (code === 0) app.quit()
    else app.exit(code)
  }, failure => {
    console.error(failure); win?.destroy(); app.exit(1)
  })
  return finishing
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
  } })
  const t = { after: callback => callbacks.push(callback) }
  const selected = await selection(t, { mode, parentDir: profile, transformManager: invalid ? source => {
    const marker = 'const rollback = request => {'
    assert.ok(source.includes(marker))
    return source.replace(marker, marker + "\n    if (request.type === 'rollback-open') return success(request.appId)")
  } : undefined })
  assert.equal(path.dirname(selected.root), profile)
  const plugins = await selected.load()
  if (mode === 'signed') {
    fs.writeFileSync(selected.stored.entry, 'throw Error("mutated entry")')
    fs.writeFileSync(path.join(selected.stored.root, 'manager.js'), 'throw Error("mutated manager")')
  }
  const js = source => win.webContents.executeJavaScript(source)
  let baseline
  for (const replacements of [[], plugins]) {
    current = await runtime(t, replacements, { ipc: ipcMain })
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
    await js('window.odkShellReady')
    const result = await exerciseNavigation(win, current.host)
    if (baseline) assert.deepEqual(result, baseline)
    else baseline = result
    await js('odkRendererRuntime.stop()')
    await current.host.stop()
    assert.equal(current.handlers.size, 0)
    for (const channel of CHANNELS) assert.equal(ipcMain._invokeHandlers.has(channel), false)
    assert.equal(win.isDestroyed(), false)
  }
  console.log(JSON.stringify({ actualPreload: true, mode, independent: true, browserPointerBack: true, browserKeyboardEscape: true,
    focusRestored: true, mountFailureRollback: true, handlersReleasedBeforeWindow: true }))
}).then(() => finish(0)).catch(error => finish(1, error))
