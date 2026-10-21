const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
ipcMain.handle('odk-camera-frame', () => ({ status: 'unavailable', frame: null, capturedAt: null }))
ipcMain.handle('odk-weather-status', () => ({ status: 'unconfigured', place: null, current: null, daily: null, updatedAt: null, hint: null, error: null }))
ipcMain.handle('odk-futu-holdings', () => ({ state: 'unavailable', service: 'futu-poller', snapshot: null, updatedAt: null }))
ipcMain.handle('odk-renderer-development-plugins', () => [])
ipcMain.handle('odk-personal-bot-status', () => ({ state: 'unavailable' }))
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const endpoint = createAppManagerEndpoint()
let catalogMode = 'success'
let pendingCatalog
let userCatalogMode = 'success'
let pendingUserCatalog
ipcMain.handle('odk-user-apps-list', () => {
  if (userCatalogMode === 'pending') return new Promise(resolve => { pendingUserCatalog = resolve })
  if (userCatalogMode === 'error') return { ok: false, error: 'Catalog unavailable' }
  return { ok: true, apps: [] }
})
ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
ipcMain.handle('odk-app-manager-state', (_event, id) => endpoint.get(id))
ipcMain.handle('odk-app-manager-list', () => {
  if (catalogMode === 'pending') return new Promise(resolve => { pendingCatalog = resolve })
  if (catalogMode === 'error') throw new Error('Catalog unavailable')
  return endpoint.list()
})

for (const [channel, result] of Object.entries({
  'odk-opencode-go-status': { state: 'unconfigured' },
  'odk-hydra-status': { configured: false, connected: false, env: null, nodes: [] },
  'odk-pi-sessions': { summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [] },
  'odk-weread-highlight': { status: 'unconfigured', highlight: null },
  'odk-remote-publish-page-state': true,
})) ipcMain.handle(channel, () => result)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1920, height: 1280, webPreferences: {
    preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false,
  } })
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
    await win.webContents.debugger.attach('1.3')
    for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
      for (const [width, height] of [[1920, 1280], [320, 480]]) {
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        const failures = await win.webContents.executeJavaScript(`(async () => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)}
          window.dispatchEvent(new Event('resize'))
          await document.fonts.ready
          await new Promise(resolve => setTimeout(resolve, 400))
          const failures = []
          const hydra = document.querySelector('[data-widget="odk.tile.hydra"]')
          let hydraTick
          const platform = window.odkPlatform
          window.odkPlatform = { ...platform, async getHydraStatus() {
            return { configured: true, connected: true, env: null, nodes: [{ id: 1, online: false, soilPercent: 62 }] }
          } }
          odkPlugins.get('odk.tile.hydra').mount(hydra, { onTick(callback) { hydraTick = callback } })
          hydraTick()
          await new Promise(resolve => setTimeout(resolve, 0))
          if (hydra.querySelector('#hydra-plant-1 .hydra-meter-fill').getBoundingClientRect().width > 0) failures.push('offline Hydra meter')
          if (hydra.querySelector('#hydra-plant-1 .hydra-plant-soil').textContent !== '--') failures.push('offline Hydra reading')
          window.odkPlatform = platform
          await odkAppPlatform.openApp({ appId: 'app-manager' })
          const appHost = document.querySelector('#app-runtime')
          await new Promise(resolve => setTimeout(resolve, 100))
          const search = appHost.querySelector('input')
          search.value = 'missing'
          search.dispatchEvent(new Event('input'))
          const status = appHost.querySelector('[role="status"]')
          if (status.textContent !== 'No matching built-in views. Clear search to see all views.') failures.push('catalog empty state')
          if (status.scrollWidth > status.clientWidth + 1) failures.push('catalog status overflow')
          search.value = ''
          search.dispatchEvent(new Event('input'))
          if (status.textContent || !appHost.querySelector('li')) failures.push('catalog recovery')
          await odkAppPlatform.closeApp()
          for (const id of ['pomodoro', 'year']) {
            await odkAppPlatform.openApp({ appId: id })
            const surface = document.querySelector('#app-runtime .runtime-app')
            if (surface.scrollWidth > surface.clientWidth + 1) failures.push(id + ': overflow')
            if (id === 'pomodoro' && (!surface.querySelector('.pomodoro-dial') || !surface.querySelector('button'))) failures.push('pomodoro missing timer')
            if (id === 'year' && !surface.querySelector('.runtime-value').textContent.includes('%')) failures.push('year missing progress')
            for (const node of surface.querySelectorAll('p,time,h2')) {
              if (node.scrollWidth > node.clientWidth + 1) failures.push(id + ': text overflow')
              if (parseFloat(getComputedStyle(node).fontSize) < 12) failures.push(id + ': text too small')
            }
            await odkAppPlatform.closeApp()
          }
          if (document.querySelector('[data-widget="odk.tile.clock"], [data-widget="odk.tile.calendar"], [data-widget="odk.tile.almanac"], [data-widget="odk.tile.preorder"]')) failures.push('retired Widget')
          return failures
        })()`)
        assert.deepEqual(failures, [], `${theme} ${width}x${height}`)
        console.log(`PASS sequential instrument states: ${theme} ${width}x${height}`)
        catalogMode = 'pending'
        await win.webContents.executeJavaScript(`odkAppPlatform.openApp({ appId: 'app-manager' })`)
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal(await win.webContents.executeJavaScript(`(() => {
          const search = document.querySelector('#app-runtime input')
          search.value = 'year'; search.dispatchEvent(new Event('input'))
          return document.querySelector('#app-runtime [role="status"]').textContent
        })()`), 'Loading built-in views.')
        pendingCatalog(endpoint.list())
        await new Promise(resolve => setTimeout(resolve, 50))
        await win.webContents.executeJavaScript(`odkAppPlatform.closeApp()`)
        catalogMode = 'error'
        await win.webContents.executeJavaScript(`odkAppPlatform.openApp({ appId: 'app-manager' })`)
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal(await win.webContents.executeJavaScript(`(() => {
          const search = document.querySelector('#app-runtime input')
          search.value = 'year'; search.dispatchEvent(new Event('input'))
          return document.querySelector('#app-runtime [role="status"]').textContent.includes('endpoint-unavailable') && !document.querySelector('.app-manager-retry').hidden
        })()`), true)
        catalogMode = 'success'
        await win.webContents.executeJavaScript(`document.querySelector('.app-manager-retry').click()`)
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#app-runtime li').length`), 1)
        await win.webContents.executeJavaScript(`odkAppPlatform.closeApp()`)
        console.log(`PASS routed catalog pending/error/reload: ${theme} ${width}x${height}`)
        await win.webContents.executeJavaScript(`document.querySelectorAll('#dots .dot')[1].click()`)
        userCatalogMode = 'pending'
        win.webContents.send('odk-user-apps-changed')
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#user-app-desktop-status').textContent`), 'Loading installed applications.')
        pendingUserCatalog({ ok: false, error: 'Catalog unavailable' })
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.match(await win.webContents.executeJavaScript(`document.querySelector('#user-app-desktop-status').textContent`), /applications unavailable/i)
        userCatalogMode = 'success'
        win.webContents.send('odk-user-apps-changed')
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#user-app-desktop-status').textContent`), '')
        for (const close of ['back', 'escape']) {
          await win.webContents.executeJavaScript(`(async () => {
            document.querySelectorAll('#dots .dot')[1].focus()
            await odkAppPlatform.openApp({ appId: 'year' })
          })()`)
          assert.equal(await win.webContents.executeJavaScript(`document.activeElement.id`), 'app-back')
          await win.webContents.executeJavaScript(close === 'back'
            ? `document.querySelector('#app-back').click()`
            : `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
          await new Promise(resolve => setTimeout(resolve, 100))
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#app-view').hidden && document.activeElement === document.querySelectorAll('#dots .dot')[1]`), true)
        }
        assert.equal(await win.webContents.executeJavaScript(`(() => {
          const surface = document.querySelector('#user-app-desktop-status')
          return !document.querySelector('.user-apps') && surface.scrollWidth <= surface.clientWidth + 1
        })()`), true)
        console.log(`PASS desktop catalog loading/recovery/focus/Back/Escape: ${theme} ${width}x${height}`)
      }
    }
  } finally {
    win.destroy()
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
