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
  return spawnSync('bash', ['-c', `set -euo pipefail; source '${helper}'; ${f.vars}; ${command}`], { encoding: 'utf8' })
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
