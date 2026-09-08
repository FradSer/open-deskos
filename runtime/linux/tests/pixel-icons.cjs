const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1280, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false } })
  const file = path.join(__dirname, '../src/renderer/index.html')
  await win.loadFile(file)
  await win.webContents.executeJavaScript(`localStorage.setItem('odk.theme', 'pixel')`)
  await win.loadFile(file)
  assert.equal(await win.webContents.executeJavaScript('odkTheme.get()'), 'pixel')

  const pixelState = await win.webContents.executeJavaScript(`(() => {
    const icons = [...document.querySelectorAll('svg[data-tabler]')]
    return {
      count: icons.length,
      pixelated: icons.filter((s) => s.getAttribute('fill') === 'currentColor' && !s.hasAttribute('stroke')),
      hasPath: icons.filter((s) => s.querySelector('path[d]')),
      stroked: icons.filter((s) => s.getAttribute('stroke') === 'currentColor'),
    }
  })()`)
  assert.ok(pixelState.count >= 3, `expected icons on the page, found ${pixelState.count}`)
  assert.equal(pixelState.pixelated.length, pixelState.count, 'pixel theme must swap every icon to fill=currentColor without stroke')
  assert.equal(pixelState.stroked.length, 0, 'pixel theme must not keep Tabler stroke icons')
  assert.equal(pixelState.hasPath.length, pixelState.count, 'pixel icons must render path data')

  const boltIsLink = await win.webContents.executeJavaScript(
    `document.querySelector('svg[data-tabler="bolt"]').innerHTML.includes('M4 6h7v2H4')`)
  assert.equal(boltIsLink, true, 'bolt must render the pixel link icon under the pixel theme')

  await win.webContents.executeJavaScript(`odkTheme.set('instrument')`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const instrumentState = await win.webContents.executeJavaScript(`(() => {
    const icons = [...document.querySelectorAll('svg[data-tabler]')]
    return {
      restored: icons.filter((s) => s.getAttribute('fill') === 'none' && s.getAttribute('stroke') === 'currentColor'),
      stroked: icons.filter((s) => s.getAttribute('stroke') === 'currentColor'),
    }
  })()`)
  assert.equal(instrumentState.restored.length, pixelState.count, 'non-pixel themes must restore Tabler stroke icons')
  assert.equal(instrumentState.stroked.length, instrumentState.restored.length)

  await win.webContents.executeJavaScript(`odkTheme.set('pixel')`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const reswapped = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('svg[data-tabler]')].filter((s) => s.getAttribute('fill') === 'currentColor' && !s.hasAttribute('stroke')).length`)
  assert.equal(reswapped, pixelState.count, 'switching back to pixel must re-swap icons')

  win.destroy()
  console.log('PIXEL_ICONS_E2E_OK')
  app.quit()
}).catch((error) => { console.error(error); app.exit(1) })
