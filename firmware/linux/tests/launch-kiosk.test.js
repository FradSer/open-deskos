const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const launcherPath = path.join(__dirname, '..', 'scripts', 'start-kiosk.sh')
const launcher = fs.readFileSync(launcherPath, 'utf8')

test('kiosk launcher disables X11 screen blanking before starting Electron', () => {
  assert.match(launcher, /command -v xset/)
  assert.match(launcher, /xset\s+-dpms/)
  assert.match(launcher, /xset\s+s\s+off/)
  assert.match(launcher, /xset\s+s\s+noblank/)
  assert.ok(launcher.indexOf('xset -dpms') < launcher.indexOf('while true'))
})
