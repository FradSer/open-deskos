const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const net = require('node:net')

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-acceptance.sh'), 'utf8')

// Runs the real report against a fixture home, so the configuration invariants are asserted by their
// result rather than by the presence of their name in the script.
function acceptance(home, extra = {}) {
  const result = spawnSync('bash', ['scripts/cm5-acceptance.sh'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { PATH: `${path.join(home, 'bin')}:${process.env.PATH}`, HOME: home, XDG_RUNTIME_DIR: path.join(home, 'run'), ODK_RUNTIME_ROOT: path.join(home, 'no-such-runtime'), ...extra },
  })
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))
  return name => report.checks.find(entry => entry.name === name)
}

function fixture(t, files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-acceptance-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(home, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents, { mode: relative.startsWith('bin/') ? 0o755 : 0o600 })
  }
  return home
}

test('CM5 acceptance reports release, migration, service, runtime, and hardware evidence in one JSON contract', () => {
  assert.match(script, /SOURCE_DIR=/)
  assert.match(script, /ACTIVE_RUNTIME_DIR="\$\(readlink -f "\$current"\)"/)
  assert.match(script, /DIR="\$ACTIVE_RUNTIME_DIR"/)
  assert.match(script, /"active-release"/)
  assert.match(script, /"rollback-release"/)
  assert.match(script, /"kiosk-release-launcher"/)
  assert.match(script, /open-deskos-shell\.service/)
  assert.match(script, /"runtime-update-state"/)
  assert.match(script, /"runtime-migrations"/)
  assert.match(script, /"open-deskos-remote-bridge\.service"/)
  assert.doesNotMatch(script, /face-agent/)
  assert.match(script, /"graphical-session-autostart"/)
  assert.match(script, /import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY/)
  assert.match(script, /service_evidence "open-deskos-shell\.service" "true" "runtime"/)
  assert.match(script, /"kiosk-process"/)
  assert.match(script, /node_modules\/\.pnpm\/electron/)
  assert.doesNotMatch(script, /autostart-entry/)
  assert.match(script, /"smoke-run"/)
  assert.match(script, /"display-mode"/)
  assert.match(script, /"egl-renderer"/)
  assert.match(script, /"mali-userspace"/)
  assert.match(script, /"xorg-glamor"/)
  assert.match(script, /glamor X acceleration enabled/)
  assert.match(script, /EGL_VENDOR\|EGL_VERSION/)
  assert.match(script, /"touch-devices"/)
  assert.match(script, /"stt-endpoint-consistency"/)
  assert.match(script, /"stt-bridge-listening"/)
  assert.match(script, /"no-shadowed-configuration"/)
  assert.match(script, /"no-zombie-config"/)
  assert.match(script, /"single-voice-installation"/)
  assert.match(script, /"no-stray-runtime-code"/)
  assert.match(script, /"hosted-pi-endpoint"/)
  assert.match(script, /^configuration_evidence$/m)
  assert.match(script, /"required"/)
  assert.match(script, /"class"/)
  assert.match(script, /\[ "\$FAILURES" -eq 0 \]/)
})

// The three ways one fact gets declared twice on a device: an explicit endpoint that disagrees with
// the port the bridge declares, a drop-in that silently overrides the env file, and a second voice
// installation outside the release.
test('CM5 acceptance reports duplicated and leftover device-local configuration', t => {
  const home = fixture(t, {
    '.config/open-deskos/runtime.env': 'ODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\nODK_STT_PORT=17840\n',
    '.config/open-deskos/voice-agent.env': 'ODESK_VOICE_STT_URL=http://127.0.0.1:19999/inference\nODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\n',
    '.config/systemd/user/open-deskos-voice-agent.service.d/tasks.conf': '[Service]\nEnvironment=ODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\n',
    '.config/systemd/user/open-deskos-voice-agent.service.d/personal-agent.conf.disabled': '[Service]\n',
    '.local/share/open-deskos/voice-releases/personal-1/src/main.mjs': '',
  })
  const check = acceptance(home)
  const endpoint = check('stt-endpoint-consistency')
  assert.equal(endpoint.ok, false)
  assert.equal(endpoint.required, true)
  assert.match(endpoint.detail, /19999.*17840/)
  const shadowed = check('no-shadowed-configuration')
  assert.equal(shadowed.ok, false)
  assert.match(shadowed.detail, /ODESK_WORKSPACE/)
  assert.equal(check('no-zombie-config').ok, false)
  assert.match(check('no-zombie-config').detail, /personal-agent\.conf\.disabled/)
  assert.equal(check('single-voice-installation').ok, false)
  assert.equal(check('single-voice-installation').required, true)
})

test('CM5 acceptance accepts one declaration per fact', t => {
  const home = fixture(t, {
    '.config/open-deskos/runtime.env': 'ODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\nODK_STT_PORT=17840\n',
    '.config/open-deskos/voice-agent.env': 'ODESK_VOICE_AUDIO_DEVICE=default\n',
    '.config/systemd/user/open-deskos-voice-agent.service.d/tasks.conf': '[Service]\nEnvironment=ODESK_TASK_TARGETS_FILE=/home/kiosk/.config/open-deskos/task-targets.json\n',
  })
  const check = acceptance(home)
  assert.equal(check('stt-endpoint-consistency').ok, true)
  assert.match(check('stt-endpoint-consistency').detail, /derives port 17840/)
  assert.equal(check('no-shadowed-configuration').ok, true)
  assert.equal(check('no-zombie-config').ok, true)
  assert.equal(check('single-voice-installation').ok, true)
  assert.equal(check('no-stray-runtime-code').ok, true)
})

// The Console path discovers the desk's own Pi host through the descriptor the daemon publishes, so
// the report has to state whether that descriptor names a socket that is actually there.
test('CM5 acceptance reports the published Hosted Pi endpoint rather than assuming it works', async t => {
  const home = fixture(t, {
    '.config/open-deskos/runtime.env': 'ODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\n',
    'bin/systemctl': '#!/bin/sh\nprintf "active\\n"\n',
  })
  const socketPath = path.join(home, 'run/gone.sock')
  const descriptor = path.join(home, 'run/open-deskos/hosted-pi/endpoint.json')
  fs.mkdirSync(path.dirname(descriptor), { recursive: true, mode: 0o700 })
  fs.writeFileSync(descriptor, JSON.stringify({ version: 1, socketPath }), { mode: 0o600 })
  const dead = acceptance(home)('hosted-pi-endpoint')
  assert.equal(dead.ok, false)
  assert.equal(dead.required, false)
  assert.match(dead.detail, /gone\.sock is not a live socket/)

  // A socket file that exists is what a Console needs; `-S` is the same test the service's connect
  // would fail without, so a live listener is the only case that may report ok.
  const server = net.createServer()
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(() => server.close())
  const live = acceptance(home)('hosted-pi-endpoint')
  assert.equal(live.ok, true)
  assert.match(live.detail, /is a live socket/)
})

test('CM5 acceptance does not claim an endpoint when the host is not running', t => {
  const home = fixture(t, {
    '.config/open-deskos/runtime.env': 'ODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\n',
    'bin/systemctl': '#!/bin/sh\nprintf "inactive\\n"\n',
    'run/open-deskos/hosted-pi/endpoint.json': '{"version":1,"socketPath":"/whatever.sock"}',
  })
  const check = acceptance(home)('hosted-pi-endpoint')
  assert.equal(check.ok, false)
  assert.match(check.detail, /not active, so it publishes no endpoint/)
})

// A stale copy of runtime code beside the release once made the release's own preflight read the
// wrong tree. The report must name it instead of leaving it invisible.
test('CM5 acceptance reports runtime code copied outside the release', t => {
  const home = fixture(t, {
    '.config/open-deskos/runtime.env': 'ODESK_WORKSPACE=/home/kiosk/Developer/open-deskos\n',
    'runtime/integrations/voice-agent/src/main.mjs': '// stale copy\n',
  })
  const check = acceptance(home, { ODK_RUNTIME_ROOT: path.join(home, 'runtime') })
  const stray = check('no-stray-runtime-code')
  assert.equal(stray.ok, false)
  assert.equal(stray.required, true)
  assert.match(stray.detail, /runtime\/integrations/)
})
