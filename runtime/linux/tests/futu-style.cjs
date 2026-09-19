const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const userData = fs.mkdtempSync('/tmp/odk-futu-style-')
app.setPath('userData', userData)
app.on('will-quit', () => fs.rmSync(userData, { recursive: true, force: true }))
const timer = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 960, height: 640, webPreferences: { offscreen: true, backgroundThrottling: false } })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  const result = await win.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready
    const results = []
    // Deterministic sample data; never a real account or trade.
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      document.documentElement.dataset.theme = theme
      for (const size of [220, 360]) {
        for (const stale of [false, true]) {
          const host = document.createElement('div')
          host.className = 'widget w-futu'
          host.style.cssText = 'position:fixed;left:0;top:0;width:' + size + 'px;height:' + size + 'px;'
          document.body.append(host)
          window.odkPlatform = { getFutuHoldings: async () => ({ state: stale ? 'unavailable' : 'live', updatedAt: Date.now(), snapshot: { totals: { plRatio: .0235 }, positions: [{code: 'US.TEM', price:64.25, dayRatio: .031}, {code:'US.SDGR', price:23.5, dayRatio:-.012}, {code:'US.TSLA', price:345.6, dayRatio:.02}] } }) }
          window.odkPlugins.get('odk.tile.futu').mount(host, {onTick() {}, trackCleanup() {}})
          await new Promise(resolve => setTimeout(resolve, 80))
          const value = host.querySelector('.futu-ratio')
          const pill = host.querySelector('.futu-pill')
          const note = host.querySelector('.futu-note')
          const css = getComputedStyle(host)
          const expected = css.getPropertyValue(stale ? '--odk-secondary-strong' : '--odk-accent-green').trim()
          const probe = document.createElement('span'); probe.style.color = expected; host.append(probe)
          const color = getComputedStyle(probe).color; probe.remove()
          results.push({ theme, size, stale, threePrices: host.querySelectorAll('.futu-price').length === 3 && [...host.querySelectorAll('.futu-holding')].every(row => row.scrollWidth <= row.clientWidth + 1), singleInset: getComputedStyle(host.querySelector('.futu-body')).paddingLeft === '0px', gain: getComputedStyle(value).color === color, row: getComputedStyle(pill).color === color, transparent: getComputedStyle(pill).backgroundColor === 'rgba(0, 0, 0, 0)', readable: parseFloat(getComputedStyle(note).fontSize) >= 18 && parseFloat(getComputedStyle(host.querySelector('.futu-name')).fontSize) >= 18 && parseFloat(getComputedStyle(pill).fontSize) >= 20 && getComputedStyle(note).color === (() => {const p=document.createElement('span');p.style.color='var(--odk-secondary-strong)';host.append(p);const c=getComputedStyle(p).color;p.remove();return c})(), contained: value.scrollWidth <= value.clientWidth + 1 && host.scrollHeight <= host.clientHeight + 1, pixelSpacing: theme !== 'pixel' || getComputedStyle(value).letterSpacing === 'normal' })
          host.remove()
        }
      }
    }
    return results
  })()`)
  for (const row of result) for (const key of ['threePrices', 'singleInset', 'gain', 'row', 'transparent', 'readable', 'contained', 'pixelSpacing']) assert.equal(row[key], true, JSON.stringify({ ...row, failed: key }))
  console.log('FUTU_STYLE_PASS ' + result.length + ' fixture cases')
  win.destroy()
}).then(() => { clearTimeout(timer); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
