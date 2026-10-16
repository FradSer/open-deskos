'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const profile = process.env.ODK_CAMERA_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Camera bootstrap requires a private parent-owned profile')
require('./helpers/camera-private-host.cjs')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const version = process.env.ODK_CAMERA_BOOTSTRAP_VERSION
const mode = process.env.ODK_CAMERA_BOOTSTRAP_MODE
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
assert.ok(['live', 'unavailable'].includes(mode))
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS = [process.env.ODK_DISABLED_PLUGINS, 'odk.status.peripherals', ...surfaces].filter(Boolean).join(',')
const jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(8192), Buffer.from([255, 217])])
const files = new Map()
let captureCalls = 0
const controlled = { device: '/synthetic/camera', now: () => 1700000000000,
  fsImpl: {
    existsSync: () => true,
    mkdtempSync: prefix => `${prefix}bootstrap`,
    readFileSync: file => { assert.ok(files.has(file)); return files.get(file) },
    rmSync: () => files.clear(),
  },
  execFileImpl: async (command, args) => {
    assert.equal(command, 'flock')
    assert.ok(args.includes('/synthetic/camera'))
    assert.ok(args.includes('--set-fmt-video=width=1280,height=720,pixelformat=MJPG'))
    captureCalls++
    if (mode === 'unavailable') throw Error('Controlled camera failure')
    files.set(args.find(arg => arg.startsWith('--stream-to=')).slice('--stream-to='.length), jpeg)
  },
}
const sourceModule = require('../src/camera-source')
const defaultCreate = sourceModule.createCameraSource
const defaultProvider = sourceModule.createCameraCaptureProvider
let defaultConstructions = 0
sourceModule.createCameraCaptureProvider = options => defaultProvider({ ...options, ...controlled })
sourceModule.createCameraSource = options => {
  defaultConstructions++
  assert.equal(version === '1.0.0', true, 'Signed bootstrap must not construct the default Camera')
  return defaultCreate({ ...options, ...controlled })
}
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = createHost(options)
  if (options?.capabilities?.['source.camera']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
const deadline = setTimeout(() => { void fail(Error('CAMERA_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL() === 'about:blank') return
    void (async () => {
      assert.ok(host)
      const selected = host.list().find(record => record.manifest.id === 'odk.source.camera')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      const source = host.get('odk:source/camera/v1')
      assert.equal(source.fixtureRevision, version === '1.0.0' ? undefined : version)
      const frame = await win.webContents.executeJavaScript('window.odkPlatform.getCameraFrame()')
      assert.equal(frame.status, mode)
      assert.equal(captureCalls, 1)
      source.refresh = () => { throw Error('Cached health must not refresh Camera') }
      const cachedHealth = host.get('odk:plugin-health/odk.source.camera/v1')
      const health = cachedHealth.snapshot()
      assert.deepEqual(cachedHealth.snapshot(), health)
      assert.equal(captureCalls, 1)
      assert.equal(files.size, 0)
      report = { productionMain: true, actualPreload: true, pid: process.pid, version: selected.manifest.version,
        executedVersion: source.fixtureRevision || selected.manifest.version, defaultConstructions, captureCalls,
        hidden: !win.isVisible(), consumer: { frame, health } }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.has('odk-camera-frame'), false)
    assert.equal(host.list().find(record => record.manifest.id === 'odk.source.camera').state, 'stopped')
    assert.equal(files.size, 0)
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlerReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
