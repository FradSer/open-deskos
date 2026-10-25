const { notPortedOnWindows } = require("./not-ported")
// A Windows Shell Host does not port this capability; the reference host runs it.
if (notPortedOnWindows(require("node:test").test, "unix-socket")) return

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const installer = fs.readFileSync('scripts/cm5-install.sh', 'utf8')
const stage = fs.readFileSync('scripts/cm5-stage-release.sh', 'utf8')
const helperPath = path.resolve('scripts/cm5-personal-agent.sh')

// A development checkout keeps integrations beside runtime/shell; a release flattens runtime/shell
// and seals integrations at its own root, while the runtime root may hold an unrelated integrations
// tree. Resolve the one that actually carries the integration under test instead of assuming depth.
function integrationTree() {
  for (const base of ['integrations', '../../integrations']) {
    const candidate = path.join(base, 'personal-agent')
    if (fs.existsSync(path.join(candidate, 'package.json')) &&
      fs.existsSync(path.join(candidate, 'systemd/odk-pi-tasks.service'))) return candidate
  }
  throw new Error(`personal-agent integration tree not found from ${process.cwd()}`)
}

test('integration staging excludes host dependencies and private auth/config', () => {
  const integrations = stage.split('\n').filter((line, index, lines) =>
    line.includes('"${ROOT}/integrations/"') || lines[index + 1]?.includes('"${ROOT}/integrations/"')).join('\n')
  assert.ok(integrations.includes("--exclude 'node_modules'"))
  assert.ok(integrations.includes('${RELEASE_PRIVATE_EXCLUDES[@]}'))
  assert.match(stage, /source "\$\{ROOT\}\/runtime\/shell\/scripts\/cm5-personal-agent.sh"/)
  const helper = fs.readFileSync(helperPath, 'utf8')
  for (const excluded of ['.env*', 'auth.json', '.pi', '*.env']) {
    assert.ok(helper.includes(`--exclude '${excluded}'`), excluded)
  }
})

test('required components are staged before activation and started after it', () => {
  assert.match(installer, /source "\$\{DIR\}\/scripts\/cm5-personal-agent.sh"/)
  const preparation = installer.indexOf('prepare_personal_agent_release')
  const activation = installer.indexOf('scripts/update-runtime.js')
  const shellUnit = installer.indexOf('KIOSK_UNIT_DIR=')
  assert.ok(preparation < activation, 'the candidate carries the integration before activation')
  assert.ok(shellUnit < installer.indexOf('stage_personal_agent_service'), 'the shell unit is written before the required components')
  assert.ok(installer.indexOf('stage_personal_agent_service') < activation)
  assert.ok(installer.indexOf('stage_task_host_service') < activation)
  assert.match(installer, /enable_user_unit odk-remote-bridge\.service --now/)
  assert.ok(installer.indexOf('start_required_services') > activation, 'required services start after activation')
  assert.doesNotMatch(installer, /(?:Requires|Wants)=odk-personal-agent/)
})

test('a required component that cannot be staged fails the installation naming its configuration', () => {
  assert.match(installer, /stage_personal_agent_service \|\| \{/)
  assert.match(installer, /Required Personal Agent component could not be installed.*perosnal-agent\.env/s)
  assert.match(installer, /stage_task_host_service \|\| \{/)
  assert.match(installer, /Required Hosted Pi control component could not be installed.*pi-tasks\.json/s)
  assert.match(installer, /stage_odk_link_service \|\| \{/)
  assert.match(installer, /Open DeskOS Link unit could not be staged/)
  assert.match(installer, /start_required_services \|\| \{/)
  assert.doesNotMatch(installer, /install_personal_agent_service \|\| echo/)
  assert.doesNotMatch(installer, /install_task_host_service \|\| echo/)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-required-stage-'))
  try {
    fs.mkdirSync(path.join(dir, 'release/integrations/personal-agent/systemd'), { recursive: true })
    const staged = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      RELEASE_DIR="$2/release"
      TARGET_HOME="$2/home"
      TARGET_USER="$(id -un)"; TARGET_UID="$(id -u)"; TARGET_GID="$(id -g)"
      NODE_BIN=/opt/node/bin
      SUDO=""
      run_as_target_user() { "$@"; }
      systemctl() { case "$*" in *is-active*|*is-enabled*) return 3 ;; esac; }
      apt-get() { :; }
      usermod() { :; }
      stage_personal_agent_service
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.notEqual(staged.status, 0, 'staging without the candidate service unit must fail')
    assert.equal(fs.existsSync(path.join(dir, 'home/.config/systemd/user/odk-personal-agent.service')), false,
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
    prepare_personal_agent_release
  `, 'test', helperPath], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Node >=22\.19\.0/)
})

test('voice packaging installs frozen production dependencies in release only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-personal-agent-deploy-'))
  try {
    fs.mkdirSync(path.join(dir, 'source'))
    fs.mkdirSync(path.join(dir, 'release'))
    fs.writeFileSync(path.join(dir, 'source', 'package.json'), '{}')
    fs.writeFileSync(path.join(dir, 'source', 'pnpm-lock.yaml'), '')
    fs.mkdirSync(path.join(dir, 'source', 'src'))
    fs.mkdirSync(path.join(dir, 'source', 'systemd'))
    fs.writeFileSync(path.join(dir, 'source', 'auth.json'), 'private')
    fs.writeFileSync(path.join(dir, 'source', 'src', 'private.env'), 'FIXTURE_ONLY_PRIVATE')
    const packaged = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      PERSONAL_AGENT_SOURCE="$2/source"
      RELEASE_DIR="$2/release"
      NODE_BIN="${path.dirname(process.execPath)}"
      LOG="$2/log"
      run_as_target_user() { if [ "$1" = pnpm ]; then printf '%s\\n' "$PWD:$*" >> "$LOG"; else "$@"; fi; }
      prepare_personal_agent_release
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(packaged.status, 0, packaged.stderr)
    assert.ok(fs.existsSync(path.join(dir, 'release/integrations/personal-agent/package.json')))
    assert.equal(fs.existsSync(path.join(dir, 'release/integrations/personal-agent/auth.json')), false)
    assert.equal(fs.existsSync(path.join(dir, 'release/integrations/personal-agent/src/private.env')), false)
    assert.equal(fs.readFileSync(path.join(dir, 'log'), 'utf8').trim(), `${dir}/release/integrations/personal-agent:pnpm install --prod --frozen-lockfile --ignore-scripts`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('required units are staged from the candidate on the stable runtime path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-required-units-'))
  try {
    const home = path.join(dir, 'home')
    const releaseRoot = path.join(dir, 'runtime/releases/20260101T000000Z-1')
    const candidate = path.join(releaseRoot, 'integrations/personal-agent')
    fs.mkdirSync(path.join(candidate, 'systemd'), { recursive: true })
    const unitDir = path.join(home, '.config/systemd/user')
    fs.mkdirSync(unitDir, { recursive: true })
    const legacyHelper = path.join(home, '.local/bin/odesk-pi-task-control')
    fs.mkdirSync(path.dirname(legacyHelper), { recursive: true })
    fs.writeFileSync(legacyHelper, 'preserve the existing operator helper\n')
    const targetConfig = path.join(home, '.config/open-deskos/task-targets.json')
    const targetConfigBytes = JSON.stringify({ targets: [{ id: 'cm5', executable: legacyHelper, roots: ['/fixture'] }] }) + '\n'
    fs.mkdirSync(path.dirname(targetConfig), { recursive: true })
    fs.writeFileSync(targetConfig, targetConfigBytes)
    fs.writeFileSync(path.join(unitDir, 'open-deskos-personal-agent.service'), '[Service]\nExecStart=/legacy/release/main.mjs\n')
    fs.symlinkSync('open-deskos-personal-agent.service', path.join(unitDir, 'odk-personal-agent.service'))
    fs.writeFileSync(path.join(unitDir, 'open-deskos-desk-link.service'), '[Service]\nExecStart=/legacy/release/link.mjs\n')
    fs.symlinkSync('open-deskos-desk-link.service', path.join(unitDir, 'odk-link.service'))
    for (const unit of ['odk-personal-agent.service', 'odk-pi-tasks.service', 'pi-task-control.sh']) {
      fs.copyFileSync(path.join(integrationTree(), 'systemd', unit), path.join(candidate, 'systemd', unit))
    }
    // Open DeskOS Link is templated at the release root, not inside the voice integration.
    fs.mkdirSync(path.join(releaseRoot, 'systemd'), { recursive: true })
    fs.copyFileSync('systemd/odk-link.service', path.join(releaseRoot, 'systemd/odk-link.service'))
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
      systemctl() {
        printf '%s\n' "$*" >> "$LOG"
        case "$*" in
          *is-active*|*is-enabled*) return 3 ;;
          "--user show --property=Id --value odk-personal-agent.service") printf 'open-deskos-personal-agent.service\n' ;;
          "--user show --property=Id --value odk-link.service") printf 'open-deskos-desk-link.service\n' ;;
          "--user show --property=Id --value odk-remote-bridge.service") printf 'open-deskos-remote-bridge.service\n' ;;
          "--user show --property=Id --value odk-pi-tasks.service") printf 'open-deskos-pi-tasks.service\n' ;;
        esac
      }
      apt-get() { :; }
      usermod() { :; }
      stage_personal_agent_service
      stage_task_host_service
      stage_odk_link_service
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(staged.status, 0, staged.stderr)
    const helper=path.join(home,'.local/bin/odk-pi-task-control')
    const helperText=fs.readFileSync(helper,'utf8')
    assert.ok(helperText.includes(`${dir}/runtime/current/integrations/personal-agent/src/task-cli.mjs`))
    assert.ok(helperText.includes(`${home}/.config/odk/pi-tasks.json`))
    assert.doesNotMatch(helperText,/__ODK_|open-deskos\/current|releases\//)
    assert.equal(fs.statSync(helper).mode&0o777,0o700)
    assert.equal(fs.readFileSync(legacyHelper, 'utf8'), 'preserve the existing operator helper\n')
    assert.equal(fs.readFileSync(targetConfig, 'utf8'), targetConfigBytes)
    const units = path.join(home, '.config/systemd/user')
    const tasks = fs.readFileSync(path.join(units, 'odk-pi-tasks.service'), 'utf8')
    const voice = fs.readFileSync(path.join(units, 'odk-personal-agent.service'), 'utf8')
    const canonicalVoice = fs.readFileSync(path.join(units, 'open-deskos-personal-agent.service'), 'utf8')
    const link = fs.readFileSync(path.join(units, 'odk-link.service'), 'utf8')
    const canonicalLink = fs.readFileSync(path.join(units, 'open-deskos-desk-link.service'), 'utf8')
    for (const unit of [tasks, voice, link]) {
      assert.ok(unit.includes('__ODK_') === false, unit)
      assert.doesNotMatch(unit, /releases\//, 'a staged unit must use the stable runtime path')
    }
    assert.ok(tasks.includes(`ExecStart=/opt/node/bin/node ${dir}/runtime/current/integrations/personal-agent/src/task-daemon.mjs`), tasks)
    assert.ok(tasks.includes(`WorkingDirectory=${dir}/runtime/current/integrations/personal-agent`), tasks)
    assert.ok(canonicalVoice.includes(`ExecStart=/opt/node/bin/node ${dir}/runtime/current/integrations/personal-agent/src/main.mjs`), canonicalVoice)
    assert.equal(fs.lstatSync(path.join(units, 'odk-personal-agent.service')).isSymbolicLink(), true)
    assert.equal(fs.lstatSync(path.join(units, 'odk-link.service')).isSymbolicLink(), true)
    assert.ok(link.includes(`ExecStart=/usr/bin/env node ${dir}/runtime/current/scripts/odk-link-service.js`), link)
    assert.ok(canonicalLink.includes(`ExecStart=/usr/bin/env node ${dir}/runtime/current/scripts/odk-link-service.js`), canonicalLink)
    const calls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(calls, /--user daemon-reload/)
    assert.match(calls, /--user show --property=Id --value odk-personal-agent\.service/)
    assert.match(calls, /--user show --property=Id --value odk-link\.service/)
    assert.match(calls, /--user enable open-deskos-personal-agent\.service/)
    assert.match(calls, /--user enable open-deskos-desk-link\.service/)
    assert.doesNotMatch(calls, /restart/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('service enable resolves every supported legacy alias before enable and --now', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-unit-alias-'))
  try {
    const result = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      LOG="$2/systemctl.log"
      run_as_target_user() { "$@"; }
      systemctl() {
        printf '%s\\n' "$*" >> "$LOG"
        case "$*" in
          *is-active*|*is-enabled*) return 3 ;;
          "--user show --property=Id --value odk-personal-agent.service") printf 'open-deskos-personal-agent.service\\n' ;;
          "--user show --property=Id --value odk-link.service") printf 'open-deskos-desk-link.service\\n' ;;
          "--user show --property=Id --value odk-remote-bridge.service") printf 'open-deskos-remote-bridge.service\\n' ;;
          "--user show --property=Id --value odk-pi-tasks.service") printf 'open-deskos-pi-tasks.service\\n' ;;
        esac
      }
      enable_user_unit odk-personal-agent.service --now
      enable_user_unit odk-link.service --now
      enable_user_unit odk-remote-bridge.service --now
      enable_user_unit odk-pi-tasks.service --now
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const calls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(calls, /--user show --property=Id --value odk-remote-bridge\.service/)
    assert.match(calls, /--user show --property=Id --value odk-pi-tasks\.service/)
    assert.match(calls, /--user enable --now open-deskos-personal-agent\.service/)
    assert.match(calls, /--user enable --now open-deskos-desk-link\.service/)
    assert.match(calls, /--user enable --now open-deskos-remote-bridge\.service/)
    assert.match(calls, /--user enable --now open-deskos-pi-tasks\.service/)
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
      NODE_BIN="/fixture/node"
      RUNTIME_ROOT="/fixture/runtime"
      LOG="$2/systemctl.log"
      run_as_target_user() { if [[ "$1" == "$NODE_BIN/node" ]]; then printf '%s\n' "$*" >> "$LOG"; else "$@"; fi; }
      systemctl() {
        printf '%s\n' "$*" >> "$LOG"
        case "$*" in
          *is-active*|*is-enabled*) return 3 ;;
          "--user show --property=Id --value odk-link.service") printf 'open-deskos-desk-link.service\n' ;;
          "--user show --property=Id --value odk-pi-tasks.service") printf 'open-deskos-pi-tasks.service\n' ;;
        esac
      }
      start_required_services
    `, 'test', helperPath, dir], { encoding: 'utf8' })

    const unconfigured = run()
    assert.equal(unconfigured.status, 0, unconfigured.stderr)
    const unconfiguredCalls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(unconfiguredCalls, /migrate-personal-agent\.mjs/)
    assert.match(unconfiguredCalls, /--user start odk-personal-agent\.service/)
    assert.doesNotMatch(unconfiguredCalls, /enable|pi-tasks/)
    assert.match(unconfigured.stderr, /staged but not enabled/)

    fs.mkdirSync(path.join(home, '.config/odk'), { recursive: true })
    fs.writeFileSync(path.join(home, '.config/odk/pi-tasks.json'), '{}\n', { mode: 0o600 })
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const configured = run()
    assert.equal(configured.status, 0, configured.stderr)
    const configuredCalls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(configuredCalls, /--user show --property=Id --value odk-pi-tasks\.service/)
    assert.match(configuredCalls, /--user enable --now open-deskos-pi-tasks\.service/)
    assert.doesNotMatch(configured.stderr, /staged but not enabled/)

    // Open DeskOS Link listens on the LAN, so a staged unit without its own token must stay stopped and say
    // which configuration it waits for; with the token it starts under the same command.
    const linkUnit = path.join(home, '.config/systemd/user/odk-link.service')
    fs.mkdirSync(path.dirname(linkUnit), { recursive: true })
    fs.writeFileSync(linkUnit, '[Service]\nExecStart=/usr/bin/env node /runtime/current/scripts/odk-link-service.js\n')
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const tokenless = run()
    assert.equal(tokenless.status, 0, tokenless.stderr)
    assert.match(tokenless.stderr, /ODK_LINK_TOKEN/)
    assert.match(tokenless.stderr, /staged but not started/)
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8'), /odk-link/)
    fs.writeFileSync(path.join(home, '.config/odk/runtime.env'), 'ODK_LINK_TOKEN=private\n', { mode: 0o600 })
    fs.writeFileSync(path.join(dir, 'systemctl.log'), '')
    const tokened = run()
    assert.equal(tokened.status, 0, tokened.stderr)
    const tokenedCalls = fs.readFileSync(path.join(dir, 'systemctl.log'), 'utf8')
    assert.match(tokenedCalls, /--user enable --now open-deskos-desk-link\.service/)
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

test('Personal Agent upgrade reads existing configuration and retires old services', () => {
  const unit = fs.readFileSync(path.join(integrationTree(), 'systemd/odk-personal-agent.service'), 'utf8')
  assert.match(unit, /EnvironmentFile=-%h\/\.config\/odk\/voice-agent\.env/)
  assert.match(fs.readFileSync('scripts/windows-personal-agent.ps1', 'utf8'), /'voice-agent\.env'.*'perosnal-agent\.env'/)
  assert.match(fs.readFileSync('scripts/cm5-personal-agent.sh', 'utf8'), /disable --now odk-voice-agent\.service/)
  const windows = fs.readFileSync('scripts/provision-personal-agent.ps1', 'utf8')
  assert.match(windows, /Disable-ScheduledTask -TaskName OdkVoice/)
  assert.match(windows, /Disable-ScheduledTask -TaskName OdkPersonalBot/)
  assert.match(fs.readFileSync('scripts/cm5-personal-agent.sh','utf8'), /odk-personal-bot\.service open-deskos-personal-bot\.service/)
  assert.match(fs.readFileSync('scripts/cm5-personal-agent.sh','utf8'), /disable --now "\$legacy"/)
  assert.doesNotMatch(windows, /migrate-personal-agent\.mjs/)
  assert.match(windows, /src\\display-client\.mjs/)
  assert.match(fs.readFileSync('scripts/cm5-personal-agent.sh', 'utf8'), /migrate-personal-agent\.mjs/)
})


test('rename staging refuses active or enabled previous units before any writes', () => {
  for (const state of ['active', 'enabled']) {
    const result = spawnSync('bash', ['-c', `
      source "$1"
      RELEASE_DIR=/unused RUNTIME_ROOT=/unused TARGET_HOME=/unused
      SUDO=unexpected_write
      unexpected_write() { echo WRITE >&2; return 99; }
      run_as_target_user() {
        if [ "$1" = systemctl ]; then
          case "$3:$4" in
            is-active:--quiet) [ "$STATE" = active ]; return ;;
            is-enabled:--quiet) [ "$STATE" = enabled ]; return ;;
          esac
        fi
        echo WRITE >&2; return 99
      }
      stage_personal_agent_service
    `, 'test', helperPath], { encoding: 'utf8', env: { ...process.env, STATE: state } })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Stop and disable the previous Personal Agent unit/)
    assert.doesNotMatch(result.stderr, /WRITE/)
  }
})

test('CM5 staging rejects copied retired environment keys before package and unit writes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odk-env-migration-'))
 try {
  fs.mkdirSync(path.join(dir,'.config/odk'),{recursive:true})
  fs.writeFileSync(path.join(dir,'.config/odk/perosnal-agent.env'),'ODK_PERSONAL_BOT_CONFIG=PRIVATE_PATH\n')
  const result=spawnSync('bash',['-c',`
   source "$1"
   TARGET_HOME="$2" RELEASE_DIR=/unused RUNTIME_ROOT=/unused SUDO=unexpected
   run_as_target_user() { case "$*" in *is-active*|*is-enabled*) return 3 ;; esac; echo WRITE >&2; return 99; }
   unexpected() { echo WRITE >&2; return 99; }
   stage_personal_agent_service
  `,'test',helperPath,dir],{encoding:'utf8'})
  assert.equal(result.status,1);assert.match(result.stderr,/Migrate retired Personal Agent settings/)
  assert.doesNotMatch(result.stderr,/WRITE|PRIVATE_PATH/)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})


test('direct release copying excludes private inputs and preserves their source bytes and modes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-private-release-copy-'))
  const source = path.join(root, 'source')
  const release = path.join(root, 'release')
  const privatePaths = ['.env.local', 'auth.json', '.pi/session.json', 'src/private.env', 'src/.env.debug']
  try {
    fs.mkdirSync(source)
    fs.mkdirSync(release)
    for (const name of privatePaths) {
      const file = path.join(source, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'FIXTURE_ONLY_PRIVATE', { mode: 0o600 })
    }
    fs.writeFileSync(path.join(source, 'src', 'public.js'), 'module.exports = true\n', { mode: 0o600 })
    const copy = installer.split('\n').find(line => line.includes('"${DIR}/."') && /cp -a|copy_release_input/.test(line))
    assert.ok(copy, 'execute the actual installer copy operation')
    assert.ok(!copy.includes('\n'), 'only one audited copy command may execute')
    assert.match(copy.trim(), /^(run_as_target_user cp -a|copy_release_input) /)
    const result = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      run_as_target_user() { "$@"; }
      DIR="$2" RELEASE_DIR="$3"
      ${copy}
    `, 'fixture', helperPath, source, release], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    for (const name of privatePaths) {
      assert.equal(fs.existsSync(path.join(release, name)), false, `${name} must stay outside the artifact`)
      assert.equal(fs.readFileSync(path.join(source, name), 'utf8'), 'FIXTURE_ONLY_PRIVATE')
      assert.equal(fs.statSync(path.join(source, name)).mode & 0o777, 0o600)
    }
    assert.equal(fs.readFileSync(path.join(release, 'src', 'public.js'), 'utf8'), 'module.exports = true\n')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
