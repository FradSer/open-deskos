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

test('voice is packaged before activation and independently started afterward', () => {
  assert.match(installer, /source "\$\{DIR\}\/scripts\/cm5-voice-agent.sh"/)
  assert.ok(installer.indexOf('prepare_voice_agent_release') < installer.indexOf('scripts/update-runtime.js'))
  assert.ok(installer.indexOf('install_voice_agent_service') > installer.indexOf('scripts/migrate-runtime.js'))
  assert.match(installer, /install_voice_agent_service \|\|/)
  assert.doesNotMatch(installer, /(?:Requires|Wants)=open-deskos-voice/)
})

test('voice activation failure returns control without stopping the base shell', () => {
  const result = spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    RUNTIME_ROOT=/not-used TARGET_HOME=/not-used SUDO=false
    install_voice_agent_service || printf 'voice-unavailable\\n'
    printf 'shell-continues\\n'
  `, 'test', helperPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'voice-unavailable\nshell-continues\n')
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

test('task host service is staged on the stable runtime path and waits for its configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-task-host-'))
  try {
    const home = path.join(dir, 'home')
    const releaseRoot = path.join(dir, 'runtime/releases/20260101T000000Z-1')
    const release = path.join(releaseRoot, 'integrations/voice-agent')
    fs.mkdirSync(path.join(release, 'systemd'), { recursive: true })
    fs.copyFileSync(path.join(integrationTree(), 'systemd/open-deskos-pi-tasks.service'),
      path.join(release, 'systemd/open-deskos-pi-tasks.service'))
    fs.symlinkSync(releaseRoot, path.join(dir, 'runtime/current'))
    const install = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      RUNTIME_ROOT="$2/runtime"
      TARGET_HOME="$2/home"
      TARGET_USER="$(id -un)"; TARGET_UID="$(id -u)"; TARGET_GID="$(id -g)"
      NODE_BIN=/opt/node/bin
      SUDO=""
      LOG="$2/systemctl.log"
      run_as_target_user() { "$@"; }
      systemctl() { printf '%s\\n' "$*" >> "$LOG"; }
      install_task_host_service
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(install.status, 0, install.stderr)
    const unit = fs.readFileSync(path.join(home, '.config/systemd/user/open-deskos-pi-tasks.service'), 'utf8')
    assert.ok(unit.includes(`ExecStart=/opt/node/bin/node ${dir}/runtime/current/integrations/voice-agent/src/task-daemon.mjs`), unit)
    assert.ok(unit.includes(`WorkingDirectory=${dir}/runtime/current/integrations/voice-agent`), unit)
    assert.doesNotMatch(unit, /releases\//)
    assert.ok(!unit.includes('__OPEN_DESKOS_'), unit)
    const calls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(calls, /--user daemon-reload/)
    assert.doesNotMatch(calls, /enable|restart/)
    assert.match(install.stderr, /staged but not enabled/)

    fs.mkdirSync(path.join(home, '.config/open-deskos'), { recursive: true })
    fs.writeFileSync(path.join(home, '.config/open-deskos/pi-tasks.json'), '{}\n', { mode: 0o600 })
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const configured = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      RUNTIME_ROOT="$2/runtime"
      TARGET_HOME="$2/home"
      TARGET_USER="$(id -un)"; TARGET_UID="$(id -u)"; TARGET_GID="$(id -g)"
      NODE_BIN=/opt/node/bin
      SUDO=""
      LOG="$2/systemctl.log"
      run_as_target_user() { "$@"; }
      systemctl() { printf '%s\\n' "$*" >> "$LOG"; }
      install_task_host_service
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(configured.status, 0, configured.stderr)
    const configuredCalls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(configuredCalls, /--user enable open-deskos-pi-tasks\.service/)
    assert.match(configuredCalls, /--user restart open-deskos-pi-tasks\.service/)
    assert.doesNotMatch(configured.stderr, /staged but not enabled/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the installer stages the task host after the voice agent without aborting the shell on failure', () => {
  assert.ok(installer.indexOf('install_task_host_service') > installer.indexOf('install_voice_agent_service'))
  assert.match(installer, /install_task_host_service \|\|/)
  assert.doesNotMatch(installer, /^\s*systemctl --user/m)
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
