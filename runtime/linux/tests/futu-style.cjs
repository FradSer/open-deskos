const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
// The host decides where a temporary directory lives, so this gate runs on the
// reference host and on a Windows host alike.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-futu-style-'))
app.setPath('userData', userData)
app.on('will-quit', () => fs.rmSync(userData, { recursive: true, force: true }))
const timer = setTimeout(() => app.exit(1), 30000)

// Deterministic sample data; never a real account or trade. These are the widest
// values the poller can actually send: a four-figure price, a two-digit change,
// and four-character symbols.
const POSITIONS = [{ code: 'US.TQQQ', price: 1234.56, dayRatio: -0.1236 }, { code: 'US.TSLA', price: 369.48, dayRatio: -0.0071 }, { code: 'US.TM', price: 26.75, dayRatio: -0.0169 }]
// The narrow cell is the one a 1280x776 handheld computes and the wide cell is the
// one a 1920x1280 reference host computes. Nothing in the tile may know which is
// which: the layout follows the cell it is rendered in.
const NARROW_CELL = 186
const WIDE_CELL = 340
const THEMES = ['instrument', 'pixel', 'border-beam']

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 776, webPreferences: { offscreen: true, backgroundThrottling: false } })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  const result = await win.webContents.executeJavaScript(`(async () => {
    const positions = ${JSON.stringify(POSITIONS)}
    const ellipsized = (node) => node.scrollWidth > node.clientWidth + 1
    const mount = async (theme, cell, reading) => {
      document.documentElement.dataset.theme = theme
      await new Promise(resolve => setTimeout(resolve, 120))
      const host = document.createElement('div')
      host.className = 'widget widget-display-only w-futu'
      host.style.cssText = 'position:fixed;left:0;top:0;width:' + cell + 'px;height:' + cell + 'px;--cell-dim:' + cell + 'px;'
      document.body.append(host)
      window.odkPlatform = { getFutuHoldings: async () => reading }
      window.odkPlugins.get('odk.tile.futu').mount(host, { onTick() {}, trackCleanup() {} })
      await new Promise(resolve => setTimeout(resolve, 140))
      return host
    }
    const live = { state: 'live', updatedAt: Date.now(), snapshot: { totals: { plRatio: -0.0153 }, positions } }
    const stale = { state: 'unavailable', error: 'stale snapshot', updatedAt: Date.now(), snapshot: { totals: { plRatio: -0.0153 }, positions } }

    // The existing contract: colors, one inset, containment, pixel spacing, and the
    // stale presentation, across sizes and states.
    const contract = []
    for (const theme of ${JSON.stringify(THEMES)}) {
      for (const size of [220, 360]) {
        for (const [kind, reading] of [['live', live], ['stale', stale]]) {
          const host = await mount(theme, size, reading)
          const value = host.querySelector('.futu-ratio')
          const pill = host.querySelector('.futu-pill')
          const note = host.querySelector('.futu-note')
          // A stale reading is deliberately neutral, whatever its direction: cached
          // holdings must not look live.
          const expected = getComputedStyle(host).getPropertyValue(reading.state === 'live' ? (reading.snapshot.totals.plRatio >= 0 ? '--odk-accent-green' : '--odk-accent-red') : '--odk-secondary-strong').trim()
          const probe = document.createElement('span'); probe.style.color = expected; host.append(probe)
          const color = getComputedStyle(probe).color; probe.remove()
          const captionProbe = document.createElement('span'); captionProbe.style.color = 'var(--odk-secondary-strong)'; host.append(captionProbe)
          const captionColor = getComputedStyle(captionProbe).color; captionProbe.remove()
          contract.push({
            theme, size, kind,
            threePrices: host.querySelectorAll('.futu-price').length === 3,
            noClippedRow: [...host.querySelectorAll('.futu-holding')].every(row => !ellipsized(row)),
            singleInset: getComputedStyle(host.querySelector('.futu-body')).paddingLeft === '0px',
            readingColor: getComputedStyle(value).color === color,
            rowColor: getComputedStyle(pill).color === color,
            transparent: getComputedStyle(pill).backgroundColor === 'rgba(0, 0, 0, 0)',
            readable: parseFloat(getComputedStyle(note).fontSize) >= 18 && parseFloat(getComputedStyle(host.querySelector('.futu-name')).fontSize) >= 18 && parseFloat(getComputedStyle(pill).fontSize) >= 20 && getComputedStyle(note).color === captionColor,
            contained: !ellipsized(value) && host.scrollHeight <= host.clientHeight + 1,
            pixelSpacing: theme !== 'pixel' || getComputedStyle(value).letterSpacing === 'normal',
            staleLabelled: kind !== 'stale' || /Stale/.test(note.textContent),
          })
          host.remove()
        }
      }
    }

    // The geometry contract: nothing is clipped at either host's cell, the narrow
    // cell carries the layout it can hold, the wide cell keeps all three values,
    // and a row that leaves out its price still states it.
    const geometry = []
    for (const theme of ${JSON.stringify(THEMES)}) {
      for (const [name, cell] of [['tiny', 150], ['narrow', ${NARROW_CELL}], ['wide', ${WIDE_CELL}]]) {
        const host = await mount(theme, cell, live)
        const list = host.querySelector('.futu-holdings')
        const row = host.querySelector('.futu-holding')
        const price = host.querySelector('.futu-price')
        geometry.push({
          theme, name, cell,
          compact: list.classList.contains('is-compact'),
          priceShown: getComputedStyle(price).display !== 'none',
          symbolsWhole: [...host.querySelectorAll('.futu-sym')].every(node => !ellipsized(node)),
          changesWhole: [...host.querySelectorAll('.futu-pill')].every(node => !ellipsized(node)),
          rowsContained: [...host.querySelectorAll('.futu-holding')].every(node => !ellipsized(node)),
          holdingsFont: parseFloat(getComputedStyle(row).fontSize),
          heightFits: host.scrollHeight <= host.clientHeight + 1,
          symbolText: host.querySelector('.futu-sym').textContent,
          changeText: pill_text(host),
          priceText: price.textContent,
          label: row.getAttribute('aria-label') || '',
        })
        host.remove()
      }
    }
    function pill_text(host) { return host.querySelector('.futu-pill').textContent }

    // Every reachable caption in the narrow cell renders whole.
    const captions = []
    for (const [state, reading] of Object.entries({
      live, empty: { state: 'live', snapshot: { totals: { plRatio: 0 }, positions: [] } },
      unconfigured: { state: 'unconfigured' }, needsAuth: { state: 'needs-auth' },
      unavailable: { state: 'unavailable' }, syncing: { state: 'syncing' },
    })) {
      const host = await mount('pixel', ${NARROW_CELL}, reading)
      const note = host.querySelector('.futu-note')
      captions.push({ state, text: note.textContent, ellipsized: ellipsized(note), font: parseFloat(getComputedStyle(note).fontSize) })
      host.remove()
    }
    return { contract, geometry, captions }
  })()`)
  for (const row of result.contract) {
    for (const key of ['threePrices', 'noClippedRow', 'singleInset', 'readingColor', 'rowColor', 'transparent', 'readable', 'contained', 'pixelSpacing', 'staleLabelled']) assert.equal(row[key], true, JSON.stringify({ ...row, failed: key }))
  }
  for (const row of result.geometry) {
    const where = JSON.stringify(row)
    assert.equal(row.rowsContained, true, where)
    assert.equal(row.symbolsWhole, true, where)
    assert.equal(row.changesWhole, true, where)
    assert.equal(row.heightFits, true, where)
    assert.equal(row.symbolText, 'TQQQ', where)
    assert.equal(row.changeText, '-12.36%', where)
    // The price is never silently dropped: the row states all three values.
    for (const part of [row.symbolText, row.priceText, row.changeText]) assert.ok(row.label.includes(part), where + ' aria-label ' + JSON.stringify(row.label))
    if (row.name === 'tiny') {
      // A cell too small even for the collapsed pair steps the type down to the
      // readable data floor, and still clips nothing.
      assert.ok(row.compact, where)
      assert.ok(row.holdingsFont >= 14 && row.holdingsFont < 20, where + ' font ' + row.holdingsFont)
    } else {
      assert.equal(row.holdingsFont, 20, where)
      if (row.name === 'narrow') assert.equal(row.priceShown, false, where)
      else { assert.equal(row.priceShown, true, where); assert.equal(row.compact, false, where) }
    }
  }
  for (const caption of result.captions) {
    const where = JSON.stringify(caption)
    assert.equal(caption.ellipsized, false, where)
    assert.equal(caption.font, 18, where)
    assert.ok(caption.text.length > 0, where)
  }
  console.log('FUTU_STYLE_PASS ' + result.contract.length + ' contract cases, ' + result.geometry.length + ' geometry cases, ' + result.captions.length + ' captions')
  win.destroy()
}).then(() => { clearTimeout(timer); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
