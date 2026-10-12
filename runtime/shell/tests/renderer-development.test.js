'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { loadDevelopmentPlugins, readDevelopmentPlugin } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const run = promisify(execFile)

for (const mode of ['default', 'selected']) {
  function discoveryPlugin() {
    const { createMainPlugins } = require('../src/plugins/main-composition')
    const replacement = mode === 'selected'
      ? require('./fixtures/renderer-development-replacement').independentRendererDevelopment() : undefined
    const id = 'odk.system.renderer-development'
    const composition = createMainPlugins({ replacementPlugins: replacement ? [replacement] : [], onDefaults(defaults) {
      if (replacement) defaults.find(plugin => plugin.manifest.id === id).create = () => { throw Error('default discovery executed') }
    } })
    const plugin = composition.find(plugin => plugin.manifest.id === id)
    if (replacement) assert.equal(plugin, replacement)
    return plugin
  }

  for (const stage of ['protocol', 'ipc']) {
    test(`${mode} discovery releases its asset lease when ${stage} registration fails without removing another owner`, async t => {
      const { createPluginHost } = require('../src/plugin-host')
      let leases = 0
      let removed = 0
      const host = createPluginHost({ capabilities: { 'system.renderer-development': {
        nativeAssets: { hasEntries: () => true, fork() { leases++; return { close() { leases-- } } } },
        protocol: { handle() { if (stage === 'protocol') throw Error('Protocol already registered') }, unhandle() { removed++ } },
        ipc: { handle() { throw Error('IPC must not register after protocol failure') }, removeHandler() {} },
      } } })
      t.after(() => host.stop())
      host.register(discoveryPlugin())
      await host.start()
      assert.equal(host.list()[0].state, 'failed')
      assert.equal(removed, stage === 'protocol' ? 0 : 1)
      assert.equal(leases, 0, 'failed startup must release its acquired lease')
    })
  }

  test(`${mode} discovery retains its lease when protocol removal fails and releases it on retry`, async t => {
    const { createPluginHost } = require('../src/plugin-host')
    let route
    let failed = true
    let leases = 0
    const host = createPluginHost({ capabilities: { 'system.renderer-development': {
      nativeAssets: { hasEntries: () => true, fork() { leases++; return { close() { leases-- }, response: () => new Response('owned') } } },
      protocol: { handle(_scheme, handler) { route = handler }, unhandle() { if (failed) throw Error('Controlled removal failure'); route = null } },
      ipc: { handle() {}, removeHandler() {} },
    } } })
    t.after(() => { failed = false; return host.stop() })
    host.register(discoveryPlugin())
    await host.start()
    assert.equal((await route({})).status, 200)
    await host.stop()
    assert.equal(host.list()[0].state, 'cleanup-failed')
    assert.equal(leases, 1)
    assert.equal((await route({})).status, 410)
    failed = false
    await host.stop()
    assert.equal(host.list()[0].state, 'stopped')
    assert.equal(route, null)
    assert.equal(leases, 0)
  })

  test(`${mode} renderer development IPC preserves bounds, authority, and restart lifetime`, async t => {
    const { createPluginHost } = require('../src/plugin-host')
    const { RENDERER_DEVELOPMENT_CHANNEL } = require('../src/plugins/renderer-development')
    const handlers = new Map()
    const mainFrame = {}
    const sender = { mainFrame }
    let entries = [rendererEntry()]
    let reads = 0
    const host = createPluginHost({ capabilities: { 'system.renderer-development': {
      ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
      frames: () => [sender], entries: () => { reads++; return entries },
    } } })
    t.after(() => host.stop())
    host.register(discoveryPlugin())
    await host.start()
    const handler = handlers.get(RENDERER_DEVELOPMENT_CHANNEL)
    assert.throws(() => handler({ sender: { mainFrame }, senderFrame: mainFrame }), /refused/)
    assert.throws(() => handler({ sender, senderFrame: {} }), /refused/)
    assert.equal(reads, 0)
    const event = { sender, senderFrame: mainFrame }
    assert.deepEqual(handler(event), entries)
    entries = Array.from({ length: 32 }, rendererEntry)
    assert.deepEqual(handler(event), entries)
    for (const invalid of [null, {}, Array.from({ length: 33 }, rendererEntry)]) {
      entries = invalid
      assert.throws(() => handler(event), /limit/)
    }
    await host.setEnabled('odk.system.renderer-development', false)
    assert.equal(handlers.size, 0)
    const readsBefore = reads
    assert.throws(() => handler(event), /refused/)
    assert.equal(reads, readsBefore)
    await host.setEnabled('odk.system.renderer-development', true)
    const resumed = handlers.get(RENDERER_DEVELOPMENT_CHANNEL)
    assert.notEqual(resumed, handler)
    entries = [rendererEntry()]
    assert.deepEqual(resumed(event), entries)
    assert.throws(() => handler(event), /refused/)
    await host.stop()
    assert.equal(handlers.size, 0)
    assert.throws(() => resumed(event), /refused/)
  })
}

test('renderer startup discovery retains valid entries beside a missing link without executing code', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-renderer-isolation-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const manifest = { schemaVersion: 1, id: 'odk.tile.clock', name: 'Clock replacement', version: '2.0.0', kind: 'surface', host: 'electron-renderer', surfaceKind: 'tile', interaction: 'display-only',
    provides: [{ interface: 'odk:surface/odk.tile.clock/v1' }], requires: [], permissions: [], entry: 'entry.js' }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(directory, 'entry.js'), 'throw Error("discovery must not execute")')
  const preference = folder => ({ development: { path: folder, grants: [], trustAcknowledgedAt: new Date().toISOString(), host: 'electron-renderer', replace: true } })
  const config = { version: 1, plugins: { 'odk.tile.weather': preference(path.join(directory, 'missing')), 'odk.tile.clock': preference(directory) } }
  const before = JSON.stringify(config)
  const errors = []
  const entries = loadDevelopmentPlugins(config, { host: 'electron-renderer', report: id => errors.push(id) })
  assert.deepEqual(entries.map(entry => entry.manifest.id), ['odk.tile.clock'])
  assert.deepEqual(errors, ['odk.tile.weather'])
  assert.throws(() => loadDevelopmentPlugins(config, { host: 'electron-renderer' }), /ENOENT/)
  assert.equal(JSON.stringify(config), before)
})

test('CLI links renderer browser entries separately from Main code and removal preserves source', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-rdev-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config') }
  const manifest = { schemaVersion: 1, id: 'odk.tile.clock', name: 'Clock replacement', version: '2.0.0', kind: 'surface', host: 'electron-renderer', surfaceKind: 'tile', interaction: 'display-only',
    provides: [{ interface: 'odk:surface/odk.tile.clock/v1' }], requires: [], permissions: [], entry: 'entry.js' }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(directory, 'entry.js'), 'throw Error("browser entry must not execute in Main")')
  const cli = path.resolve('scripts/odk-plugin-cli.js')
  await assert.rejects(run(process.execPath, [cli, 'link', directory, '--replace'], { env }))
  await run(process.execPath, [cli, 'link', directory, '--trust', '--replace'], { env })
  const config = () => readConfig(resolveConfigPath(env))
  assert.equal(config().plugins[manifest.id].development.host, 'electron-renderer')
  assert.deepEqual(loadDevelopmentPlugins(config()), [])
  const entries = loadDevelopmentPlugins(config(), { host: 'electron-renderer' })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].manifest.id, manifest.id)
  assert.match(entries[0].entryUrl, /^file:/)
  await run(process.execPath, [cli, 'disable', manifest.id], { env })
  assert.deepEqual(loadDevelopmentPlugins(config(), { host: 'electron-renderer' }), [])
  await run(process.execPath, [cli, 'enable', manifest.id], { env })
  assert.deepEqual(loadDevelopmentPlugins(config(), { host: 'electron-renderer', disabled: [manifest.id] }), [])
  await run(process.execPath, [cli, 'remove', manifest.id], { env })
  assert.deepEqual(loadDevelopmentPlugins(config(), { host: 'electron-renderer' }), [])
  assert.equal(fs.existsSync(path.join(directory, 'entry.js')), true)
})

function browserFixture(entries, scripts, timers = { setTimeout, clearTimeout }) {
  const vm = require('node:vm')
  const { createPluginHost } = require('../src/plugin-host')
  const root = { odkPluginHost: { createPluginHost }, odkRendererPluginBridge: { list: async () => entries } }
  let executed = 0
  const stagedStyles = new Set()
  const checkedStyles = []
  const pendingScripts = []
  const listeners = new Map()
  root.addEventListener = (name, listener) => listeners.set(name, listener)
  root.removeEventListener = name => listeners.delete(name)
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} }, ...timers })
  root.document = { createElement: tagName => ({ tagName, remove() { stagedStyles.delete(this) } }), head: { appendChild(script) {
    if (script.tagName === 'link') {
      stagedStyles.add(script)
      checkedStyles.push({ href: script.href, media: script.media })
      if (scripts.get(script.href) === 'pending') return
      if (scripts.has(script.href)) script.onload()
      else script.onerror()
      return
    }
    executed++
    if (scripts.get(script.src) === 'pending') { pendingScripts.push(script); return }
    root.document.currentScript = script
    try { vm.runInContext(scripts.get(script.src), context) } catch { listeners.get('error')?.({ filename: script.src }) }
    finally { root.document.currentScript = null }
    script.onload()
  } } }
  vm.runInContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), context)
  vm.runInContext(fs.readFileSync('src/renderer/core/development-plugins.js', 'utf8'), context)
  root.odkPlugins.register({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', manifest: { schemaVersion: 1 }, mount() { throw Error('original must not mount') } })
  return { root, executions: () => executed, stagedStyles, checkedStyles, pendingScripts }
}
const rendererEntry = () => ({ manifest: { schemaVersion: 1, id: 'odk.tile.clock', name: 'Clock', version: '2.0.0', kind: 'surface', host: 'electron-renderer', surfaceKind: 'tile', interaction: 'display-only',
  provides: [{ interface: 'odk:surface/odk.tile.clock/v1' }], requires: [], permissions: [] }, entryUrl: 'file:///fixture/entry.js' })

test('surface discovery leaves desktop system entries to their separate consumer', async () => {
  const entry = rendererEntry()
  const desktop = { manifest: JSON.parse(fs.readFileSync('tests/fixtures/user-app-desktop-replacement/manifest.json')), entryUrl: 'file:///fixture/desktop.js' }
  const fixture = browserFixture([desktop, entry], new Map([[entry.entryUrl, `window.odkRendererDevelopment.define({id:'odk.tile.clock',kind:'tile',interaction:'display-only',mount(){}})`]]))
  const definitions = await fixture.root.odkRendererDevelopment.load()
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].id, entry.manifest.id)
  assert.equal(fixture.executions(), 1)
})

test('surface entries cannot register through the desktop definition endpoint', async () => {
  const entry = rendererEntry()
  const fixture = browserFixture([entry], new Map([[entry.entryUrl, `try { window.odkUserAppDesktopLoading.define({id:'odk.tile.clock',create(){}}) } catch {}`]]))
  await assert.rejects(fixture.root.odkRendererDevelopment.load(), /selected identity/)
  assert.equal(fixture.executions(), 1)
})

test('renderer declarations are checked before script execution and valid definitions mount through the real registry', async () => {
  const entry = rendererEntry()
  const scripts = new Map([[entry.entryUrl, `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', mount(el) { el.text = 'replacement'; } });`]])
  const invalid = browserFixture([{ ...entry, manifest: { ...entry.manifest, surfaceKind: 'page' } }], scripts)
  await assert.rejects(invalid.root.odkRendererDevelopment.load(), /external contract/)
  assert.equal(invalid.executions(), 0)
  const valid = browserFixture([entry], scripts)
  const replacements = await valid.root.odkRendererDevelopment.load()
  await valid.root.odkPlugins.start({ replacements })
  const el = {}
  assert.equal(valid.root.odkPlugins.activate(valid.root.odkPlugins.get(entry.manifest.id), el, {}), true)
  assert.equal(el.text, 'replacement')
  await valid.root.odkPlugins.stop()
})

test('renderer entry must define exactly its selected identity and cannot change the declaration contract', async () => {
  const entry = rendererEntry()
  for (const script of [
    `window.odkRendererDevelopment.define({ id: 'odk.tile.other', kind: 'tile', mount() {} });`,
    `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'page', mount() {} });`,
    `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount() {} }); window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount() {} });`,
    `window.noDefinition = true;`,
    `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount() {} }); throw Error('entry failed after registration');`,
  ]) {
    const f = browserFixture([entry], new Map([[entry.entryUrl, script]]))
    await assert.rejects(f.root.odkRendererDevelopment.load())
    assert.equal(f.root.odkPlugins.get(entry.manifest.id).kind, 'tile')
    assert.equal(f.root.odkPlugins.catalog()[0].state, 'registered')
  }
})

test('renderer links reject changed host, missing trust or grants, and invalid browser entry bounds before loading', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-rdev-bounds-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const manifest = { ...rendererEntry().manifest, entry: 'entry.js', permissions: ['source.weather'] }
  const write = value => fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(value))
  write(manifest)
  fs.writeFileSync(path.join(directory, 'entry.js'), 'throw Error("entry must not execute in Main")')
  const preference = { enabled: true, development: { path: directory, host: 'electron-renderer', replace: true,
    trustAcknowledgedAt: new Date().toISOString(), grants: ['source.weather'] } }
  const config = development => ({ plugins: { [manifest.id]: { ...preference, development } } })
  const load = development => loadDevelopmentPlugins(config(development), { host: 'electron-renderer' })
  assert.throws(() => load({ ...preference.development, trustAcknowledgedAt: undefined }), /explicit trust/)
  assert.throws(() => load({ ...preference.development, grants: [] }), /explicit capability grants/)
  assert.throws(() => readDevelopmentPlugin(directory), /explicit --replace/)
  assert.equal(load(preference.development).length, 1)
  fs.writeFileSync(path.join(directory, 'entry.js'), ' '.repeat(262145))
  assert.throws(() => load(preference.development), /256 KiB/)
  fs.writeFileSync(path.join(directory, 'entry.cjs'), '')
  write({ ...manifest, entry: 'entry.cjs' })
  assert.throws(() => load(preference.development), /browser script/)
  write({ ...manifest, id: 'odk.tile.other', provides: [{ interface: 'odk:surface/odk.tile.other/v1' }] })
  fs.writeFileSync(path.join(directory, 'entry.js'), '')
  assert.throws(() => load(preference.development), /identity changed/)
  write({ ...manifest, host: 'electron-main' })
  assert.throws(() => load(preference.development), /invalid replacement identity/)
  write(manifest)
  fs.unlinkSync(path.join(directory, 'entry.js'))
  assert.throws(() => load(preference.development), /ENOENT/)
})


test('renderer package stylesheet is contained, bounded, and passed as a file URL', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-rdev-css-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const folder = path.join(directory, 'package')
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, 'entry.js'), '')
  fs.writeFileSync(path.join(folder, 'clock.css'), 'body { --fixture: loaded; }')
  const manifest = { ...rendererEntry().manifest, entry: 'entry.js', css: 'clock.css' }
  const write = value => fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(value))
  write(manifest)
  const config = { plugins: { [manifest.id]: { development: { path: folder, host: 'electron-renderer',
    replace: true, trustAcknowledgedAt: new Date().toISOString(), grants: [] } } } }
  const load = () => loadDevelopmentPlugins(config, { host: 'electron-renderer' })
  assert.equal(load()[0].cssUrl, require('node:url').pathToFileURL(fs.realpathSync(path.join(folder, 'clock.css'))).href)
  for (const css of ['../outside.css', '/outside.css', 'https://example.invalid/style.css', '', 'entry.js']) {
    write({ ...manifest, css })
    assert.throws(load)
  }
  fs.writeFileSync(path.join(directory, 'outside.css'), '')
  fs.symlinkSync(path.join(directory, 'outside.css'), path.join(folder, 'escape.css'))
  write({ ...manifest, css: 'escape.css' })
  assert.throws(load, /inside/)
  write(manifest)
  fs.writeFileSync(path.join(folder, 'clock.css'), ' '.repeat(262145))
  assert.throws(load, /256 KiB/)
  fs.unlinkSync(path.join(folder, 'clock.css'))
  assert.throws(load, /ENOENT/)
})


test('renderer checks declared CSS before entries, resolves package CSS, and removes staged styles on failure', async () => {
  const entry = { ...rendererEntry(), cssUrl: 'file:///fixture/clock.css' }
  entry.manifest.css = 'clock.css'
  const script = `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', css: 'wrong-shell-path.css', mount() {} });`
  const valid = browserFixture([entry], new Map([[entry.entryUrl, script], [entry.cssUrl, '']]))
  const definitions = await valid.root.odkRendererDevelopment.load()
  assert.equal(definitions[0].css, entry.manifest.css)
  assert.deepEqual(valid.checkedStyles, [{ href: entry.cssUrl, media: 'not all' }])
  assert.equal(valid.stagedStyles.size, 0)
  const unavailable = browserFixture([entry], new Map([[entry.entryUrl, script]]))
  await assert.rejects(unavailable.root.odkRendererDevelopment.load(), /stylesheet unavailable/)
  assert.equal(unavailable.executions(), 0)
  assert.equal(unavailable.stagedStyles.size, 0)
  const failed = browserFixture([entry], new Map([[entry.cssUrl, ''], [entry.entryUrl, script + `throw Error('failed entry');`]]))
  await assert.rejects(failed.root.odkRendererDevelopment.load(), /script failed/)
  assert.equal(failed.stagedStyles.size, 0)
  assert.equal(failed.root.odkPlugins.catalog()[0].state, 'registered')
  const malformed = browserFixture([{ ...entry, cssUrl: 'https://example.invalid/style.css' }], new Map())
  await assert.rejects(malformed.root.odkRendererDevelopment.load(), /invalid.*stylesheet/)
  assert.equal(malformed.executions(), 0)
  assert.equal(malformed.checkedStyles.length, 0)
})


test('a pending package stylesheet times out and releases its temporary link before entry execution', async () => {
  const scheduled = new Map()
  let sequence = 0
  const timers = { setTimeout(callback, delay) {
    assert.equal(delay, 2000)
    scheduled.set(++sequence, callback)
    return sequence
  }, clearTimeout(id) { scheduled.delete(id) } }
  const entry = { ...rendererEntry(), cssUrl: 'file:///fixture/clock.css' }
  entry.manifest.css = 'clock.css'
  const fixture = browserFixture([entry], new Map([[entry.cssUrl, 'pending']]), timers)
  const rejection = assert.rejects(fixture.root.odkRendererDevelopment.load(), /stylesheet timed out/)
  await new Promise(setImmediate)
  assert.equal(scheduled.size, 1)
  assert.equal(fixture.stagedStyles.size, 1)
  scheduled.values().next().value()
  await rejection
  assert.equal(scheduled.size, 0)
  assert.equal(fixture.stagedStyles.size, 0)
  assert.equal(fixture.executions(), 0)
  assert.equal(fixture.root.odkPlugins.catalog()[0].state, 'registered')
})

test('signed asset URLs use the existing declaration factory stylesheet and failure boundaries', async () => {
  const entry = { ...rendererEntry(), entryUrl: `odk-native-plugin://${'a'.repeat(32)}/entry.js`,
    cssUrl: `odk-native-plugin://${'a'.repeat(32)}/assets/clock.css` }
  entry.manifest.css = 'assets/clock.css'
  const code = `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', mount(el) { el.text = 'signed'; } });`
  const valid = browserFixture([entry], new Map([[entry.entryUrl, code], [entry.cssUrl, '']]))
  const replacements = await valid.root.odkRendererDevelopment.load()
  await valid.root.odkPlugins.start({ replacements })
  const el = {}
  assert.equal(valid.root.odkPlugins.activate(valid.root.odkPlugins.get(entry.manifest.id), el, {}), true)
  assert.equal(el.text, 'signed')
  assert.equal(valid.root.odkPlugins.catalog()[0].manifest.version, '2.0.0')
  await valid.root.odkPlugins.stop()
  const failed = browserFixture([entry], new Map([[entry.entryUrl, code + 'throw Error("failed signed entry");'], [entry.cssUrl, '']]))
  await assert.rejects(failed.root.odkRendererDevelopment.load(), /script failed/)
  assert.equal(failed.stagedStyles.size, 0)
  assert.equal(failed.root.odkPlugins.catalog()[0].state, 'registered')
})

test('runtime browser loading validates and applies a trusted entry to the running registry', async () => {
  const entry = rendererEntry()
  const f = browserFixture([entry], new Map([[entry.entryUrl, `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount(el) { el.text = 'runtime'; } });`]]))
  await f.root.odkPlugins.start()
  const [replacement] = await f.root.odkRendererDevelopment.load({ runtime: true })
  await f.root.odkPlugins.replace(replacement)
  const element = {}
  assert.equal(f.root.odkPlugins.activate(f.root.odkPlugins.get(entry.manifest.id), element, {}), true)
  assert.equal(element.text, 'runtime')
  await f.root.odkPlugins.stop()
})

test('runtime loader refuses incompatible declarations and styles before browser execution', async () => {
  for (const change of [{ surfaceKind: 'page' }, { css: 'new.css' }]) {
    const entry = rendererEntry()
    Object.assign(entry.manifest, change)
    if (entry.manifest.css) entry.cssUrl = 'file:///fixture/new.css'
    const f = browserFixture([entry], new Map([[entry.entryUrl, 'throw Error("must not execute")']]))
    await f.root.odkPlugins.start()
    await assert.rejects(f.root.odkRendererDevelopment.load({ runtime: true }), /contract|stylesheet/)
    assert.equal(f.executions(), 0)
    assert.equal(f.root.odkPlugins.catalog()[0].state, 'running')
    await f.root.odkPlugins.stop()
  }
})

test('concurrent browser loads serialize definition collection and recover after rejection', async () => {
  const entry = rendererEntry()
  const scripts = new Map([[entry.entryUrl, `(function () { const value = window.loadedCount = (window.loadedCount || 0) + 1; window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount(el) { el.value = value; } }); })();`]])
  const f = browserFixture([entry], scripts)
  await f.root.odkPlugins.start()
  const loads = await Promise.all([f.root.odkRendererDevelopment.load({ runtime: true }), f.root.odkRendererDevelopment.load({ runtime: true })])
  for (const [index, [definition]] of loads.entries()) {
    const element = {}
    definition.mount(element)
    assert.equal(element.value, index + 1)
  }
  scripts.set(entry.entryUrl, 'throw Error("failed trusted entry")')
  await assert.rejects(f.root.odkRendererDevelopment.load({ runtime: true }), /script failed/)
  scripts.set(entry.entryUrl, `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount() {} });`)
  assert.equal((await f.root.odkRendererDevelopment.load({ runtime: true })).length, 1)
  await f.root.odkPlugins.stop()
})

test('runtime loading scopes execution to the exact captured selection requested by Main', async () => {
  const entry = rendererEntry()
  const other = { ...entry, manifest: { ...entry.manifest, id: 'odk.tile.other' }, entryUrl: 'file:///fixture/other.js' }
  const scripts = new Map([[entry.entryUrl, `window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount() {} });`],
    [other.entryUrl, 'throw Error("unrelated entry must not execute")']])
  const f = browserFixture([entry, other], scripts)
  await f.root.odkPlugins.start()
  const definitions = await f.root.odkRendererDevelopment.load({ runtime: true, pluginId: entry.manifest.id, entryUrl: entry.entryUrl })
  assert.equal(definitions.length, 1)
  assert.equal(f.executions(), 1)
  await assert.rejects(f.root.odkRendererDevelopment.load({ runtime: true, pluginId: entry.manifest.id, entryUrl: 'file:///fixture/stale.js' }), /selection changed/)
  assert.equal(f.executions(), 1)
  await f.root.odkPlugins.stop()
})

test('delayed definitions from a rejected entry cannot impersonate a later captured revision', async () => {
  const entry = rendererEntry()
  const entries = [entry]
  const scripts = new Map([[entry.entryUrl, `window.delayedDefinition = () => window.odkRendererDevelopment.define({
    id: 'odk.tile.clock', kind: 'tile', mount(el) { el.value = 'old'; } });`]])
  const f = browserFixture(entries, scripts)
  await f.root.odkPlugins.start()
  await assert.rejects(f.root.odkRendererDevelopment.load({ runtime: true }), /did not define/)
  const next = { ...entry, manifest: { ...entry.manifest, version: '3.0.0' }, entryUrl: 'file:///fixture/next.js' }
  entries[0] = next
  scripts.set(next.entryUrl, 'pending')
  const pending = f.root.odkRendererDevelopment.load({ runtime: true })
  await new Promise(setImmediate)
  assert.throws(() => f.root.delayedDefinition(), /executing selected script/)
  const script = f.pendingScripts[0]
  f.root.document.currentScript = script
  f.root.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', mount(el) { el.value = 'new' } })
  f.root.document.currentScript = null
  script.onload()
  const [definition] = await pending
  const el = {}
  definition.mount(el)
  assert.equal(el.value, 'new')
  assert.equal(definition.manifest.version, '3.0.0')
  await f.root.odkPlugins.stop()
})


test('runtime discovery retains packaged stylesheet previews and rejects changed actual styles', async () => {
  for (const css of ['plugins/clock.css', undefined, 'plugins/other.css']) {
    const entry = rendererEntry()
    const code = `window.odkRendererDevelopment.define({ id:'odk.tile.clock',kind:'tile',css:${JSON.stringify(css)},mount(el){el.value='independent'} });`
    const f = browserFixture([entry], new Map([[entry.entryUrl, code]]))
    f.root.odkPlugins.get(entry.manifest.id).css = 'plugins/clock.css'
    await f.root.odkPlugins.start()
    if (css === 'plugins/clock.css') {
      const [definition] = await f.root.odkRendererDevelopment.load({ runtime:true })
      assert.equal(definition.css, css)
      assert.equal(f.executions(), 1)
      await f.root.odkPlugins.replace(definition)
      assert.equal(f.root.odkPlugins.get(entry.manifest.id).css, css)
    } else {
      await assert.rejects(f.root.odkRendererDevelopment.load({ runtime:true }), /stylesheet contract/)
      assert.equal(f.executions(), 1)
      assert.equal(f.root.odkPlugins.get(entry.manifest.id).css, 'plugins/clock.css')
      assert.equal(f.root.odkPlugins.catalog()[0].state, 'running')
    }
    assert.equal(f.checkedStyles.length, 0)
    await f.root.odkPlugins.stop()
  }
})


test('packaged stylesheet preview cannot inherit an external capture binding', async () => {
  const entry = rendererEntry()
  const f = browserFixture([entry], new Map([[entry.entryUrl, 'throw Error("must not execute")']]))
  const original = f.root.odkPlugins.get(entry.manifest.id)
  original.css = 'clock.css'
  original.manifest.css = original.css
  f.root.odkPlugins.prepareDevelopmentStylesheet(original, 'file:///fixture/clock.css')
  await f.root.odkPlugins.start()
  await assert.rejects(f.root.odkRendererDevelopment.load({ runtime:true }), /stylesheet contract/)
  assert.equal(f.executions(), 0)
  assert.equal(f.root.odkPlugins.catalog()[0].state, 'running')
  await f.root.odkPlugins.stop()
})
