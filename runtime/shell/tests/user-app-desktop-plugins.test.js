'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const hostApi = require('../src/plugin-host')

function api(defaultMount) {
  const root = { odkPluginHost: hostApi, odkUserAppDesktop: { mount: defaultMount } }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/user-app-desktop-plugins.js', 'utf8'), { window: root, console })
  return root.odkUserAppDesktopPlugins
}

test('rejected controller interfaces retain cleanup ownership and retry', async () => {
  let attempts = 0
  const plugins = api(() => ({ dispose() {
    if (++attempts === 1) throw Error('Controlled malformed controller release failure')
  } }))
  const runtime = plugins.create()
  await runtime.start()
  assert.throws(() => runtime.mount({}), /requires refresh and dispose/)
  await assert.rejects(runtime.stop(), /retains cleanup ownership/)
  assert.equal(runtime.catalog()[0].state, 'cleanup-failed')
  await runtime.stop()
  assert.equal(attempts, 2)
})

for (const result of [null, undefined]) {
  test(`invalid factory result ${result} releases context cleanup without blocking recovery`, async () => {
    let releases = 0
    const plugins = api(() => ({ refresh() {}, dispose() {} }))
    const runtime = plugins.create({ replacements: [{ manifest: plugins.manifest, create(context) {
      context.onCleanup(() => { releases++ })
      return result
    } }] })
    await assert.rejects(runtime.start(), /startup failed/)
    await runtime.stop()
    assert.equal(releases, 1)
    assert.notEqual(runtime.catalog()[0].state, 'cleanup-failed')
  })
}

test('rejected asynchronous mount drains its eventual controller and handles rejection', async () => {
  let resolveMount, releases = 0
  const plugins = api(() => new Promise(resolve => { resolveMount = resolve }))
  const runtime = plugins.create()
  await runtime.start()
  assert.throws(() => runtime.mount({}), /requires refresh and dispose/)
  let stopped = false
  const stopping = runtime.stop().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false)
  resolveMount({ dispose() { releases++ } })
  await stopping
  assert.equal(releases, 1)

  const rejected = api(() => Promise.reject(Error('Controlled async mount failure'))).create()
  await rejected.start()
  assert.throws(() => rejected.mount({}), /requires refresh and dispose/)
  await rejected.stop()
  await new Promise(resolve => setImmediate(resolve))
})

test('default installed desktop is mounted through the Host and drains owned controllers', async () => {
  let mounts = 0, releases = 0
  const plugins = api(options => { mounts++; assert.equal(options.track, 'track'); return { refresh() {}, dispose() { releases++ } } })
  const runtime = plugins.create()
  await runtime.start()
  runtime.mount({ track: 'track' })
  assert.equal(mounts, 1)
  assert.equal(runtime.catalog()[0].state, 'running')
  await runtime.stop()
  assert.equal(releases, 1)
  assert.equal(runtime.catalog()[0].state, 'stopped')
  assert.throws(() => runtime.mount({}), /not running/)
})

test('an independent factory owns the port without default construction', async () => {
  const plugins = api(() => { throw Error('Default desktop delegation refused') })
  let refreshes = 0, releases = 0
  const replacement = { manifest: { ...plugins.manifest, version: '2.0.0' }, create() {
    return { ports: { [plugins.PORT]: { mount() { return { refresh() { refreshes++ }, dispose() { releases++ } } } } } }
  } }
  const runtime = plugins.create({ replacements: [replacement] })
  await runtime.start()
  runtime.mount({}).refresh()
  assert.equal(refreshes, 1)
  assert.equal(runtime.catalog()[0].manifest.version, '2.0.0')
  await runtime.stop()
  assert.equal(releases, 1)
})

test('pending controller cleanup drains before shutdown completes', async () => {
  let release, attempts = 0
  const plugins = api(() => ({ refresh() {}, dispose() {
    attempts++
    if (attempts === 1) return new Promise(resolve => { release = resolve })
  } }))
  const runtime = plugins.create()
  await runtime.start()
  runtime.mount({})
  const stopping = runtime.stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(runtime.catalog()[0].state, 'stopped')
  assert.throws(() => runtime.mount({}), /not running/)
  release()
  await stopping
  assert.equal(attempts, 1)
})

test('failed controller cleanup retains ownership until an explicit retry', async () => {
  let attempts = 0
  const plugins = api(() => ({ refresh() {}, dispose() {
    if (++attempts === 1) throw Error('Controlled controller release failure')
  } }))
  const runtime = plugins.create()
  await runtime.start()
  runtime.mount({})
  await assert.rejects(runtime.stop(), /retains cleanup ownership/)
  assert.equal(runtime.catalog()[0].state, 'cleanup-failed')
  await assert.rejects(runtime.start(), /still owns resources/)
  await runtime.stop()
  assert.equal(attempts, 2)
  await runtime.start()
  await runtime.stop()
})
