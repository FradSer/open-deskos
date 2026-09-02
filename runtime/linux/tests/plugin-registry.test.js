const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync('src/renderer/core/registry.js', 'utf8')

function createRegistry() {
  const root = {}
  vm.runInContext(source, vm.createContext({ window: root, globalThis: root }))
  return root.odkPlugins
}

test('rejects plugins without a schema-versioned manifest', () => {
  const registry = createRegistry()
  assert.throws(() => registry.register({ id: 'odk.tile.unversioned', kind: 'tile', mount() {} }), /requires manifest schema version 1/)
})

test('validates universal manifest v1 kinds, provides, requires, and permissions', () => {
  const registry = createRegistry()
  assert.throws(() => registry.register({
    id: 'odk.invalid.kind',
    manifest: { schemaVersion: 1 },
    kind: 'non-existent-kind',
    mount() {},
  }), /supported kind/)

  assert.throws(() => registry.register({
    id: 'odk.invalid.provides',
    manifest: {
      schemaVersion: 1,
      provides: 'not-an-array',
    },
    kind: 'service',
  }), /manifest.provides must be an array/)

  assert.throws(() => registry.register({
    id: 'odk.invalid.requires',
    manifest: {
      schemaVersion: 1,
      requires: 'not-an-array',
    },
    kind: 'service',
  }), /manifest.requires must be an array/)

  assert.throws(() => registry.register({
    id: 'odk.invalid.permissions',
    manifest: {
      schemaVersion: 1,
      permissions: 'not-an-array',
    },
    kind: 'service',
  }), /manifest.permissions must be an array/)

  assert.doesNotThrow(() => registry.register({
    id: 'odk.service.sample',
    manifest: {
      schemaVersion: 1,
      provides: [{ interface: 'odk.sample/v1' }],
      requires: [{ interface: 'odk.required/v1', optional: true }],
      permissions: ['hardware:serial:by-id'],
    },
    kind: 'service',
  }))
})


test('runs uninstall and clears enabled state when disable fails', () => {
  const registry = createRegistry()
  const events = []
  registry.register({
    id: 'odk.tile.faulty',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    mount() {},
    lifecycle: {
      disable() { events.push('disable'); throw new Error('disable failed') },
      uninstall() { events.push('uninstall') },
    },
  })

  registry.activate(registry.get('odk.tile.faulty'), {}, { onTick: () => () => {} })
  assert.throws(() => registry.retire(registry.get('odk.tile.faulty'), null, {}), /disable failed/)
  assert.deepEqual(events, ['disable', 'uninstall'])

  assert.equal(registry.isEnabled('odk.tile.faulty'), false)
})

test('cleans subscriptions when mounted plugin is deactivated', () => {
  const registry = createRegistry()
  let ticks = 0
  let unsubscribeCalls = 0
  const host = {}
  registry.register({
    id: 'odk.tile.ticker',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    mount(_el, ctx) { ctx.onTick(() => { ticks += 1 }) },
  })
  const context = {
    onTick(callback) {
      callback()
      return () => { unsubscribeCalls += 1 }
    },
  }
  const plugin = registry.get('odk.tile.ticker')
  registry.activate(plugin, host, context)
  assert.equal(ticks, 1)
  registry.deactivate(plugin, host, context)
  assert.equal(unsubscribeCalls, 1)
})
