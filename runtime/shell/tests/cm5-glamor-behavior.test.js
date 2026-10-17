const test = require('node:test')
const { notPortedOnWindows } = require('./not-ported')
if (notPortedOnWindows(test, 'cm5-tooling')) return

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const helper = path.resolve(__dirname, '..', 'scripts', 'cm5-glamor-bgra.sh')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-glamor-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const config = path.join(root, '20-modesetting.conf')
  const original = 'Section "Device"\n    Identifier "Rockchip Graphics"\n    Driver "modesetting"\n    Option "AccelMethod" "none"\n    Option "ShadowFB" "true"\n    Option "DRI" "2"\nEndSection\n'
  fs.writeFileSync(config, original)
  const vars = `SUDO=''; GLAMOR_STATE_DIR='${root}/state'; GLAMOR_MODULE_DIR='${root}/modules'; GLAMOR_CONFIG='${root}/10-odk-glamor-bgra.conf'; MODESETTING_CONFIG='${config}'; GLAMOR_PROC_DIR='${root}/proc'`
  return { root, config, original, vars }
}

function run(f, command) {
  return spawnSync('bash', ['-c', `set -euo pipefail; source '${helper}'; id() { printf '0\\n'; }; ${f.vars}; ${command}`], { encoding: 'utf8' })
}

test('glamor configuration preserves the first backup across repeated installation and removal', t => {
  const f = fixture(t)
  const result = run(f, 'install_glamor_config; install_glamor_config; remove_glamor')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(f.config, 'utf8'), f.original)
  assert.equal(fs.existsSync(path.join(f.root, '10-odk-glamor-bgra.conf')), false)
})

test('glamor configuration enables acceleration and selects only the local module before stock modules', t => {
  const f = fixture(t)
  const result = run(f, 'install_glamor_config')
  assert.equal(result.status, 0, result.stderr)
  const device = fs.readFileSync(f.config, 'utf8')
  assert.match(device, /"AccelMethod" "glamor"/)
  assert.doesNotMatch(device, /"ShadowFB"/)
  assert.match(device, /"DRI" "2"/)
  const modules = fs.readFileSync(path.join(f.root, '10-odk-glamor-bgra.conf'), 'utf8')
  assert.ok(modules.indexOf(`${f.root}/modules`) < modules.indexOf('/usr/lib/xorg/modules'))
})

test('removal preserves a modesetting file changed after installation', t => {
  const f = fixture(t)
  const result = run(f, `install_glamor_config; printf '\n# operator change\n' >> '${f.config}'; remove_glamor`)
  assert.equal(result.status, 0, result.stderr)
  assert.match(fs.readFileSync(f.config, 'utf8'), /# operator change/)
})

test('a new installation after removal backs up the current configuration', t => {
  const f = fixture(t)
  const result = run(f, `install_glamor_config; remove_glamor; printf '\n# next installation\n' >> '${f.config}'; install_glamor_config; remove_glamor`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(f.config, 'utf8'), `${f.original}\n# next installation\n`)
})

test('reinstallation does not overwrite operator changes', t => {
  const f = fixture(t)
  const result = run(f, `install_glamor_config; printf '\n# operator change\n' >> '${f.config}'; install_glamor_config`)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Preserved changed Xorg configuration/)
  assert.match(fs.readFileSync(f.config, 'utf8'), /# operator change/)
})

test('an unsupported Xorg package is rejected before configuration changes', t => {
  const f = fixture(t)
  const result = run(f, "xorg_source_version() { printf '%s\\n' '2:21.1.7-3+deb12u99'; }; install_glamor")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Xorg version/)
  assert.equal(fs.readFileSync(f.config, 'utf8'), f.original)
})

test('verification rejects a replaced module until Xorg starts a new session', t => {
  const f = fixture(t)
  const setup = `mkdir -p "$GLAMOR_MODULE_DIR" "$GLAMOR_STATE_DIR"; printf module > "$GLAMOR_MODULE_DIR/libglamoregl.so"; glamor_manifest > "$GLAMOR_STATE_DIR/manifest"; install_glamor_config; xorg_source_version() { echo "$XORG_SOURCE_VERSION"; }; glamor_session_ids() { echo 'boot 123'; }; echo 'boot 123' > "$GLAMOR_STATE_DIR/previous-xorg-sessions"; GLAMOR_XORG_LOG='${f.root}/Xorg.log'; echo "Loading $GLAMOR_MODULE_DIR/libglamoregl.so" > "$GLAMOR_XORG_LOG";`
  const stale = run(f, `${setup} verify_glamor`)
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /restart the graphical session/)
  const fresh = run(f, `${setup} glamor_session_ids() { echo 'boot 456'; }; mkdir -p "$GLAMOR_PROC_DIR/456"; printf '1000-2000 r-xp 0 00:00 1 %s\\n' "$GLAMOR_MODULE_DIR/libglamoregl.so" > "$GLAMOR_PROC_DIR/456/maps"; verify_glamor`)
  assert.equal(fresh.status, 0, fresh.stderr)
})

test('a module changed after installation is rejected by its manifest', t => {
  const f = fixture(t)
  const result = run(f, 'mkdir -p "$GLAMOR_MODULE_DIR" "$GLAMOR_STATE_DIR"; printf module > "$GLAMOR_MODULE_DIR/libglamoregl.so"; glamor_manifest > "$GLAMOR_STATE_DIR/manifest"; glamor_module_current; printf changed >> "$GLAMOR_MODULE_DIR/libglamoregl.so"; glamor_module_current')
  assert.notEqual(result.status, 0)
})

test('a historical module load cannot prove a running Xorg session', t => {
  const f = fixture(t)
  const result = run(f, `mkdir -p "$GLAMOR_MODULE_DIR" "$GLAMOR_STATE_DIR"; printf module > "$GLAMOR_MODULE_DIR/libglamoregl.so"; glamor_manifest > "$GLAMOR_STATE_DIR/manifest"; install_glamor_config; xorg_source_version() { echo "$XORG_SOURCE_VERSION"; }; glamor_session_ids() { :; }; echo 'old-boot 123' > "$GLAMOR_STATE_DIR/previous-xorg-sessions"; GLAMOR_XORG_LOG='${f.root}/Xorg.log'; echo "Loading $GLAMOR_MODULE_DIR/libglamoregl.so" > "$GLAMOR_XORG_LOG"; verify_glamor`)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /No running Xorg session/)
})

test('current Xorg mappings must identify the installed module instead of a historical log', t => {
  const f = fixture(t)
  const setup = `mkdir -p "$GLAMOR_MODULE_DIR" "$GLAMOR_STATE_DIR" "$GLAMOR_PROC_DIR/456"; printf module > "$GLAMOR_MODULE_DIR/libglamoregl.so"; glamor_manifest > "$GLAMOR_STATE_DIR/manifest"; install_glamor_config; xorg_source_version() { echo "$XORG_SOURCE_VERSION"; }; glamor_session_ids() { echo 'boot 456'; }; GLAMOR_XORG_LOG='${f.root}/Xorg.log'; echo "Loading $GLAMOR_MODULE_DIR/libglamoregl.so" > "$GLAMOR_XORG_LOG";`
  for (const mapped of ['/usr/lib/xorg/modules/libglamoregl.so', `${f.root}/modules/libglamoregl.so (deleted)`, `${f.root}/modules/libglamoregl.so-other`]) {
    const result = run(f, `${setup} printf '1000-2000 r-xp 0 00:00 1 %s\\n' '${mapped}' > "$GLAMOR_PROC_DIR/456/maps"; verify_glamor`)
    assert.notEqual(result.status, 0, mapped)
    assert.match(result.stderr, /does not map the installed BGRA module/)
  }
  const missing = run(f, `${setup} rm -f "$GLAMOR_PROC_DIR/456/maps"; verify_glamor`)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /does not map the installed BGRA module/)
  const mixed = run(f, `${setup} mkdir -p "$GLAMOR_PROC_DIR/789"; printf '1000-2000 r-xp 0 00:00 1 %s\\n' "$GLAMOR_MODULE_DIR/libglamoregl.so" > "$GLAMOR_PROC_DIR/456/maps"; printf '1000-2000 r-xp 0 00:00 1 /usr/lib/xorg/modules/libglamoregl.so\\n' > "$GLAMOR_PROC_DIR/789/maps"; glamor_session_ids() { printf 'boot 456\\nboot 789\\n'; }; verify_glamor`)
  assert.notEqual(mixed.status, 0)
  assert.match(mixed.stderr, /Xorg 789 does not map/)
})

test('a kiosk user verifies protected mappings through only the fixed host observer', t => {
  const f = fixture(t)
  const sudo = path.join(f.root, 'sudo')
  const timeout = path.join(f.root, 'timeout')
  const calls = path.join(f.root, 'calls')
  fs.writeFileSync(sudo, `#!/bin/sh\nprintf '%s\\n' "$@" > '${calls}'\n[ "$*" = '-n -- /usr/local/libexec/odk-xorg-bgra-verify' ] || { echo 'sudo: a password is required' >&2; exit 1; }\n[ ! -e '${f.root}/deny' ] || { echo 'sudo: a password is required' >&2; exit 1; }\nprintf '%s\\n' '{"version":1,"status":"verified","boot":"fixture","moduleSha256":"fixture","processes":[{"pid":456,"start":"1"}]}'\n`, { mode: 0o755 })
  fs.writeFileSync(timeout, '#!/bin/sh\n[ "$1" = 5s ] || exit 99\nshift\nexec "$@"\n', { mode: 0o755 })
  const copied = path.join(f.root, 'helper.sh')
  fs.writeFileSync(copied, fs.readFileSync(helper, 'utf8').replaceAll('/usr/bin/sudo', sudo).replaceAll('/usr/bin/timeout', timeout))
  const setup = `source '${copied}'; ${f.vars}; SUDO='${sudo}'; id() { echo 1000; }; GLAMOR_PATCH='${path.join(path.dirname(helper), 'patches/xorg-glamor-bgra.patch')}'; mkdir -p "$GLAMOR_MODULE_DIR" "$GLAMOR_STATE_DIR"; printf module > "$GLAMOR_MODULE_DIR/libglamoregl.so"; glamor_manifest > "$GLAMOR_STATE_DIR/manifest"; xorg_source_version() { echo "$XORG_SOURCE_VERSION"; }; glamor_session_ids() { echo 'boot 456'; }; GLAMOR_XORG_LOG='${f.root}/Xorg.log'; echo "Loading $GLAMOR_MODULE_DIR/libglamoregl.so" > "$GLAMOR_XORG_LOG";`
  // Configuration fixture commands remain unprivileged; only mapping observation uses the sudo port.
  const command = `${setup} SUDO=''; install_glamor_config; SUDO='${sudo}'; verify_glamor`
  const execute = (probe = ':') => spawnSync('bash', ['-c', `set -euo pipefail; ${command.replace(/verify_glamor$/, '')} ${probe}; verify_glamor`], { encoding: 'utf8' })
  const accepted = execute()
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['-n', '--', '/usr/local/libexec/odk-xorg-bgra-verify'])
  for (const probe of ['rm -f "$GLAMOR_XORG_LOG"', 'grep() { return 2; }']) {
    const unavailable = execute(probe)
    assert.notEqual(unavailable.status, 0)
    assert.match(unavailable.stderr, /log observation unavailable/i)
    assert.doesNotMatch(unavailable.stderr, /restart the graphical session/)
  }
  const noLoad = execute('printf "unrelated log\\n" > "$GLAMOR_XORG_LOG"')
  assert.notEqual(noLoad.status, 0)
  assert.match(noLoad.stderr, /log lacks the expected BGRA load message/); assert.doesNotMatch(noLoad.stderr, /restart the graphical session/)
  fs.writeFileSync(path.join(f.root, 'deny'), '')
  const denied = execute()
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /observation unavailable/i)
  assert.doesNotMatch(denied.stderr, /restart the graphical session/)
})

test('the channel patch changes both GLES formats without changing the desktop GL format', t => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.root, 'glamor'))
  const source = '\n    if (glamor_priv->is_gles) {\n        assert(X_BYTE_ORDER == X_LITTLE_ENDIAN);\n        glamor_add_format(screen, 24, PICT_x8b8g8r8,\n                          GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, TRUE);\n        glamor_add_format(screen, 32, PICT_a8b8g8r8,\n                          GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, TRUE);\n    } else {\n        glamor_add_format(screen, 24, PICT_x8r8g8b8,\n                          GL_RGBA, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV, TRUE);\n'
  fs.writeFileSync(path.join(f.root, 'glamor', 'glamor.c'), source)
  const result = spawnSync('patch', ['--fuzz=0', '-p1', '-i', path.resolve(__dirname, '..', 'scripts', 'patches', 'xorg-glamor-bgra.patch')], { cwd: f.root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const patched = fs.readFileSync(path.join(f.root, 'glamor', 'glamor.c'), 'utf8')
  assert.match(patched, /PICT_x8r8g8b8,\n\s+GL_BGRA, GL_BGRA/)
  assert.match(patched, /PICT_a8r8g8b8,\n\s+GL_BGRA, GL_BGRA/)
  assert.match(patched, /GL_RGBA, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV/)
})

test('the host observer rejects stale and forged evidence without caller path overrides', () => {
  const result = spawnSync('python3', ['-I', '-S', path.join(__dirname, 'helpers/cm5-xorg-bgra-observer.py'),
    path.join(__dirname, '../scripts/cm5-xorg-bgra-verify.py')], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).checks, ['fresh-mappings', 'environment-ignored', 'bounded-no-address-receipt',
    'deleted-map', 'wrong-inode', 'wrong-path', 'forged-name-rejected', 'unreadable-maps',
    'boot-change', 'pid-start-change', 'module-change', 'mapping-change', 'unsafe-host-path'])
})

test('the privileged entry has a fixed interpreter and permits no arguments', () => {
  const wrapper = path.join(__dirname, '../scripts/cm5-xorg-bgra-verify.sh')
  const source = fs.readFileSync(wrapper, 'utf8')
  assert.ok(source.includes('[ "$#" -eq 0 ] || exit 2'))
  assert.ok(source.includes('cd / || exit 2'))
  assert.ok(source.includes('exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I -S /usr/local/libexec/odk-xorg-bgra-verify.py'))
  assert.equal(spawnSync('/bin/sh', [wrapper, 'unexpected'], { encoding: 'utf8' }).status, 2)
  const library = fs.readFileSync(path.join(__dirname, '../scripts/cm5-glamor-bgra.sh'), 'utf8')
  const moduleDirectory = library.match(/^GLAMOR_MODULE_DIR="([^"]+)"$/m)[1]
  const observer = fs.readFileSync(path.join(__dirname, '../scripts/cm5-xorg-bgra-verify.py'), 'utf8')
  assert.ok(observer.includes(`MODULE = Path('${moduleDirectory}/libglamoregl.so')`), 'observer and installer module pins must agree')
  const installer = fs.readFileSync(path.join(__dirname, '../scripts/cm5-gpu-userspace.sh'), 'utf8')
  const installPort = installer.slice(installer.indexOf('install_mapping_observer() ('), installer.indexOf('\ninstall_all() {'))
  const rules = installPort.split('\n').filter(line => line.includes('NOPASSWD:'))
  assert.equal(rules.length, 1)
  assert.ok(rules[0].includes('orangepi ALL=(root) NOPASSWD: /usr/local/libexec/odk-xorg-bgra-verify ""'))
  assert.ok(installer.indexOf('visudo -cf') < installer.indexOf('0440 "$temporary"'))
})

test('the fixed entry clears caller environment and rejects unsafe tool paths', t => {
  const f = fixture(t)
  const library = path.join(f.root, 'libexec')
  fs.mkdirSync(library)
  const observer = path.join(library, 'odk-xorg-bgra-verify.py')
  fs.writeFileSync(observer, "import json,os,sys\nprint(json.dumps({'keys':sorted(os.environ),'cwd':os.getcwd(),'isolated':sys.flags.isolated,'noSite':sys.flags.no_site}))\n")
  const stat = path.join(f.root, 'stat')
  fs.writeFileSync(stat, `#!/bin/sh\ncase "$2" in '%u:%g') echo 0:0 ;; '%a') if [ -e '${f.root}/unsafe' ]; then echo 777; else echo 755; fi ;; *) exit 1 ;; esac\n`, { mode: 0o755 })
  const wrapper = path.join(library, 'odk-xorg-bgra-verify')
  // macOS /usr/bin/python3 is an Xcode launcher that adds SDK variables after env -i.
  const interpreter = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' })
  assert.equal(interpreter.status, 0, interpreter.stderr)
  const quotedInterpreter = `'${interpreter.stdout.trim().replaceAll("'", "'\\''")}'`
  fs.writeFileSync(wrapper, fs.readFileSync(path.join(__dirname, '../scripts/cm5-xorg-bgra-verify.sh'), 'utf8')
    .replaceAll('/usr/local/libexec', library).replaceAll('/usr/bin/stat', stat)
    .replace('/usr/bin/python3 -I', `${quotedInterpreter} -I`), { mode: 0o755 })
  const poison = path.join(f.root, 'poison')
  const marker = path.join(f.root, 'poison-executed')
  fs.writeFileSync(poison, `touch '${marker}'\n`)
  const env = { ...process.env, BASH_ENV: poison, PYTHONPATH: f.root, GLAMOR_PROC_DIR: f.root, GLAMOR_MODULE_DIR: f.root }
  const execute = () => spawnSync(wrapper, [], { env, encoding: 'utf8' })
  const safe = execute()
  assert.equal(safe.status, 0, safe.stderr)
  const report = JSON.parse(safe.stdout)
  assert.deepEqual({ cwd: report.cwd, isolated: report.isolated, noSite: report.noSite }, { cwd: '/', isolated: 1, noSite: 1 })
  // Darwin initializes this CoreFoundation variable after exec; the Linux host allows no such addition.
  const platformKeys = process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : []
  assert.ok(report.keys.every(key => ['PATH', 'LC_CTYPE', ...platformKeys].includes(key)), safe.stdout)
  assert.equal(fs.existsSync(marker), false)
  fs.writeFileSync(path.join(f.root, 'unsafe'), '')
  assert.equal(execute().status, 2)
  fs.unlinkSync(path.join(f.root, 'unsafe'))
  fs.unlinkSync(observer)
  fs.symlinkSync(poison, observer)
  assert.equal(execute().status, 2)
})


test('removal revokes only its exact observer policy before deleting the host files', t => {
  const f = fixture(t), host = path.join(f.root, 'host')
  const tools = path.join(host, 'libexec'), policies = path.join(host, 'sudoers.d')
  fs.mkdirSync(tools, { recursive: true }); fs.mkdirSync(policies)
  const policy = path.join(policies, 'odk-xorg-bgra-verify')
  const wrapper = path.join(tools, 'odk-xorg-bgra-verify'), python = `${wrapper}.py`
  const rule = `orangepi ALL=(root) NOPASSWD: ${wrapper} ""\n`
  const unrelated = path.join(policies, 'other'); fs.writeFileSync(unrelated, 'unrelated policy\n')
  const installer = fs.readFileSync(path.join(__dirname, '../scripts/cm5-gpu-userspace.sh'), 'utf8')
  const functions = installer.slice(installer.indexOf('install_mapping_observer() ('), installer.indexOf('\nverify_all() {'))
    .replaceAll('/usr/local/libexec', tools).replaceAll('/etc/sudoers.d', policies)
    .replaceAll(`for parent in / /usr /usr/local ${tools} /etc ${policies}; do`, `for parent in '${host}' '${tools}' '${policies}'; do`)
  const reset = () => { fs.writeFileSync(policy, rule); fs.writeFileSync(wrapper, 'wrapper'); fs.writeFileSync(python, 'observer') }
  const execute = (override = '') => spawnSync('bash', ['-c', `set -euo pipefail; ${functions}
    SUDO=''; SONAMES=(unused); MESA_FILES=(unused); LIB_DIR='${f.root}'; MESA_DIVERSION_DIR='${f.root}/mesa'; MALI_BLOB_DIR='${f.root}/mali'; FIRMWARE_DIR='${f.root}'; MALI_FIRMWARE_FILE=firmware; MALI_FIRMWARE_SHA256=expected;
    check_arch() { :; }; require_tools() { :; }; remove_glamor() { :; }; sha256_of() { :; }; ldconfig() { :; };
    stat() { case "$2" in '%u:%g') echo 0:0 ;; '%a') echo 755 ;; *) return 1 ;; esac; };
    rm() { case "$*" in *'${wrapper}'*) [ ! -e '${policy}' ] || return 99 ;; esac; command rm "$@"; };
    ${override || ':'}; remove_all`], { encoding: 'utf8' })
  reset()
  const removed = execute(); assert.equal(removed.status, 0, removed.stderr)
  for (const file of [policy, wrapper, python]) assert.equal(fs.existsSync(file), false, file)
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'unrelated policy\n')
  assert.equal(fs.existsSync(tools), true); assert.equal(fs.existsSync(policies), true)
  assert.equal(execute().status, 0, 'repeated removal remains safe')
  reset(); fs.appendFileSync(policy, '# operator change\n')
  const changed = execute(); assert.notEqual(changed.status, 0); assert.doesNotMatch(changed.stdout, /== removed ==/)
  for (const file of [policy, wrapper, python]) assert.equal(fs.existsSync(file), true)
  reset()
  const failed = execute(`rm() { return 1; }`)
  assert.notEqual(failed.status, 0); assert.doesNotMatch(failed.stdout, /== removed ==/)
  for (const file of [policy, wrapper, python]) assert.equal(fs.existsSync(file), true)
})
