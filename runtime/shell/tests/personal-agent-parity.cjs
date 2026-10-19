const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { VIEWPORTS, parityScript, parityPrepareScript } = require('./helpers/personal-agent-parity')

/**
 * Renders one Personal Agent state in Electron and prints the same JSON the
 * Android host prints, so one comparison covers both hosts.
 *
 * Usage: electron tests/personal-agent-parity.cjs --state=<fixture key>
 *        [--viewport=redroid|sony] [--out=<png>]
 */

const args = new Map(process.argv.slice(1).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const stateName = args.get('state') ?? 'idle-empty'
const viewport = VIEWPORTS[args.get('viewport') ?? 'redroid']
const out = args.get('out') ?? ''
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'personal-agent-v1.json'), 'utf8'))
const status = fixture.states[stateName]
if (!status) throw new Error('unknown fixture state ' + stateName)
if (!viewport) throw new Error('unknown viewport')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-parity-'))
app.setPath('userData', profile)
installGeometryFixtures(ipcMain)
ipcMain.removeHandler('odk-personal-bot-status')
ipcMain.handle('odk-personal-bot-status', () => status)
ipcMain.handle('odk-personal-bot-text', () => ({ accepted: false }))
ipcMain.handle('odk-personal-bot-toggle', () => ({ accepted: false }))

let win
const timer = setTimeout(() => finish(1, 'timed out'), 60000)

function finish(code, note = '') {
  clearTimeout(timer)
  if (note) console.error(note)
  if (win && !win.isDestroyed()) win.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}

const evaluate = (script) => win.webContents.executeJavaScript(script)

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: viewport.width, height: viewport.height, show: false, frame: false, useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, offscreen: true, backgroundThrottling: false,
    },
  })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  win.webContents.setZoomFactor(1)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
  })
  await evaluate(parityPrepareScript())

  // The comparison pins the layout viewport, the theme and the scrollbar metric.
  // A desktop host reserves a classic scrollbar gutter where Android draws an
  // overlay one, and that gutter alone moved the Agent pane by 15 pixels.
  await win.webContents.debugger.sendCommand('Emulation.setScrollbarsHidden', { hidden: true })

  // One frame is the whole conversation, exactly as the desk sends it.
  win.webContents.send('odk-personal-bot-status', status)
  await evaluate('new Promise((resolve) => setTimeout(resolve, 80))')
  await evaluate(parityPrepareScript())

  // Compare a settled document, as the device runner does.
  let previous = null
  let reading = null
  const settleDeadline = Date.now() + 10000
  while (Date.now() < settleDeadline) {
    reading = JSON.parse(await evaluate(parityScript()))
    if (previous !== null && JSON.stringify(previous) === JSON.stringify(reading)) break
    previous = reading
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (out) {    const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
  }
  console.log('PERSONAL_AGENT_PARITY ' + JSON.stringify({ host: 'electron', state: stateName, viewport: args.get('viewport') ?? 'redroid', webView: 'Electron ' + process.versions.electron + ' Chromium ' + process.versions.chrome, reading }))
  finish(0)
}).catch((error) => finish(1, 'Electron parity failed: ' + (error && error.message)))