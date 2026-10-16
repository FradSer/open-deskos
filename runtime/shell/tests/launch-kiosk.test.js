const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { posixOnlyReason } = require('./not-ported')

const launcherPath = path.join(__dirname, '..', 'scripts', 'start-kiosk.sh')
const launcher = fs.readFileSync(launcherPath, 'utf8')

test('CM5 installer selects an active kiosk X11 Display and leaves an absent Display unset', { skip: posixOnlyReason('cm5-tooling') }, t => {
  const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-install.sh'), 'utf8')
  const selection = installer.split('run_as_target_user systemctl --user daemon-reload\n')[1]?.split('if [ -n "${GRAPHICAL_DISPLAY}" ]; then')[0]
  assert(selection, 'Exercise the installer selection without executing installation')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-graphical-display-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const available of [true, false]) {
    const log = path.join(root, 'calls')
    fs.writeFileSync(log, '')
    const result = spawnSync('bash', ['-c', `set -euo pipefail
TARGET_USER=kiosk
loginctl() {
  if [ "$1" = list-sessions ]; then
    printf '%s\\n' 'serial 1000 kiosk - ttyS2' 'foreign 1001 other - tty1' 'stale 1000 kiosk - -' 'closing 1000 kiosk seat0 tty7' 'nongraphical 1000 kiosk - tty2' 'inactive 1000 kiosk seat0 tty3' 'graphical 1000 kiosk seat0 tty8' 'later 1000 kiosk seat0 tty9'
  else
    printf '%s\\n' "$2" >> '${log}'
    local display='' type=x11 active=yes state=active
    case "$2" in
      serial) type=tty;;
      stale) return 1;;
      closing) display=:0; active=no; state=closing;;
      nongraphical) display=:22; type=tty;;
      inactive) display=:33; active=no; state=online;;
      graphical) ${available ? 'display=:1' : ':'};;
      later) ${available ? 'display=:2' : ':'};;
      *) return 2;;
    esac
    if [[ "$*" == *--value* ]]; then printf '%s' "$display"; else
      printf '%s\\n' "Display=$display" "Type=$type" "Active=$active" "State=$state"
    fi
  fi
}
${selection}
printf '%s' "$GRAPHICAL_DISPLAY"`], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, available ? ':1' : '')
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), available ? ['serial', 'stale', 'closing', 'nongraphical', 'inactive', 'graphical'] : ['serial', 'stale', 'closing', 'nongraphical', 'inactive', 'graphical', 'later'])
  }
})

test('kiosk launcher resolves the active immutable release before falling back to its source directory', () => {
  assert.match(launcher, /ODK_RUNTIME_ROOT:-\/opt\/odk/)
  assert.match(launcher, /ACTIVE_RELEASE="\$\{RUNTIME_ROOT\}\/current"/)
  assert.match(launcher, /if \[ -d "\$\{ACTIVE_RELEASE\}" \]/)
  assert.match(launcher, /DIR="\$\(CDPATH= cd -- "\$\{ACTIVE_RELEASE\}"/)
})

test('CM5 kiosk enables hardware acceleration by default and allows software fallback via environment', () => {
  assert.match(launcher, /ODK_SKIP_STYLE_BUILD=1/)
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

test('CM5 startup selects RGB and resets scanout before disabling DPMS', { skip: posixOnlyReason('cm5-tooling') }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-display-color-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin')
  const scripts = path.join(root, 'scripts')
  fs.mkdirSync(bin)
  fs.mkdirSync(scripts)
  fs.copyFileSync(launcherPath, path.join(scripts, 'start-kiosk.sh'))
  const log = path.join(root, 'commands')
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  stub('uname', 'echo aarch64')
  stub('xrandr', `echo "xrandr $*" >> '${log}'; if [ "$1" = --prop ]; then printf 'HDMI-1 connected primary 1920x1280+0+0\\n\\tcolor_format: yuv444\\n\\tcolor_depth: 24bit\\n'; fi`)
  stub('xset', `echo "xset $*" >> '${log}'`)
  stub('openbox', 'exit 0')
  stub('unclutter', 'exit 0')
  fs.writeFileSync(path.join(root, 'run.sh'), '#!/bin/sh\nkill -TERM "$PPID"\n', { mode: 0o755 })
  const result = spawnSync('bash', [path.join(scripts, 'start-kiosk.sh')], {
    env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, ODK_RUNTIME_ROOT: path.join(root, 'missing-release'), DISPLAY: ':fixture' },
    timeout: 5000,
    encoding: 'utf8',
  })
  assert.equal(result.signal, 'SIGTERM', result.stderr)
  const calls = fs.readFileSync(log, 'utf8')
  assert.match(calls, /xrandr --output HDMI-1 --set color_format rgb --set color_depth 24bit/)
  assert.match(calls, /xset dpms force off\nxset dpms force on\nxset -dpms/)
})
