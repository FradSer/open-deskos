'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const hostApi = require('../src/plugin-host')
const { readDevelopmentPlugin, loadDevelopmentPlugins } = require('../src/development-plugins')
const manifest = JSON.parse(fs.readFileSync('tests/fixtures/user-app-desktop-replacement/manifest.json'))

test('desktop development discovery validates the system contract without executing browser code', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-desktop-discovery-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(directory, 'entry.js'), 'throw Error("Discovery must not execute")')
  assert.equal(readDevelopmentPlugin(directory, { replacement: true }).manifest.id, manifest.id)
  assert.throws(() => readDevelopmentPlugin(directory), /explicit --replace/)
  const config = { plugins: { [manifest.id]: { development: { path: directory, host: 'electron-renderer', replace: true, grants: [], trustAcknowledgedAt: new Date().toISOString() } } } }
  assert.equal(loadDevelopmentPlugins(config, { host: 'electron-renderer' }).length, 1)
  assert.deepEqual(loadDevelopmentPlugins(config), [])
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, css: 'entry.css' }))
  assert.throws(() => readDevelopmentPlugin(directory, { replacement: true }), /public contract/)
})

function fixture(entries, script) {
  const root = { odkPluginHost: hostApi, odkUserAppDesktop: { mount() {} }, odkRendererPluginBridge: { list: async () => entries } }
  let executions = 0
  const context = vm.createContext({ window: root, console, setTimeout, clearTimeout })
  const listeners = new Map()
  root.addEventListener = (name, listener) => listeners.set(name, listener)
  root.removeEventListener = name => listeners.delete(name)
  root.document = { currentScript: null, createElement: () => ({ remove() {} }), head: { appendChild(selected) {
    executions++; root.document.currentScript = selected
    try { vm.runInContext(script, context) } catch { listeners.get('error')?.({ filename: selected.src }) }
    finally { root.document.currentScript = null }
    selected.onload()
  } } }
  for (const file of ['user-app-desktop-plugins.js', 'development-plugins.js']) {
    vm.runInContext(fs.readFileSync(`src/renderer/core/${file}`, 'utf8'), context)
  }
  return { root, executions: () => executions }
}
const entry = { manifest, entryUrl: 'file:///fixture/entry.js' }
const validScript = `window.odkUserAppDesktopLoading.define({id:'${manifest.id}',create(){return {ports:{'odk:system/user-app-desktop/v1':{mount(){return {refresh(){},dispose(){}}}}}}}})`

test('desktop loading binds factory definitions to the selected executing script', async () => {
  const valid = fixture([entry], validScript)
  assert.throws(() => valid.root.odkUserAppDesktopLoading.define({ id: manifest.id, create() {} }), /executing selected script/)
  const definitions = await valid.root.odkUserAppDesktopLoading.load()
  assert.equal(definitions.length, 1)
  const runtime = valid.root.odkUserAppDesktopPlugins.create({ replacements: definitions })
  await runtime.start(); runtime.mount({}); await runtime.stop()
  assert.equal(valid.executions(), 1)
})

test('invalid desktop declarations and duplicate entries reject before execution', async () => {
  for (const entries of [[{ ...entry, manifest: { ...manifest, permissions: ['filesystem'] } }], [entry, entry]]) {
    const invalid = fixture(entries, validScript)
    await assert.rejects(invalid.root.odkUserAppDesktopLoading.load())
    assert.equal(invalid.executions(), 0)
  }
})

test('wrong or duplicate definitions fail and an aborted load never executes', async () => {
  for (const script of [validScript.replace(manifest.id, 'odk.system.other'), validScript + ';' + validScript,
    validScript.replace('odkUserAppDesktopLoading', 'odkRendererDevelopment'), 'void 0']) {
    const invalid = fixture([entry], script)
    await assert.rejects(invalid.root.odkUserAppDesktopLoading.load())
  }
  const aborted = fixture([entry], validScript), controller = new AbortController()
  controller.abort()
  await assert.rejects(aborted.root.odkUserAppDesktopLoading.load({ signal: controller.signal }))
  assert.equal(aborted.executions(), 0)
})

test('cancelled discovery settles before a late reply and never executes that reply', async () => {
  for (const rejectLate of [false, true]) {
    const instance = fixture([entry], validScript), controller = new AbortController()
    let complete, listed
    const started = new Promise(resolve => { listed = resolve })
    instance.root.odkRendererPluginBridge.list = () => { listed(); return new Promise((resolve, reject) => { complete = rejectLate ? reject : resolve }) }
    let settled = false
    const loading = instance.root.odkUserAppDesktopLoading.load({ signal: controller.signal })
    const rejection = assert.rejects(loading, /abort/i).then(() => { settled = true })
    await started
    controller.abort()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, true, 'Cancellation still waits for discovery')
    complete(rejectLate ? Error('Controlled late discovery failure') : [entry])
    await rejection
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(instance.executions(), 0)
  }
})
