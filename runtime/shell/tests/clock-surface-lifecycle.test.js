'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')
const id = 'odk.tile.clock'

async function fixture(t, independent, failRelease = false) {
  const root = { odkPluginHost: { createPluginHost } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  for (const file of ['core/registry.js', 'plugins/clock.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  let selected
  if (independent) {
    root.odkRendererDevelopment = { define(definition) { selected = definition } }
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/clock-surface-replacement/entry.js'), 'utf8'), context)
    root.odkPlugins.get(id).lifecycle.mount = () => { throw Error('Default Clock delegation refused') }
  }
  let peerStarts = 0
  root.odkPlugins.register({ id: 'odk.tile.clock-peer', kind: 'tile', manifest: { schemaVersion: 1 },
    create() { peerStarts++; return {} }, mount() {} })
  await root.odkPlugins.start({ replacements: selected ? [selected] : [] })
  const ticks = new Set()
  let releases = 0
  const ui = { onTick(callback) {
    ticks.add(callback)
    callback(new Date(2026, 0, 1, 0, 0))
    return () => {
      releases++
      if (failRelease && releases === 1) throw Error('Controlled Tick release failure')
      ticks.delete(callback)
    }
  } }
  let writes = 0
  let text = '--:--'
  const time = { dateTime: '', get textContent() { return text }, set textContent(value) { writes++; text = value } }
  const element = { isConnected: true, innerHTML: '', querySelector: () => time,
    replaceChildren() { text = '--:--'; time.dateTime = '' } }
  const registry = root.odkPlugins
  assert.equal(registry.activate(registry.get(id), element, ui), true)
  t.after(() => registry.stop())
  return { registry, element, time, ticks, selected, ui, writes: () => writes, releases: () => releases,
    peers: () => peerStarts, tick(date) { for (const callback of ticks) callback(date) } }
}

for (const independent of [false, true]) {
  const prefix = independent ? 'independent' : 'default'
  test(`${prefix} Clock preserves local time, rollover, backward changes, and stable minute writes`, async t => {
    const f = await fixture(t, independent)
    for (const [hours, minutes] of [[0, 0], [9, 5], [23, 59], [0, 0], [12, 34], [8, 1]]) {
      f.tick(new Date(2026, 0, 1, hours, minutes, 0))
      const expected = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
      assert.equal(f.time.textContent, expected)
      assert.equal(f.time.dateTime, expected)
      const writes = f.writes()
      f.tick(new Date(2026, 0, 1, hours, minutes, 59))
      assert.equal(f.writes(), writes)
    }
    await f.registry.setEnabled(id, false)
    assert.equal(f.ticks.size, 0)
    await f.registry.setEnabled(id, true)
    assert.equal(f.ticks.size, 1)
    assert.equal(f.time.textContent, '00:00')
    assert.equal(f.peers(), 1)
    await f.registry.stop()
    assert.equal(f.ticks.size, 0)
  })

  test(`${prefix} Clock retains a failed subscription release and retries before restart`, async t => {
    const f = await fixture(t, independent, true)
    await f.registry.setEnabled(id, false)
    assert.equal(f.ticks.size, 1)
    assert.equal(f.registry.catalog().find(record => record.manifest.id === id).state, 'cleanup-failed')
    assert.equal(f.registry.activate(f.registry.get(id), {}, f.ui), false)
    await f.registry.setEnabled(id, false)
    assert.equal(f.ticks.size, 0)
    assert.equal(f.releases(), 2)
    await f.registry.setEnabled(id, true)
    assert.equal(f.ticks.size, 1)
    assert.equal(f.peers(), 1)
  })
}
