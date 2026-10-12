const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveConfigPath, readConfig, resolveStartupDisabled, updateConfig } = require('../src/plugin-config')
const { main } = require('../scripts/open-deskos-plugin-cli')

test('a partial configuration write preserves the existing complete bytes', t => {
  const { file } = fixture(t)
  const { writeConfig } = require('../scripts/open-deskos-plugin-cli')
  const original = { version: 1, plugins: { 'odk.test.one': { enabled: false } } }
  fs.writeFileSync(file, JSON.stringify(original))
  const bytes = fs.readFileSync(file, 'utf8')
  const write = fs.writeFileSync
  fs.writeFileSync = (target, content, options) => {
    write(target, String(content).slice(0, 5), options)
    throw Error('fixture write failure')
  }
  try { assert.throws(() => writeConfig(file, { version: 1, plugins: {} }), /fixture write failure/) }
  finally { fs.writeFileSync = write }
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['plugins.json'])
})

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-plugin-config-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = { OPEN_DESKOS_CONFIG_DIR: dir }
  return { env, file: resolveConfigPath(env) }
}

test('native selection schema rejects malformed authorization, nested history and dual ownership', t => {
  const { file } = fixture(t)
  const native = { revision: 'a'.repeat(64), host: 'electron-main', replace: false, grants: ['fixture'], trustAcknowledgedAt: '2026-10-08T00:00:00.000Z' }
  for (const change of [{ revision: '../escape' }, { host: 'python-agent' }, { replace: 'yes' },
    { grants: ['fixture', 'fixture'] }, { grants: ['invalid permission'] }, { trustAcknowledgedAt: 'invalid' },
    { unknown: true }, { previous: { ...native, previous: native } }, { previous: null }]) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, plugins: { 'odk.test.native': { native: { ...native, ...change } } } }))
    assert.throws(() => readConfig(file), /native/)
  }
  const development = { path: path.dirname(file), grants: [], trustAcknowledgedAt: native.trustAcknowledgedAt }
  fs.writeFileSync(file, JSON.stringify({ version: 1, plugins: { 'odk.test.native': { native, development } } }))
  assert.throws(() => readConfig(file), /ownership/)
})

test('saved CLI disables and environment overrides reach the startup snapshot', t => {
  const { env } = fixture(t)
  assert.equal(main(['disable', 'odk.tile.weather'], env), 0)
  assert.deepEqual(resolveStartupDisabled(env), ['odk.tile.weather'])
  assert.equal(main(['enable', 'odk.tile.weather'], env), 0)
  assert.deepEqual(resolveStartupDisabled({ ...env, ODESK_DISABLED_PLUGINS: 'odk.tile.weather, odk.tile.clock odk.tile.clock' }), ['odk.tile.weather', 'odk.tile.clock'])
})

test('invalid configuration is reported at startup and cannot be overwritten by CLI', t => {
  const { env, file } = fixture(t)
  for (const bytes of ['{broken', '{"version":2,"plugins":{}}', '{"version":1,"plugins":[]}','{"version":1,"plugins":{"odk.tile.weather":{"enabled":"false"}}}']) {
    fs.writeFileSync(file, bytes)
    assert.throws(() => readConfig(file))
    const errors = []
    assert.deepEqual(resolveStartupDisabled({ ...env, ODESK_DISABLED_PLUGINS: 'odk.tile.clock' }, error => errors.push(error)), ['odk.tile.clock'])
    assert.equal(errors.length, 1)
    assert.equal(main(['disable', 'odk.tile.weather'], env), 1)
    assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  }
})

test('missing configuration preserves defaults and Windows profile resolves a full path', t => {
  const { env, file } = fixture(t)
  assert.deepEqual(readConfig(file), { version: 1, plugins: {} })
  assert.deepEqual(resolveStartupDisabled(env), [])
  assert.equal(resolveConfigPath({ USERPROFILE: '/profile' }), path.join('/profile', '.config', 'open-deskos', 'plugins.json'))
})


test('invalid CLI identities cannot corrupt existing preferences', t => {
  const { env, file } = fixture(t)
  assert.equal(main(['disable', 'odk.tile.weather'], env), 0)
  const bytes = fs.readFileSync(file, 'utf8')
  for (const id of ['typo', '__proto__', 'odk.BAD']) {
    for (const command of ['enable', 'disable']) assert.equal(main([command, id], env), 1)
  }
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  assert.deepEqual(resolveStartupDisabled(env), ['odk.tile.weather'])
})

test('locked configuration rejects another mutation without deleting its lock', t => {
  const { file, env } = fixture(t)
  assert.equal(main(['disable', 'odk.test.one'], env), 0)
  const bytes = fs.readFileSync(file, 'utf8')
  fs.mkdirSync(`${file}.lock`)
  assert.equal(main(['enable', 'odk.test.one'], env), 1)
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  assert.equal(fs.statSync(`${file}.lock`).isDirectory(), true)
  fs.rmdirSync(`${file}.lock`)
})

test('a configuration symlink keeps its target and link through a mutation', { skip: process.platform === 'win32' ? 'native Windows symlinks need separate acceptance' : false }, t => {
  const { file } = fixture(t)
  const target = path.join(path.dirname(file), 'owned-config.json')
  fs.writeFileSync(target, JSON.stringify({ version: 1, plugins: { 'odk.test.one': { enabled: true } } }))
  fs.symlinkSync(target, file)
  updateConfig(file, config => { config.plugins['odk.test.one'].enabled = false })
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true)
  assert.equal(readConfig(target).plugins['odk.test.one'].enabled, false)
})

test('transaction rereads the current state and cleans candidates after rename or validation failure', t => {
  const { file } = fixture(t)
  updateConfig(file, config => { config.plugins['odk.test.one'] = { enabled: false, custom: 'retained' } })
  updateConfig(file, config => { config.plugins['odk.test.two'] = { enabled: true } })
  assert.deepEqual(Object.keys(readConfig(file).plugins), ['odk.test.one', 'odk.test.two'])
  const bytes = fs.readFileSync(file, 'utf8')
  assert.throws(() => updateConfig(file, config => { config.plugins['odk.test.one'].enabled = 'invalid' }), /invalid plugin configuration/)
  assert.throws(() => updateConfig(file, config => { config.plugins['odk.test.two'].enabled = false }, {
    fsModule: { ...fs, renameSync() { throw Error('fixture rename failure') } },
  }), /fixture rename failure/)
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['plugins.json'])
})

test('cleanup failure after publication explicitly reports that configuration was saved', t => {
  const { file } = fixture(t)
  let candidate
  assert.throws(() => updateConfig(file, config => { config.plugins['odk.test.one'] = { enabled: false } }, {
    fsModule: { ...fs, rmSync(directory) { candidate = directory; throw Error('fixture cleanup failure') } },
  }), /configuration saved; temporary cleanup failed/)
  assert.equal(readConfig(file).plugins['odk.test.one'].enabled, false)
  assert.equal(fs.existsSync(`${file}.lock`), false)
  fs.rmSync(candidate, { recursive: true, force: true })
})

test('independent CLI mutation cannot overwrite a transaction waiting to publish', { timeout: 10000 }, async t => {
  const { file, env } = fixture(t)
  assert.equal(main(['disable', 'odk.test.original'], env), 0)
  const { spawn } = require('node:child_process')
  const { once } = require('node:events')
  const script = `const fs = require('node:fs'); const { updateConfig } = require(process.argv[1]); updateConfig(process.argv[2], config => { config.plugins['odk.test.child'] = { enabled: false } }, { fsModule: { ...fs, renameSync(...args) { process.stdout.write('ready'); fs.readSync(0, Buffer.alloc(1), 0, 1, null); return fs.renameSync(...args) } } })`
  const child = spawn(process.execPath, ['-e', script, require.resolve('../src/plugin-config'), file], { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  let errors = ''
  child.stderr.on('data', data => { errors += data })
  const exit = once(child, 'exit')
  await once(child.stdout, 'data')
  try {
    assert.equal(main(['disable', 'odk.test.parent'], env), 1)
    assert.deepEqual(Object.keys(readConfig(file).plugins), ['odk.test.original'])
  } finally { child.stdin.end('x') }
  assert.equal((await exit)[0], 0, errors)
  assert.equal(main(['disable', 'odk.test.parent'], env), 0)
  assert.deepEqual(Object.keys(readConfig(file).plugins), ['odk.test.original', 'odk.test.child', 'odk.test.parent'])
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['plugins.json'])
})
