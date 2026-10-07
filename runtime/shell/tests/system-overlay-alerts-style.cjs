'use strict'
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-overlay-style-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }))
const timer = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const rows = await win.webContents.executeJavaScript(`(() => {
    const rows = []
    const container = document.createElement('div')
    document.body.append(container)
    const manager = window.odkOverlayAlerts.create({ container })
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      document.documentElement.dataset.theme = theme
      for (const level of ['info', 'warning', 'critical']) {
        const id = manager.postAlert({ title: 'System alert', message: 'Status updated', level, timeoutMs: 0 })
        const card = container.lastElementChild
        const style = getComputedStyle(card)
        const probe = document.createElement('div')
        probe.style.color = 'var(--odk-accent-red)'
        container.append(probe)
        rows.push({ theme, level,
          widths: ['Top', 'Right', 'Bottom', 'Left'].map(side => style['border' + side + 'Width']),
          colors: ['Top', 'Right', 'Bottom', 'Left'].map(side => style['border' + side + 'Color']),
          severityColor: getComputedStyle(probe).color,
          role: card.getAttribute('role'), live: card.getAttribute('aria-live'),
        })
        probe.remove()
        card.querySelector('.alert-close').click()
        if (manager.activeAlerts().some(alert => alert.id === id)) throw new Error('Close did not dismiss alert')
      }
    }
    container.remove()
    return rows
  })()`)
  for (const row of rows) {
    assert.deepEqual(row.widths, ['1px', '1px', '1px', '1px'], JSON.stringify(row))
    assert.equal(new Set(row.colors).size, 1, JSON.stringify(row))
    if (row.level !== 'info') assert.equal(row.colors[0], row.severityColor, JSON.stringify(row))
    assert.equal(row.role, row.level === 'critical' ? 'alert' : 'status')
    assert.equal(row.live, row.level === 'critical' ? 'assertive' : 'polite')
  }
  console.log('OVERLAY_STYLE_PASS 9 theme and severity cases, accessible roles and close actions')
  win.destroy()
}).then(() => { clearTimeout(timer); app.exit(0) }).catch(error => { clearTimeout(timer); console.error(error); app.exit(1) })
