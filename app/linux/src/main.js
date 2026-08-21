const { app, BrowserWindow } = require('electron')

const DEFAULT_WIDTH = 568
const DEFAULT_HEIGHT = 1232

function resolveLaunchOptions(argv, env) {
  const width = Number.parseInt(env.ODESK_SHELL_WIDTH ?? '', 10) || DEFAULT_WIDTH
  const height = Number.parseInt(env.ODESK_SHELL_HEIGHT ?? '', 10) || DEFAULT_HEIGHT
  return {
    width,
    height,
    smoke: argv.includes('--smoke'),
    kiosk: argv.includes('--kiosk') || env.ODESK_SHELL_KIOSK === '1',
  }
}

function createWindow(options) {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    useContentSize: true,
    frame: false,
    kiosk: options.kiosk,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const query = options.kiosk ? '?kiosk=1' : ''
  win.loadFile('src/renderer/index.html', { search: query })
  return win
}

function runSmokeCheck(win, expected) {
  const timer = setTimeout(() => {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: 'timeout' })}\n`)
    app.exit(1)
  }, 15000)
  win.webContents.once('did-finish-load', () => {
    clearTimeout(timer)
    const actual = win.getContentBounds()
    const ok = actual.width === expected.width && actual.height === expected.height
    process.stdout.write(`${JSON.stringify({ ok, width: actual.width, height: actual.height })}\n`)
    app.exit(ok ? 0 : 1)
  })
}

function main() {
  const options = resolveLaunchOptions(process.argv, process.env)
  const win = createWindow(options)
  if (options.smoke) runSmokeCheck(win, { width: options.width, height: options.height })
  win.once('ready-to-show', () => win.show())
}

app.whenReady().then(main)

app.on('window-all-closed', () => {
  app.quit()
})
