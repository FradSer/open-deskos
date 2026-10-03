const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const launcherPath = path.join(__dirname, '..', 'scripts', 'start-kiosk.sh')
const launcher = fs.readFileSync(launcherPath, 'utf8')

test('kiosk launcher resolves the active immutable release before falling back to its source directory', () => {
  assert.match(launcher, /ODK_RUNTIME_ROOT:-\/opt\/open-deskos/)
  assert.match(launcher, /ACTIVE_RELEASE="\$\{RUNTIME_ROOT\}\/current"/)
  assert.match(launcher, /if \[ -d "\$\{ACTIVE_RELEASE\}" \]/)
  assert.match(launcher, /DIR="\$\(CDPATH= cd -- "\$\{ACTIVE_RELEASE\}"/)
})

test('CM5 kiosk enables hardware acceleration by default and allows software fallback via environment', () => {
  assert.match(launcher, /ODESK_SKIP_STYLE_BUILD=1/)
  assert.match(launcher, /LIBGL_ALWAYS_SOFTWARE="\$\{LIBGL_ALWAYS_SOFTWARE:-0\}"/)
  assert.match(launcher, /ELECTRON_EXTRA_LAUNCH_ARGS="\$\{ELECTRON_EXTRA_LAUNCH_ARGS:-\}"/)
  assert.match(launcher, /\.\/run\.sh --kiosk \$\{ELECTRON_EXTRA_LAUNCH_ARGS\}/)
  assert.match(launcher, /SingletonLock/)
  assert.match(launcher, /SingletonCookie/)
  assert.match(launcher, /SingletonSocket/)
})

test('kiosk launcher hides the X11 pointer and disables screen blanking before starting Electron', () => {
  assert.match(launcher, /command -v unclutter/)
  assert.match(launcher, /unclutter\s+-idle\s+0\.1\s+-root/)
  assert.match(launcher, /command -v xset/)
  assert.match(launcher, /xset\s+-dpms/)
  assert.match(launcher, /xset\s+s\s+off/)
  assert.match(launcher, /xset\s+s\s+noblank/)
  assert.ok(launcher.indexOf('unclutter -idle 0.1 -root') < launcher.indexOf('while true'))
  assert.ok(launcher.indexOf('xset -dpms') < launcher.indexOf('while true'))
})
