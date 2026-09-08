const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1280, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false } })
  const file = path.join(__dirname, '../src/renderer/index.html')
  await win.loadFile(file)
  await win.webContents.executeJavaScript(`localStorage.removeItem('odk.theme')`)
  await win.loadFile(file)
  assert.equal(await win.webContents.executeJavaScript('odkTheme.get()'), 'instrument')
  await win.webContents.executeJavaScript(`odkTheme.set('border-beam')`)
  await win.loadFile(file)
  assert.equal(await win.webContents.executeJavaScript('odkTheme.get()'), 'border-beam')
  for (const [width, height] of [[1920, 1280], [480, 854]]) {
    win.setContentSize(width, height)
    await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[1].click()`)
    await new Promise(resolve => setTimeout(resolve, 400))
    const state = await win.webContents.executeJavaScript(`(() => {
      const effect = getComputedStyle(document.querySelector('.widget'), '::after')
      return { value: odkTheme.get(), switcher: !!document.querySelector('.theme-control'),
        pointer: effect.pointerEvents, animation: effect.animationName }
    })()`)
    assert.equal(state.value, 'border-beam')
    assert.equal(state.switcher, false)
    assert.equal(state.pointer, 'none')
    assert.equal(state.animation, 'odk-beam-travel')
    if (process.env.ODK_THEME_CAPTURE_DIR) {
      fs.mkdirSync(process.env.ODK_THEME_CAPTURE_DIR, { recursive: true })
      fs.writeFileSync(path.join(process.env.ODK_THEME_CAPTURE_DIR, `${width}.png`),
        (await win.webContents.capturePage()).toPNG())
    }
  }
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  assert.equal(await win.webContents.executeJavaScript(
    `getComputedStyle(document.querySelector('.widget'), '::after').animationName`), 'none')
  win.webContents.debugger.detach()
  await win.webContents.executeJavaScript(`odkTheme.set('instrument')`)
  win.destroy()
  console.log('THEME_E2E_OK')
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
