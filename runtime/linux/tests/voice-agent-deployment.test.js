const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const installer = fs.readFileSync('scripts/cm5-install.sh', 'utf8')
const stage = fs.readFileSync('scripts/cm5-stage-release.sh', 'utf8')
const helperPath = path.resolve('scripts/cm5-voice-agent.sh')

// A development checkout keeps integrations beside runtime/linux; a release flattens runtime/linux
// and seals integrations at its own root, while the runtime root may hold an unrelated integrations
// tree. Resolve the one that actually carries the integration under test instead of assuming depth.
function integrationTree() {
  for (const base of ['integrations', '../../integrations']) {
    const candidate = path.join(base, 'voice-agent')
    if (fs.existsSync(path.join(candidate, 'package.json')) &&
      fs.existsSync(path.join(candidate, 'systemd/open-deskos-pi-tasks.service'))) return candidate
  }
  throw new Error(`voice-agent integration tree not found from ${process.cwd()}`)
}

test('integration staging excludes host dependencies and private auth/config', () => {
  const integrations = stage.split('\n').filter((line, index, lines) =>
    line.includes('"${ROOT}/integrations/"') || lines[index + 1]?.includes('"${ROOT}/integrations/"')).join('\n')
  for (const excluded of ['node_modules', '.env*', 'auth.json', '.pi', '*.env']) {
    assert.ok(integrations.includes(`--exclude '${excluded}'`), excluded)
  }
})

test('required components are staged before activation and started after it', () => {
  assert.match(installer, /source "\$\{DIR\}\/scripts\/cm5-voice-agent.sh"/)
  const preparation = installer.indexOf('prepare_voice_agent_release')
  const activation = installer.indexOf('scripts/update-runtime.js')
  const shellUnit = installer.indexOf('KIOSK_UNIT_DIR=')
  assert.ok(preparation < activation, 'the candidate carries the integration before activation')
  assert.ok(shellUnit < installer.indexOf('stage_voice_agent_service'), 'the shell unit is written before the required components')
  assert.ok(installer.indexOf('stage_voice_agent_service') < activation)
  assert.ok(installer.indexOf('stage_task_host_service') < activation)
  assert.ok(installer.indexOf('start_required_services') > activation, 'required services start after activation')
  assert.doesNotMatch(installer, /(?:Requires|Wants)=open-deskos-voice/)
})

test('a required component that cannot be staged fails the installation naming its configuration', () => {
  assert.match(installer, /stage_voice_agent_service \|\| \{/)
  assert.match(installer, /Required Voice Agent component could not be installed.*voice-agent\.env/s)
  assert.match(installer, /stage_task_host_service \|\| \{/)
  assert.match(installer, /Required Hosted Pi control component could not be installed.*pi-tasks\.json/s)
  assert.match(installer, /stage_desk_link_service \|\| \{/)
  assert.match(installer, /Desk Link unit could not be staged/)
  assert.match(installer, /start_required_services \|\| \{/)
  assert.doesNotMatch(installer, /install_voice_agent_service \|\| echo/)
  assert.doesNotMatch(installer, /install_task_host_service \|\| echo/)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-required-stage-'))
  try {
    fs.mkdirSync(path.join(dir, 'release/integrations/voice-agent/systemd'), { recursive: true })
    const staged = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      RELEASE_DIR="$2/release"
      TARGET_HOME="$2/home"
      TARGET_USER="$(id -un)"; TARGET_UID="$(id -u)"; TARGET_GID="$(id -g)"
      NODE_BIN=/opt/node/bin
      SUDO=""
      run_as_target_user() { "$@"; }
      systemctl() { :; }
      apt-get() { :; }
      usermod() { :; }
      stage_voice_agent_service
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.notEqual(staged.status, 0, 'staging without the candidate service unit must fail')
    assert.equal(fs.existsSync(path.join(dir, 'home/.config/systemd/user/open-deskos-voice-agent.service')), false,
      'a failed staging leaves no unit behind')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('voice preparation rejects unsupported Node before creating candidate files', () => {
  const result = spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    NODE_BIN=/selected RELEASE_DIR=/unused
    run_as_target_user() { printf 'v22.14.0\\n'; }
    prepare_voice_agent_release
  `, 'test', helperPath], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Node >=22\.19\.0/)
})

test('voice packaging installs frozen production dependencies in release only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-voice-deploy-'))
  try {
    fs.mkdirSync(path.join(dir, 'source'))
    fs.mkdirSync(path.join(dir, 'release'))
    fs.writeFileSync(path.join(dir, 'source', 'package.json'), '{}')
    fs.writeFileSync(path.join(dir, 'source', 'pnpm-lock.yaml'), '')
    fs.mkdirSync(path.join(dir, 'source', 'src'))
    fs.mkdirSync(path.join(dir, 'source', 'systemd'))
    fs.writeFileSync(path.join(dir, 'source', 'auth.json'), 'private')
    const packaged = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      VOICE_AGENT_SOURCE="$2/source"
      RELEASE_DIR="$2/release"
      NODE_BIN="${path.dirname(process.execPath)}"
      LOG="$2/log"
      run_as_target_user() { if [ "$1" = pnpm ]; then printf '%s\\n' "$PWD:$*" >> "$LOG"; else "$@"; fi; }
      prepare_voice_agent_release
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(packaged.status, 0, packaged.stderr)
    assert.ok(fs.existsSync(path.join(dir, 'release/integrations/voice-agent/package.json')))
    assert.equal(fs.existsSync(path.join(dir, 'release/integrations/voice-agent/auth.json')), false)
    assert.equal(fs.readFileSync(path.join(dir, 'log'), 'utf8').trim(), `${dir}/release/integrations/voice-agent:pnpm install --prod --frozen-lockfile --ignore-scripts`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('required units are staged from the candidate on the stable runtime path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-required-units-'))
  try {
    const home = path.join(dir, 'home')
    const releaseRoot = path.join(dir, 'runtime/releases/20260101T000000Z-1')
    const candidate = path.join(releaseRoot, 'integrations/voice-agent')
    fs.mkdirSync(path.join(candidate, 'systemd'), { recursive: true })
    for (const unit of ['open-deskos-voice-agent.service', 'open-deskos-pi-tasks.service']) {
      fs.copyFileSync(path.join(integrationTree(), 'systemd', unit), path.join(candidate, 'systemd', unit))
    }
    // Desk Link is templated at the release root, not inside the voice integration.
    fs.mkdirSync(path.join(releaseRoot, 'systemd'), { recursive: true })
    fs.copyFileSync('systemd/open-deskos-desk-link.service', path.join(releaseRoot, 'systemd/open-deskos-desk-link.service'))
    fs.symlinkSync(releaseRoot, path.join(dir, 'runtime/current'))
    const staged = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      RUNTIME_ROOT="$2/runtime"
      RELEASE_DIR="$2/runtime/releases/20260101T000000Z-1"
      TARGET_HOME="$2/home"
      TARGET_USER="$(id -un)"; TARGET_UID="$(id -u)"; TARGET_GID="$(id -g)"
      NODE_BIN=/opt/node/bin
      SUDO=""
      LOG="$2/systemctl.log"
      run_as_target_user() { "$@"; }
      systemctl() { printf '%s\n' "$*" >> "$LOG"; }
      apt-get() { :; }
      usermod() { :; }
      stage_voice_agent_service
      stage_task_host_service
      stage_desk_link_service
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(staged.status, 0, staged.stderr)
    const units = path.join(home, '.config/systemd/user')
    const tasks = fs.readFileSync(path.join(units, 'open-deskos-pi-tasks.service'), 'utf8')
    const voice = fs.readFileSync(path.join(units, 'open-deskos-voice-agent.service'), 'utf8')
    const link = fs.readFileSync(path.join(units, 'open-deskos-desk-link.service'), 'utf8')
    for (const unit of [tasks, voice, link]) {
      assert.ok(unit.includes('__OPEN_DESKOS_') === false, unit)
      assert.doesNotMatch(unit, /releases\//, 'a staged unit must use the stable runtime path')
    }
    assert.ok(tasks.includes(`ExecStart=/opt/node/bin/node ${dir}/runtime/current/integrations/voice-agent/src/task-daemon.mjs`), tasks)
    assert.ok(tasks.includes(`WorkingDirectory=${dir}/runtime/current/integrations/voice-agent`), tasks)
    assert.ok(link.includes(`ExecStart=/usr/bin/env node ${dir}/runtime/current/scripts/desk-link-service.js`), link)
    const calls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(calls, /--user daemon-reload/)
    assert.match(calls, /--user enable open-deskos-voice-agent\.service/)
    assert.match(calls, /--user enable open-deskos-desk-link\.service/)
    assert.doesNotMatch(calls, /restart|pi-tasks/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('required services start after activation and wait for the task configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-required-start-'))
  try {
    const home = path.join(dir, 'home')
    const run = () => spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      TARGET_HOME="$2/home"
      TARGET_USER="$(id -un)"
      LOG="$2/systemctl.log"
      run_as_target_user() { "$@"; }
      systemctl() { printf '%s\n' "$*" >> "$LOG"; }
      start_required_services
    `, 'test', helperPath, dir], { encoding: 'utf8' })

    const unconfigured = run()
    assert.equal(unconfigured.status, 0, unconfigured.stderr)
    const unconfiguredCalls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(unconfiguredCalls, /--user start open-deskos-voice-agent\.service/)
    assert.doesNotMatch(unconfiguredCalls, /enable|pi-tasks/)
    assert.match(unconfigured.stderr, /staged but not enabled/)

    fs.mkdirSync(path.join(home, '.config/open-deskos'), { recursive: true })
    fs.writeFileSync(path.join(home, '.config/open-deskos/pi-tasks.json'), '{}\n', { mode: 0o600 })
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const configured = run()
    assert.equal(configured.status, 0, configured.stderr)
    const configuredCalls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(configuredCalls, /--user enable --now open-deskos-pi-tasks\.service/)
    assert.doesNotMatch(configured.stderr, /staged but not enabled/)

    // Desk Link listens on the LAN, so a staged unit without its own token must stay stopped and say
    // which configuration it waits for; with the token it starts under the same command.
    const linkUnit = path.join(home, '.config/systemd/user/open-deskos-desk-link.service')
    fs.mkdirSync(path.dirname(linkUnit), { recursive: true })
    fs.writeFileSync(linkUnit, '[Service]\nExecStart=/usr/bin/env node /runtime/current/scripts/desk-link-service.js\n')
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const tokenless = run()
    assert.equal(tokenless.status, 0, tokenless.stderr)
    assert.match(tokenless.stderr, /ODK_DESK_LINK_TOKEN/)
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8'), /desk-link/)
    fs.writeFileSync(path.join(home, '.config/open-deskos/runtime.env'), 'ODK_DESK_LINK_TOKEN=private\n', { mode: 0o600 })
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const tokened = run()
    assert.equal(tokened.status, 0, tokened.stderr)
    assert.match(fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8'), /--user enable --now open-deskos-desk-link\.service/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('project installs use the pnpm each project declares', () => {
  assert.match(installer, /COREPACK_ENABLE_PROJECT_SPEC=1/)
  const voice = JSON.parse(fs.readFileSync(path.join(integrationTree(), 'package.json'), 'utf8'))
  assert.equal(voice.devEngines.packageManager.name, 'pnpm')
  assert.equal(voice.packageManager, `pnpm@${voice.devEngines.packageManager.version}`)
})

test('run_as_target_user forwards its command through the kiosk environment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-run-as-'))
  try {
    const body = installer.match(/^run_as_target_user\(\) \{[\s\S]*?\n\}/m)?.[0]
    assert.ok(body, 'run_as_target_user is defined')
    const file = path.join(dir, 'run-as.sh')
    fs.writeFileSync(file, `${body}\n`)
    const forwarded = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      TARGET_UID=99999 TARGET_USER=orangepi TARGET_HOME=/home/orangepi
      KIOSK_BIN=/kiosk NODE_BIN=/opt/node
      runuser() { printf '%s\\n' "$@"; }
      run_as_target_user echo HELLO
    `, 'test', file], { encoding: 'utf8' })
    assert.equal(forwarded.status, 0, forwarded.stderr)
    assert.match(forwarded.stdout, /COREPACK_ENABLE_PROJECT_SPEC=1\n/)
    assert.match(forwarded.stdout, /\necho\nHELLO\n$/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
