'use strict'

// Measure the desk as the panel actually renders it: the cell the layout derived,
// every visible widget's box, and a histogram of the type sizes in use, plus one
// picture per page. Fixtures are not used here beyond what the shell already shows
// on a host whose services are absent, so a reading describes the real screen.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pages-')))

const width = Number(process.env.ODK_LOOK_W || 1280)
const height = Number(process.env.ODK_LOOK_H || 776)

async function main() {
  const win = new BrowserWindow({
    width, height, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  await win.loadFile(path.join(root, 'src', 'renderer', 'index.html'))
  await win.webContents.executeJavaScript('document.fonts.ready')
  win.showInactive()

  const pages = await win.webContents.executeJavaScript(
    "(() => [...document.querySelectorAll('#dots .dot')].map((dot, index) => ({ index, label: dot.getAttribute('aria-label') || '' })))()",
  )
  console.log(`PAGES ${JSON.stringify(pages.map((page) => page.label))}`)

  for (const page of pages) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('#dots .dot')[${page.index}].click()`)
    await new Promise((resolve) => setTimeout(resolve, 700))
    const reading = await win.webContents.executeJavaScript(`(() => {
      const rootStyle = getComputedStyle(document.documentElement)
      const token = (name) => rootStyle.getPropertyValue(name).trim()
      const rect = (node) => { const r = node.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } }
      const visible = (node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 }
      const widgets = [...document.querySelectorAll('[data-widget]')].filter(visible).map((node) => ({ id: node.dataset.widget, ...rect(node) }))
      const histogram = {}
      let textNodes = 0
      for (const node of document.querySelectorAll('main *, .page *')) {
        if (node.children.length > 0) continue
        const text = (node.textContent || '').trim()
        if (text.length === 0) continue
        const size = getComputedStyle(node).fontSize
        histogram[size] = (histogram[size] || 0) + 1
        textNodes += 1
      }
      return {
        page: document.querySelector('#page-context')?.textContent?.trim() || '',
        cellDim: token('--cell-dim'), cellW: token('--cell-w'), cellH: token('--cell-h'),
        viewport: { w: innerWidth, h: innerHeight },
        widgets,
        textNodes,
        fontSizes: Object.entries(histogram).sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0])),
      }
    })()`)
    console.log(`PAGE ${JSON.stringify(reading)}`)
    const image = await win.webContents.capturePage()
    const file = path.join(os.homedir(), `desk-page-${page.index + 1}.png`)
    fs.writeFileSync(file, image.toPNG())
    console.log(`SHOT ${file} (${fs.statSync(file).size} bytes)`)
  }

  app.quit()
}

app.whenReady().then(main).catch((error) => {
  console.error('pages-look failed: ' + error.message)
  app.exit(1)
})