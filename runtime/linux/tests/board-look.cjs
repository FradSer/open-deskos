'use strict'

// Capture what the Pi Sessions page actually looks like at the desk's own size,
// so a claim about its layout can be checked against a picture rather than read
// out of CSS. Fixtures only: this never touches a real Pi session.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-board-shot-'))
app.setPath('userData', profile)

const startedAt = Date.now() - 60000
const session = (id, goal, status = 'running', extra = {}) => ({
  uuid: id, sessionId: id, pid: Number(id.replace(/\D/g, '')) || 1, startedAt, status,
  workspaceName: 'Example workspace', cwd: '/example/workspace',
  latestGoal: goal, activity: 'read: src/example.js',
  ...extra,
})
const fixtures = [
  session('1001', 'Example: inspect keyboard navigation.'),
  session('1002', 'Example: 优化会话阅读与返回。'),
  session('1003', 'Example: keep the lanes side by side.'),
  session('1004', 'Example: settled session one.', 'settled'),
  session('1005', 'Example: settled session two.', 'settled'),
  session('1006', 'Example: finished session.', 'exited'),
]
const snapshot = {
  ok: true,
  source: { kind: 'local', label: 'Example fixture' },
  sessions: fixtures,
  summary: { running: 3, total: fixtures.length, workspacesCount: 1 },
}

ipcMain.handle('odk-pi-sessions', () => snapshot)
ipcMain.handle('odk-pi-session-events', (_event, query) => ({
  ok: true,
  events: Array.from({ length: 12 }, (_, index) => ({ kind: 'assistant', text: `${query?.sessionId ?? 'x'}: example event ${index + 1}` })),
}))

const shot = (win, name) => win.webContents.capturePage().then((image) => {
  const file = path.join(process.env.HOME, `${name}.png`)
  fs.writeFileSync(file, image.toPNG())
  console.log(`captured ${file}`)
})

async function main() {
  const win = new BrowserWindow({
    width: 1280, height: 776, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await win.webContents.executeJavaScript('document.fonts.ready')
  await win.webContents.executeJavaScript(
    "[...document.querySelectorAll('.dot')].find(dot => dot.getAttribute('aria-label')?.includes('Pi Sessions')).click()",
  )
  await new Promise((resolve) => setTimeout(resolve, 600))

  const geometry = await win.webContents.executeJavaScript(`(() => {
    const header = document.querySelector('.pi-app-header')
    const title = document.querySelector('#pi-title')
    const filters = document.querySelector('#pi-overview-filters')
    const tabs = [...filters.querySelectorAll('.pi-filter-btn')]
    const columns = [...document.querySelectorAll('.pi-board-column')]
    const rect = node => { const r = node.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: rect(header), title: rect(title), filters: rect(filters),
      sameRow: Math.abs((rect(title).top + rect(title).height / 2) - (rect(filters).top + rect(filters).height / 2)) < 8,
      titleOffsetPx: Math.round(Math.abs((rect(title).top + rect(title).height / 2) - (rect(filters).top + rect(filters).height / 2))),
      tabRows: new Set(tabs.map(tab => Math.round(tab.getBoundingClientRect().top))).size,
      tabTops: tabs.map(tab => Math.round(tab.getBoundingClientRect().top)),
      trackHeight: Math.round(rect(filters).height),
      lanes: columns.map(column => ({ state: column.dataset.state, ...rect(column) })),
      rows: new Set(columns.map(column => rect(column).top)).size,
      cards: document.querySelectorAll('.pi-overview-cell').length,
    }
  })()`)
  console.log('GEOMETRY ' + JSON.stringify(geometry))
  await shot(win, 'pi-board-live')

  await win.webContents.executeJavaScript("document.querySelector('.pi-filter-btn[data-filter=\"all\"]').click()")
  await new Promise((resolve) => setTimeout(resolve, 400))
  const all = await win.webContents.executeJavaScript(`(() => {
    const columns = [...document.querySelectorAll('.pi-board-column')]
    return { lanes: columns.map(c => c.dataset.state), rows: new Set(columns.map(c => Math.round(c.getBoundingClientRect().top))).size, cards: document.querySelectorAll('.pi-overview-cell').length }
  })()`)
  console.log('GEOMETRY_ALL ' + JSON.stringify(all))
  await shot(win, 'pi-board-all')

  assert.ok(geometry.viewport.width > 1200, 'the capture must use the desk width')
  app.quit()
}

app.whenReady().then(main).catch((error) => {
  console.error('capture failed: ' + error.message)
  app.exit(1)
})