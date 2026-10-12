'use strict'

const { app, BrowserWindow, ipcMain, nativeImage, protocol } = require('electron')
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
const surfaceVersion = process.env.ODK_CAMERA_BOOTSTRAP_SURFACE_VERSION
const surfaceRuntime = process.env.ODK_CAMERA_BOOTSTRAP_SURFACE_RUNTIME === '1'
const { readMarker, writeMarker, installSubscriptionTracker } = require('./helpers/camera-runtime-checkpoints')
assert.ok(!surfaceRuntime || surfaceVersion)
if (surfaceRuntime) {
  const loadFile = BrowserWindow.prototype.loadFile
  BrowserWindow.prototype.loadFile = async function (...args) {
    await this.loadURL('about:blank')
    this.webContents.debugger.attach('1.3')
    await this.webContents.debugger.sendCommand('Page.enable')
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installSubscriptionTracker.toString()})(window)`,
    })
    try { return await loadFile.apply(this, args) }
    finally { this.webContents.debugger.detach() }
  }
}
assert.ok(!surfaceVersion || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceVersion))
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
assert.ok(['live', 'unavailable'].includes(mode))
const signed = version !== '1.0.0'
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS += ',' + surfaces.filter(id => !surfaceVersion || id !== 'odk.tile.camera').join(',')
let jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(8192), Buffer.from([255, 217])])
if (surfaceVersion) {
  const pixels = Buffer.alloc(1280 * 720 * 4)
  for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
    const offset = (y * 1280 + x) * 4
    pixels[offset + (x < 640 ? 2 : 0)] = 255
    pixels[offset + 3] = 255
  }
  const encoded = nativeImage.createFromBitmap(pixels, { width: 1280, height: 720 }).toJPEG(90)
  // Trailing padding preserves JPEG decoding and the source's existing minimum frame size.
  jpeg = Buffer.concat([encoded, Buffer.alloc(Math.max(0, 8192 - encoded.length))])
}
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
  assert.equal(signed, false, 'Signed bootstrap must not construct default Camera')
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
      if (surfaceVersion) await win.webContents.executeJavaScript('window.odkShellReady')
      assert.ok(host)
      const selected = host.list().find(record => record.manifest.id === 'odk.source.camera')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      const source = host.get('odk:source/camera/v1')
      assert.equal(source.fixtureRevision, signed ? version : undefined)
      assert.ok(host.list().filter(record => !['odk.source.camera', 'odk.system.renderer-development', ...(surfaceRuntime ? ['odk.system.renderer-control'] : [])].includes(record.manifest.id))
        .every(record => record.state === 'disabled'))
      if (!surfaceVersion) assert.equal(captureCalls, 0, 'Construction performs no capture')
      const frame = await win.webContents.executeJavaScript('window.odkPlatform.getCameraFrame()')
      assert.equal(frame.status, mode)
      assert.equal(captureCalls, 1)
      let surface
      if (surfaceVersion) {
        const readSurface = () => win.webContents.executeJavaScript(`(async () => {
          await window.odkServices.camera.refresh();
          const tile = document.querySelector('[data-widget="odk.tile.camera"]');
          if (!tile || !window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.camera'), tile)) throw Error('Camera placement absent');
          const image = tile.querySelector('img');
          const expectedLive = ${JSON.stringify(mode === 'live')};
          const deadline = performance.now() + 3000;
          while (image.hidden === expectedLive) {
            if (performance.now() > deadline) throw Error('Camera service reading did not render');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          let decoded = null;
          if (expectedLive) {
            await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            decoded = { width: image.naturalWidth, height: image.naturalHeight,
              left: [...context.getImageData(100, 100, 1, 1).data], right: [...context.getImageData(1100, 100, 1, 1).data] };
          } else if (image.hasAttribute('src')) throw Error('Unavailable Camera retained frame');
          return { version: window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.camera').manifest.version,
            executedVersion: window.odkCameraSurfaceRevision || null,
            rendered: { nodes: [tile, ...tile.querySelectorAll('*')].map(node => ({
              attributes: [...node.attributes].map(attr => [attr.name, attr.value]).sort(([a],[b]) => a.localeCompare(b)),
              text: node.children.length ? null : node.textContent })),
              caption: tile.querySelector('.w-camera-state').textContent, hidden: image.hidden,
              objectFit: getComputedStyle(image).objectFit, decoded } };
        })()`)
        surface = await readSurface()
        assert.equal(surface.version, surfaceVersion)
        assert.equal(surface.executedVersion, surfaceVersion === '1.0.0' ? null : surfaceVersion)
        assert.equal(surface.rendered.objectFit, 'cover')
        assert.equal(surface.rendered.hidden, mode !== 'live')
        if (mode === 'live') {
          assert.equal(surface.rendered.decoded.width, 1280)
          assert.equal(surface.rendered.decoded.height, 720)
          const { left, right } = surface.rendered.decoded
          assert.ok(left[0] > 200 && left[1] < 30 && left[2] < 30)
          assert.ok(right[2] > 200 && right[0] < 30 && right[1] < 30)
          const at = new Date(1700000000000)
          assert.equal(surface.rendered.caption, `Updated ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`)
        } else assert.equal(surface.rendered.caption, 'Camera unavailable')
        const entries = await win.webContents.executeJavaScript('window.odkRendererPluginBridge.list()')
        surface.entries = entries.length
        assert.equal(entries.length, surfaceVersion === '1.0.0' ? 0 : 1)
        if (entries.length) assert.equal(entries[0].manifest.version, surfaceVersion)
        surface.protocolActive = protocol.isProtocolHandled('odk-native-plugin')
        assert.equal(surface.protocolActive, surfaceVersion !== '1.0.0' || surfaceRuntime)
        if (surfaceRuntime) {
          assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-control').state, 'running')
          let documentLoads = 1
          win.webContents.on('did-finish-load', () => { documentLoads++ })
          await win.webContents.executeJavaScript(`(() => {
            window.cameraRetainedDocument = document;
            window.cameraRetainedDesktop = document.querySelector('[data-widget="odk.tile.camera"]');
          })()`)
          assert.equal(await win.webContents.executeJavaScript('window.cameraTrackedSubscriptions'), 1)
          surface.runtimeVersions = []
          await writeMarker(path.join(profile, 'runtime-ready.json'), { version: surface.version })
          for (let sequence = 1; sequence <= 4; sequence++) {
            const request = await readMarker(path.join(profile, `runtime-step-${sequence}.json`))
            const running = await readSurface()
            assert.equal(running.version, request.version)
            if (request.version !== '1.0.0') assert.equal(running.executedVersion, request.version)
            assert.deepEqual(running.rendered, surface.rendered)
            assert.equal(await win.webContents.executeJavaScript(`document === window.cameraRetainedDocument
              && document.querySelector('[data-widget="odk.tile.camera"]') === window.cameraRetainedDesktop
              && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.camera'), window.cameraRetainedDesktop)
              && window.cameraTrackedSubscriptions === 1`), true)
            assert.equal(host.get('odk:source/camera/v1'), source)
            assert.equal(captureCalls, 1)
            assert.equal(documentLoads, 1)
            surface.runtimeVersions.push(running.version)
            await writeMarker(path.join(profile, `runtime-result-${sequence}.json`), { version: running.version })
          }
          await readMarker(path.join(profile, 'runtime-finish.json'))
          surface.documentLoads = documentLoads
        }
      }
      source.refresh = () => { throw Error('Cached health must not refresh Camera') }
      const cachedHealth = host.get('odk:plugin-health/odk.source.camera/v1')
      const health = cachedHealth.snapshot()
      assert.deepEqual(cachedHealth.snapshot(), health)
      assert.equal(captureCalls, 1)
      assert.equal(files.size, 0)
      report = { ...(surfaceVersion ? { surface } : {}), productionMain: true, actualPreload: true, pid: process.pid, version: selected.manifest.version,
        executedVersion: signed ? source.fixtureRevision : selected.manifest.version,
        defaultConstructions, captureCalls, hidden: !win.isVisible(), consumer: { frame, health } }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      if (surfaceRuntime) {
        assert.equal(await win.webContents.executeJavaScript('window.cameraTrackedSubscriptions'), 0)
        surface.trackedSubscriptionsReleased = true
      }
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
    if (surfaceRuntime) assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-control').state, 'stopped')
    if (surfaceVersion) {
      assert.equal(handlers.has('odk-renderer-development-plugins'), false)
      assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
      report.surface.released = true
    }
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlerReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
