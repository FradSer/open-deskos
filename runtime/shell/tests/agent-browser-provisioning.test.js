const { notPortedOnWindows } = require('./not-ported')
// The browser infrastructure is provisioned by the CM5 deployment tooling.
if (notPortedOnWindows(require('node:test').test, 'cm5-tooling')) return

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { integrationPath } = require('./helpers/repo-root')

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'cm5-agent-browser.sh')
const script = fs.readFileSync(SCRIPT_PATH, 'utf8')
const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-install.sh'), 'utf8')
const feature = fs.readFileSync(integrationPath('personal-bot/features/browser.feature', __dirname), 'utf8')

// Run the script with a stubbed `uname` so the host guard is asserted by its
// result on any development host rather than by the absence of its text.
function runWithStubbedHost(architecture) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-browser-'))
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\nprintf '%s\\n' '${architecture}'\n`, { mode: 0o755 })
  try {
    return spawnSync('bash', [SCRIPT_PATH, 'install'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('the installer provisions the browser infrastructure without letting it fail the installation', () => {
  assert.match(installer, /scripts\/cm5-agent-browser\.sh" install/)
  // A missing browser degrades one Personal Bot capability. It must not make the
  // Shell uninstallable, so the step warns and continues.
  assert.match(installer, /if ! \$SUDO "\$\{DIR\}\/scripts\/cm5-agent-browser\.sh" install; then/)
  assert.match(installer, /warning: agent-browser was not provisioned/)
  assert.match(installer, /remedy: run 'sudo .*cm5-agent-browser\.sh install'/)
  assert.doesNotMatch(installer, /cm5-agent-browser\.sh" install \|\| \{[\s\S]{0,200}?exit 1/)
})

test('browser provisioning writes only to a host directory, never into a release', () => {
  assert.match(script, /^INSTALL_DIR="\/opt\/agent-browser"$/m)
  for (const forbidden of ['RUNTIME_ROOT', '/opt/odk', 'RELEASE_DIR', 'current/integrations']) {
    assert.ok(!script.includes(forbidden), `provisioning must not touch ${forbidden}`)
  }
})

test('the pinned CLI and browser versions are explicit', () => {
  assert.match(script, /AGENT_BROWSER_VERSION="\$\{ODK_AGENT_BROWSER_VERSION:-\d+\.\d+\.\d+\}"/)
  assert.match(script, /CHROME_VERSION="\$\{ODK_CHROME_VERSION:-\d+\.\d+\.\d+\.\d+\}"/)
  assert.match(script, /releases\/download\/v\$\{AGENT_BROWSER_VERSION\}\/agent-browser-linux-arm64/)
  assert.match(script, /chrome-for-testing-public\/\$\{CHROME_VERSION\}\/linux-arm64\/chrome-linux-arm64\.zip/)
})

test('a non-arm64 host is refused before anything is installed', () => {
  const result = runWithStubbedHost('x86_64')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /targets arm64 \(CM5\)/)
})

test('provisioning resolves the Chrome libraries and asserts the result', () => {
  // A fuzzy package search can name the wrong package, so the dependency set is
  // explicit and ldd is what proves it sufficient.
  assert.match(script, /^CHROME_PACKAGES="/m)
  for (const pkg of ['libnss3', 'libxcomposite1', 'libxdamage1', 'libxrandr2', 'libgbm1', 'libasound2']) {
    assert.ok(script.includes(pkg), `the reviewed package set names ${pkg}`)
  }
  assert.match(script, /apt-get install -y \$\{CHROME_PACKAGES\}/)
  assert.match(script, /ldd "\$\{CHROME_BIN\}"[\s\S]*?not found/)
  // Resolving a library name by package search can select the wrong package.
  assert.ok(!script.includes('apt-cache search'), 'the package set is not resolved by name search')
})

test('verification drives a page instead of checking that files exist', () => {
  assert.match(script, /odk-agent-browser-probe/)
  assert.match(script, /run_cli_as_target_user open "file:\/\//)
  assert.match(script, /snapshot -i/)
  assert.ok(script.includes('reference="$(sed -n'), 'the probe resolves an element reference from the snapshot')
  // The snapshot prints `ref=e2`; a command takes the same reference as `@e2`.
  assert.ok(script.includes("s/.*\\[ref=\\(e[0-9]*\\)\\].*/@\\1/p"),
    'the probe converts a printed reference into the command form')
  assert.match(script, /if \[ -z "\$\{reference\}" \]; then/)
  assert.match(script, /run_cli_as_target_user click "\$\{reference\}"/)
  assert.match(script, /PROBE_CLICKED/)
  assert.match(script, /the browser is not driving the page/)
  // The probe runs as the kiosk user, not as the installer's root identity,
  // under a deadline applied to the CLI process itself.
  assert.match(script, /runuser -u "\$\{TARGET_USER\}" -- env[\s\S]*?timeout "\$\{PROBE_TIMEOUT\}" "\$\{CLI_BIN\}"/)
  assert.ok(!script.includes('timeout "${PROBE_TIMEOUT}" run_as_target_user'),
    'timeout cannot run a shell function, so it must wrap the CLI executable')
})

test('the CLI is exposed on the host command path for the resident service', () => {
  assert.match(script, /ln -sfn "\$\{CLI_BIN\}" "\/usr\/local\/bin\/agent-browser"/)
  // Device configuration names a stable path, not a version the next run replaces.
  assert.match(script, /ln -sfn "\$\{CHROME_BIN\}" "\$\{INSTALL_DIR\}\/chrome"/)
  // The personal bot unit already carries /usr/local/bin on its PATH.
  assert.match(installer, /PATH=.*\/usr\/local\/bin/)
})

test('a repeated run reuses the pinned pair and prunes only the versions it owns', () => {
  assert.match(script, /if \[ -x "\$\{destination\}" \] && verify_sha256[\s\S]*?already installed/)
  assert.match(script, /\.odk-chrome-version/)
  assert.match(script, /prune_other_browsers/)
  assert.match(script, /for directory in "\$\{BROWSERS_DIR\}"\/chrome-\*; do/)
  assert.match(script, /\[ ! -d "\$\{directory\}" \] \|\| \[ "\$\{directory\}" = "\$\{CHROME_DIR\}" \]/)
  // A partial transfer must never be mistaken for an installed binary.
  assert.match(script, /mktemp "\$\{destination\}\.XXXXXX"/)
})

test('the deployment feature states the browser infrastructure contract', () => {
  for (const scenario of [
    'Browser infrastructure is provisioned outside the immutable release',
    'A failed browser provisioning does not fail the installation',
    'Provisioning proves the browser drives a page',
    'A repeated provisioning run downloads nothing',
  ]) {
    assert.ok(feature.includes(`Scenario: ${scenario}`), scenario)
  }
})

test('an installed host pair survives repeated runs from a read-only release without downloads', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-browser-installed-'))
  t.after(() => {
    fs.chmodSync(path.join(home, 'release'), 0o755)
    fs.rmSync(home, { recursive: true, force: true })
  })
  const bin = path.join(home, 'stubs')
  const host = path.join(home, 'host')
  const target = path.join(home, 'orangepi')
  const release = path.join(home, 'release')
  for (const directory of [bin, path.join(host, 'bin'), path.join(host, 'browsers/chrome-155.0.8059.79'), target, release]) fs.mkdirSync(directory, { recursive: true })
  const writeExecutable = (file, body) => fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  writeExecutable(path.join(bin, 'uname'), 'echo aarch64')
  writeExecutable(path.join(bin, 'id'), 'case "$*" in "-u") echo 0 ;; "-u orangepi"|"-g orangepi") echo 1000 ;; *) exit 0 ;; esac')
  writeExecutable(path.join(bin, 'getent'), `echo 'orangepi:x:1000:1000::${target}:/bin/sh'`)
  for (const name of ['apt-get', 'chown', 'ldd']) writeExecutable(path.join(bin, name), 'exit 0')
  writeExecutable(path.join(bin, 'curl'), 'echo unexpected-download >&2; exit 97')
  writeExecutable(path.join(bin, 'runuser'), 'shift 3; exec "$@"')
  const victim = path.join(home, 'protected-file')
  fs.writeFileSync(victim, 'protected contents')
  const hostileCache = path.join(target, '.cache/odk-agent-browser-probe')
  fs.mkdirSync(hostileCache, { recursive: true })
  fs.symlinkSync(victim, path.join(hostileCache, 'probe.html'))
  const cli = path.join(host, 'bin/agent-browser-0.39.1')
  writeExecutable(cli, `case "$1" in snapshot) echo 'button "Press" [ref=e2]' ;; get) echo PROBE_CLICKED ;; esac`)
  fs.symlinkSync(cli, path.join(host, 'bin/agent-browser'))
  const chrome = path.join(host, 'browsers/chrome-155.0.8059.79/chrome')
  writeExecutable(chrome, 'exit 0')
  fs.writeFileSync(path.join(path.dirname(chrome), '.odk-chrome-version'), '155.0.8059.79\n')
  const chromeDigest = 'a'.repeat(64)
  fs.writeFileSync(path.join(path.dirname(chrome), '.odk-chrome-sha256'), chromeDigest)
  const cliDigest = createHash('sha256').update(fs.readFileSync(cli)).digest('hex')
  const candidate = path.join(release, 'cm5-agent-browser.sh')
  fs.writeFileSync(candidate, script.replaceAll('/opt/agent-browser', host).replaceAll('/usr/local/bin/agent-browser', path.join(home, 'agent-browser')), { mode: 0o444 })
  fs.chmodSync(release, 0o555)
  for (let run = 0; run < 2; run++) {
    const result = spawnSync('bash', [candidate, 'install'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SUDO_USER: 'orangepi', ODK_AGENT_BROWSER_SHA256: cliDigest, ODK_CHROME_SHA256: chromeDigest } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /already installed/)
    assert.match(result.stdout, /verified: the CLI drove Chrome/)
    assert.doesNotMatch(result.stderr, /unexpected-download/)
  }
  assert.deepEqual(fs.readdirSync(release), ['cm5-agent-browser.sh'])
  assert.equal(fs.readFileSync(victim, 'utf8'), 'protected contents')
  assert.equal(fs.readlinkSync(path.join(hostileCache, 'probe.html')), victim, 'the installer never touches pre-existing user artifacts')
})

test('the root installer never writes or changes ownership through user-controlled probe paths', () => {
  assert.doesNotMatch(script, /PROBE_DIR="\$\{TARGET_HOME\}/)
  assert.match(script, /mktemp -d \"?\/tmp\/odk-agent-browser-probe\.XXXXXX/)
  assert.doesNotMatch(script, /chown .*probe_page/)
  assert.match(script, /chmod 0644 "\$\{probe_page\}"/)
  assert.match(script, /chmod 0755 "\$\{PROBE_DIR\}"/)
})


test('downloaded bytes must match the reviewed digest before they replace an executable or archive', t => {
  const start = script.indexOf('verify_sha256() {')
  const end = script.indexOf('\ninstall_cli() {', start)
  assert(start >= 0 && end > start, 'the installer must provide its checked-download path')
  const functions = script.slice(start, end)
  for (const matches of [false, true]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-browser-digest-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const bin = path.join(directory, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nprintf 'downloaded fixture' > "$2"\n`, { mode: 0o755 })
    const destination = path.join(directory, 'download')
    fs.writeFileSync(destination, 'existing installed bytes')
    const digest = matches ? createHash('sha256').update('downloaded fixture').digest('hex') : '0'.repeat(64)
    const result = spawnSync('bash', ['-c', `${functions}\ndownload_verified "$1" "$2" "$3" fixture`, 'digest-test', 'https://example.invalid/fixture', destination, digest], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    assert.equal(result.status, matches ? 0 : 1, result.stderr)
    assert.equal(fs.readFileSync(destination, 'utf8'), matches ? 'downloaded fixture' : 'existing installed bytes')
    if (!matches) assert.match(result.stderr, /checksum mismatch/)
    assert.deepEqual(fs.readdirSync(directory).sort(), ['bin', 'download'])
  }
  assert.match(script, /download_verified[\s\S]*?agent-browser-linux-arm64[\s\S]*?AGENT_BROWSER_SHA256/)
  assert.match(script, /download_verified[\s\S]*?chrome-linux-arm64\.zip[\s\S]*?CHROME_SHA256/)
  assert.doesNotMatch(script, /^run_as_target_user\(\)/m)
})
