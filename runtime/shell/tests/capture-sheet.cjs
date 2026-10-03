/**
 * Contact sheet for a directory of captures: one image with every state, sized
 * for a human to read the whole set at once. Static images only, so no state can
 * lag behind its own screenshot.
 *
 *   ODK_SHEET_DIR=/tmp/states ODK_SHEET_OUT=/tmp/states/sheet.png \
 *     electron tests/capture-sheet.cjs
 *
 * ODK_SHEET_COLS   columns (default 2)
 * ODK_SHEET_CELL   cell image width in px (default 900)
 * ODK_SHEET_CROP   crop every capture to this many source pixels tall
 * ODK_SHEET_AR     capture aspect ratio, height / width (default 1280/1920)
 * ODK_SHEET_ONLY   comma-separated basenames, in the order given
 * ODK_SHEET_SKIP   comma-separated basenames to leave out
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const DIR = process.env.ODK_SHEET_DIR
const OUT = process.env.ODK_SHEET_OUT
const COLS = Number(process.env.ODK_SHEET_COLS) || 2
const CELL = Number(process.env.ODK_SHEET_CELL) || 900
const CROP = Number(process.env.ODK_SHEET_CROP) || 0
const SKIP = (process.env.ODK_SHEET_SKIP || '').split(',').filter(Boolean)
const ONLY = (process.env.ODK_SHEET_ONLY || '').split(',').filter(Boolean)
const AR = Number(process.env.ODK_SHEET_AR) || (1280 / 1920)

app.whenReady().then(async () => {
  const available = fs.readdirSync(DIR).filter((name) => name.endsWith('.png'))
  const files = ONLY.length > 0
    ? ONLY.map((name) => `${name}.png`).filter((name) => available.includes(name))
    : available.filter((name) => !SKIP.includes(name.replace(/\.png$/, ''))).sort()
  if (files.length === 0) throw new Error(`no captures in ${DIR}`)
  const rows = Math.ceil(files.length / COLS)
  const cellImageH = Math.round(CELL * AR)
  const shownH = CROP > 0 ? Math.round(CELL * (CROP / 1920)) : cellImageH
  const GAP = 14
  const CAPTION = 30
  const width = COLS * CELL + (COLS + 1) * GAP
  const rowH = shownH + CAPTION
  const height = rows * rowH + (rows + 1) * GAP
  const cells = files.map((name) => `<figure><img src="file://${path.join(DIR, name)}" style="width:${CELL}px;height:${shownH}px"><figcaption>${name.replace(/\.png$/, '')}</figcaption></figure>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #101012; font: 500 15px ui-monospace, monospace; color: #b9b9c0 }
    main { display: grid; grid-template-columns: repeat(${COLS}, ${CELL}px); gap: ${GAP}px; padding: ${GAP}px }
    figure { margin: 0 }
    img { display: block; object-fit: cover; object-position: top left; border: 1px solid #3a3a42 }
    figcaption { margin-top: 4px; color: #8b8b95 }
  </style></head><body><main>${cells}</main></body></html>`
  const htmlPath = path.join(path.dirname(OUT), 'sheet.html')
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(htmlPath, html)
  const win = new BrowserWindow({
    width, height, useContentSize: true, frame: false, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  await win.loadFile(htmlPath)
  await win.webContents.executeJavaScript(`Promise.all([...document.images].map((image) => image.decode())).then(() => document.fonts.ready)`, true)
  await new Promise((resolve) => setTimeout(resolve, 250))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', fromSurface: false, captureBeyondViewport: false, clip: { x: 0, y: 0, width, height, scale: 1 },
  })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log(`SHEET ${OUT} ${width}x${height} ${files.length} captures`)
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(1) })