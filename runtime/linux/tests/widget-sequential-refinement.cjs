const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

for (const [channel, result] of Object.entries({
  'odk-opencode-go-status': { state: 'unconfigured' },
  'odk-face-agent-status': { state: 'unavailable', unlocked: false },
  'odk-hydra-status': { configured: false, connected: false, env: null, nodes: [] },
  'odk-pi-sessions': { summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [] },
  'odk-weread-highlight': { status: 'unconfigured', highlight: null },
  'odk-user-apps-list': { ok: true, apps: [] },
  'odk-remote-publish-page-state': true,
})) ipcMain.handle(channel, () => result)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1920, height: 1280, webPreferences: {
    preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false,
  } })
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
    await win.webContents.debugger.attach('1.3')
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      for (const [width, height] of [[1920, 1280], [320, 480]]) {
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        const failures = await win.webContents.executeJavaScript(`(async () => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)}
          window.dispatchEvent(new Event('resize'))
          await document.fonts.ready
          await new Promise(resolve => setTimeout(resolve, 400))
          const host = document.querySelector('[data-widget="odk.tile.face-presence"]')
          const failures = []
          const plugin = odkPlugins.get('odk.tile.face-presence')
          for (const state of ['no-face', 'unknown-face', 'starting', 'no-frame', 'camera-unavailable', 'unavailable']) {
            plugin.mount(host, { faceAgent: { subscribe(callback) { callback({ state, unlocked: false, facesCount: 0 }) } } })
            const box = host.getBoundingClientRect()
            for (const node of host.querySelectorAll('span')) {
              const rect = node.getBoundingClientRect()
              if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1 || node.scrollWidth > node.clientWidth + 1) failures.push(state + ': ' + node.className)
              if (parseFloat(getComputedStyle(node).fontSize) < 12) failures.push(state + ': text too small')
            }
          }
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
          const appHost = document.createElement('div')
          appHost.style.cssText = 'position:fixed;inset:0;overflow:auto'
          document.body.append(appHost)
          const catalog = odkPlugins.get('odk.app.app-manager')
          catalog.lifecycle.mount(appHost, { platform: {
            async listApps() { return [{ name: 'Clock', appId: 'clock' }] },
            subscribeAppState() {},
          } })
          await new Promise(resolve => setTimeout(resolve, 0))
          const search = appHost.querySelector('input')
          search.value = 'missing'
          search.dispatchEvent(new Event('input'))
          const status = appHost.querySelector('[role="status"]')
          if (status.textContent !== 'No matching built-in views. Clear search to see all views.') failures.push('catalog empty state')
          if (status.scrollWidth > status.clientWidth + 1) failures.push('catalog status overflow')
          search.value = ''
          search.dispatchEvent(new Event('input'))
          if (status.textContent || !appHost.querySelector('li')) failures.push('catalog recovery')
          appHost.remove()
          const clock = document.querySelector('.w-clock-time')
          if (clock.tagName !== 'TIME' || !/^\\d{2}:\\d{2}$/.test(clock.dateTime)) failures.push('clock semantic reading')
          return failures
        })()`)
        assert.deepEqual(failures, [], `${theme} ${width}x${height}`)
        console.log(`PASS sequential instrument states: ${theme} ${width}x${height}`)
      }
    }
  } finally {
    win.destroy()
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
