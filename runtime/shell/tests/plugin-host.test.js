'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')

const SOURCE = 'odk:data/source/v1'
const DISPLAY = 'odk:surface/display/v1'

function definition(id, { provides = [], requires = [], permissions = [], create = () => ({}) } = {}) {
  return {
    manifest: { schemaVersion: 1, id: `odk.test.${id}`, name: id, version: '1.0.0', kind: 'service', host: 'electron-main', provides, requires, permissions },
    create,
  }
}

function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

test('starts providers before consumers and stops them in reverse order', async () => {
  const events = []
  const source = { value: 21.4 }
  const host = createPluginHost()
  host.register(definition('consumer', {
    requires: [{ interface: SOURCE }], provides: [{ interface: DISPLAY }],
    create: ctx => {
      assert.equal(ctx.get(SOURCE), source)
      return { ports: { [DISPLAY]: 'view' }, start: () => events.push('consumer:start'), stop: () => events.push('consumer:stop'), destroy: () => events.push('consumer:destroy') }
    },
  }))
  host.register(definition('source', {
    provides: [{ interface: SOURCE }],
    create: () => ({ ports: { [SOURCE]: source }, start: () => events.push('source:start'), stop: () => events.push('source:stop'), destroy: () => events.push('source:destroy') }),
  }))
  await host.start()
  assert.equal(host.get(DISPLAY), 'view')
  await host.stop()
  await host.stop()
  assert.deepEqual(events, ['source:start', 'consumer:start', 'consumer:stop', 'consumer:destroy', 'source:stop', 'source:destroy'])
  assert.equal(host.get(SOURCE), null)
})

test('refuses invalid identities, unsupported schema and duplicate identities', () => {
  const host = createPluginHost()
  assert.throws(() => host.register({ ...definition('bad'), manifest: { ...definition('bad').manifest, id: '../bad' } }), /identity/)
  assert.throws(() => host.register({ ...definition('bad'), manifest: { ...definition('bad').manifest, schemaVersion: 2 } }), /schema/)
  host.register(definition('one'))
  assert.throws(() => host.register(definition('one')), /already registered/)
})

test('rejects missing required ports before creating any resources', async () => {
  let created = 0
  const host = createPluginHost()
  host.register(definition('one', { create: () => { created++; return {} } }))
  host.register(definition('missing', { requires: [{ interface: SOURCE }] }))
  await assert.rejects(host.start(), /missing required port/)
  assert.equal(created, 0)
})

test('rejects duplicate providers and dependency cycles before startup', async () => {
  const duplicate = createPluginHost()
  duplicate.register(definition('one', { provides: [{ interface: SOURCE }] }))
  duplicate.register(definition('two', { provides: [{ interface: SOURCE }] }))
  await assert.rejects(duplicate.start(), /duplicate port/)
  const cycle = createPluginHost()
  cycle.register(definition('one', { provides: [{ interface: SOURCE }], requires: [{ interface: DISPLAY }] }))
  cycle.register(definition('two', { provides: [{ interface: DISPLAY }], requires: [{ interface: SOURCE }] }))
  await assert.rejects(cycle.start(), /dependency cycle/)
})

test('copies declarations so mutation cannot change grants or dependencies', async () => {
  const host = createPluginHost({ capabilities: { ipc: { handle() {} }, secrets: 'private' } })
  const plugin = definition('one', { permissions: ['ipc'], create: ctx => {
    assert.equal(typeof ctx.capability('ipc').handle, 'function')
    assert.throws(() => ctx.capability('secrets'), /undeclared capability/)
    assert.throws(() => ctx.get(SOURCE), /undeclared port/)
    return {}
  } })
  host.register(plugin)
  plugin.manifest.permissions.push('secrets')
  await host.start()
  assert.equal(host.list()[0].state, 'running')
  const listed = host.list()
  listed[0].manifest.permissions.push('secrets')
  assert.deepEqual(host.list()[0].manifest.permissions, ['ipc'])
  await host.stop()
})

test('missing grants fail only that plugin and block its required consumers', async () => {
  let consumerCreated = false
  let optionalSource = 'not-called'
  const errors = []
  const host = createPluginHost({ onError: (id, error) => errors.push([id, error.message]) })
  host.register(definition('denied', { provides: [{ interface: SOURCE }], permissions: ['private-files'] }))
  host.register(definition('required', { requires: [{ interface: SOURCE }], create: () => { consumerCreated = true; return {} } }))
  host.register(definition('optional', { requires: [{ interface: SOURCE, optional: true }], create: ctx => { optionalSource = ctx.get(SOURCE); return {} } }))
  host.register(definition('independent'))
  await host.start()
  assert.equal(consumerCreated, false)
  assert.equal(optionalSource, null)
  assert.deepEqual(host.list().map(entry => entry.state), ['failed', 'blocked', 'running', 'running'])
  assert.match(errors[0][1], /missing capability/)
  await host.stop()
})

test('startup failure cleans partial resources and does not publish ports', async () => {
  const events = []
  const host = createPluginHost()
  host.register(definition('broken', {
    provides: [{ interface: SOURCE }],
    create: ctx => {
      ctx.onCleanup(() => events.push('cleanup'))
      return { ports: { [SOURCE]: 1 }, start() { throw Error('broken') }, stop: () => events.push('stop'), destroy: () => events.push('destroy') }
    },
  }))
  host.register(definition('healthy'))
  await host.start()
  assert.equal(host.get(SOURCE), null)
  assert.equal(host.list()[0].state, 'failed')
  assert.equal(host.list()[1].state, 'running')
  await host.stop()
  assert.deepEqual(events, ['stop', 'destroy', 'cleanup'])
})

test('factory failure releases registered resources', async () => {
  let cleaned = 0
  const host = createPluginHost()
  host.register(definition('broken', { create: ctx => {
    ctx.onCleanup(() => { cleaned++ })
    throw Error('factory failed')
  } }))
  await host.start()
  await host.stop()
  assert.equal(cleaned, 1)
})

test('stop cancels in-flight creation before later plugins can start', async () => {
  const entered = deferred()
  const release = deferred()
  let signal
  let stopped = 0
  let later = 0
  const host = createPluginHost()
  host.register(definition('slow', { create: async ctx => {
    signal = ctx.signal
    entered.resolve()
    await release.promise
    return { stop: () => { stopped++ } }
  } }))
  host.register(definition('later', { create: () => { later++; return {} } }))
  const startup = host.start()
  await entered.promise
  const stopping = host.stop()
  assert.equal(signal.aborted, true)
  release.resolve()
  await Promise.all([startup, stopping])
  assert.equal(stopped, 1)
  assert.equal(later, 0)
})

test('stop cancels in-flight start and cleanup failure does not starve siblings', async () => {
  const entered = deferred()
  const release = deferred()
  const events = []
  let signal
  const host = createPluginHost()
  host.register(definition('one', { create: ctx => {
    ctx.onCleanup(() => events.push('cleanup:one'))
    return { stop: () => events.push('stop:one') }
  } }))
  host.register(definition('two', { create: ctx => {
    signal = ctx.signal
    ctx.onCleanup(() => events.push('cleanup:two'))
    let firstStop = true
    return { start: async () => { entered.resolve(); await release.promise }, stop() { events.push('stop:two'); if (firstStop) { firstStop = false; throw Error('stop failed') } }, destroy: () => events.push('destroy:two') }
  } }))
  const startup = host.start()
  await entered.promise
  const stopping = host.stop()
  assert.equal(signal.aborted, true)
  release.resolve()
  await Promise.all([startup, stopping])
  assert.deepEqual(events, ['stop:two', 'stop:two', 'destroy:two', 'cleanup:two', 'stop:one', 'cleanup:one'])
})

test('disabled plugins do not allocate resources and optional consumers can run', async () => {
  const host = createPluginHost({ disabled: ['odk.test.source'] })
  let created = false
  host.register(definition('source', { provides: [{ interface: SOURCE }], create: () => { created = true; return {} } }))
  host.register(definition('view', { requires: [{ interface: SOURCE, optional: true }], create: ctx => {
    assert.equal(ctx.get(SOURCE), null)
    return {}
  } }))
  await host.start()
  assert.equal(created, false)
  assert.deepEqual(host.list().map(entry => entry.state), ['disabled', 'running'])
  await host.stop()
})

test('disable and enable restart consumers while unrelated instances remain', async () => {
  const host = createPluginHost()
  const events = []
  let generation = 0
  let independent = 0
  const seen = []
  host.register(definition('source', { provides: [{ interface: SOURCE }], create: () => {
    const value = ++generation
    return { ports: { [SOURCE]: value }, stop: () => events.push(`source:${value}`) }
  } }))
  host.register(definition('required', { requires: [{ interface: SOURCE }], create: ctx => {
    const value = ctx.get(SOURCE)
    seen.push(['required', value])
    return { stop: () => events.push(`required:${value}`) }
  } }))
  host.register(definition('optional', { requires: [{ interface: SOURCE, optional: true }], create: ctx => {
    const value = ctx.get(SOURCE)
    seen.push(['optional', value])
    return { stop: () => events.push(`optional:${value}`) }
  } }))
  host.register(definition('independent', { create: () => { independent++; return {} } }))
  await host.start()
  await host.setEnabled('odk.test.source', false)
  assert.equal(host.get(SOURCE), null)
  assert.equal(host.list()[1].state, 'blocked')
  assert.deepEqual(events, ['optional:1', 'required:1', 'source:1'])
  await host.setEnabled('odk.test.source', true)
  assert.deepEqual(seen, [['required', 1], ['optional', 1], ['optional', null], ['required', 2], ['optional', 2]])
  assert.equal(independent, 1)
  assert.equal(host.get(SOURCE), 2)
  await host.stop()
})

test('repeated startup is idempotent and stopped hosts can start again', async () => {
  const host = createPluginHost()
  let created = 0
  host.register(definition('one', { create: () => { created++; return {} } }))
  await Promise.all([host.start(), host.start()])
  assert.equal(created, 1)
  await host.stop()
  await host.start()
  assert.equal(created, 2)
  await host.stop()
})

test('registration changes are rejected while resources are active', async () => {
  const host = createPluginHost()
  host.register(definition('one'))
  await host.start()
  assert.throws(() => host.register(definition('two')), /running/)
  await assert.rejects(host.setEnabled('odk.test.unknown', true), /unknown plugin/)
  await host.stop()
  host.register(definition('two'))
  await host.start()
  assert.equal(host.list().length, 2)
  await host.stop()
})

test('undeclared and absent provided ports fail the plugin', async () => {
  for (const ports of [{ [DISPLAY]: 1 }, {}]) {
    const host = createPluginHost()
    host.register(definition('one', { provides: [{ interface: SOURCE }], create: () => ({ ports }) }))
    await host.start()
    assert.equal(host.list()[0].state, 'failed')
    assert.equal(host.get(SOURCE), null)
    await host.stop()
  }
})

test('repeated disable does not cancel optional consumers that already restarted', async () => {
  const signals = []
  const host = createPluginHost()
  host.register(definition('source', { provides: [{ interface: SOURCE }], create: () => ({ ports: { [SOURCE]: 1 } }) }))
  host.register(definition('optional', { requires: [{ interface: SOURCE, optional: true }], create: ctx => { signals.push(ctx.signal); return {} } }))
  await host.start()
  await host.setEnabled('odk.test.source', false)
  assert.equal(signals.length, 2)
  assert.equal(signals[1].aborted, false)
  await host.setEnabled('odk.test.source', false)
  assert.equal(signals[1].aborted, false)
  assert.equal(host.list()[1].state, 'running')
  await host.stop()
})

test('a queued restart locks registrations while its new resources are running', async () => {
  const host = createPluginHost()
  host.register(definition('one'))
  await host.start()
  const stopping = host.stop()
  const restarting = host.start()
  await Promise.all([stopping, restarting])
  assert.equal(host.list()[0].state, 'running')
  assert.throws(() => host.register(definition('two')), /running/)
  await host.stop()
})

test('a queued disable cancels the preceding enable before it can allocate resources', async () => {
  let created = 0
  const host = createPluginHost({ disabled: ['odk.test.one'] })
  host.register(definition('one', { create: () => { created++; return {} } }))
  await host.start()
  const enabling = host.setEnabled('odk.test.one', true)
  const disabling = host.setEnabled('odk.test.one', false)
  await Promise.all([enabling, disabling])
  assert.equal(created, 0)
  assert.equal(host.list()[0].state, 'disabled')
  assert.equal(host.list()[0].enabled, false)
  await host.stop()
})

test('failed stop retains ownership and retries before destructive cleanup', async () => {
  const host = createPluginHost()
  const events = []
  let fail = true
  let created = 0
  host.register(definition('retained', { create: ctx => {
    created++
    ctx.onCleanup(() => events.push('cleanup'))
    return { stop() { events.push('stop'); if (fail) throw Error('busy') }, destroy() { events.push('destroy') } }
  } }))
  host.register(definition('independent', { create: () => ({ stop: () => events.push('independent') }) }))
  await host.start()
  await host.stop()
  assert.deepEqual(events, ['independent', 'stop'])
  assert.equal(host.list()[0].state, 'cleanup-failed')
  assert.throws(() => host.register(definition('late')), /resources|running/)
  await assert.rejects(host.start(), /resources/)
  assert.equal(created, 1)
  fail = false
  await host.stop()
  await host.stop()
  assert.deepEqual(events, ['independent', 'stop', 'stop', 'destroy', 'cleanup'])
  await host.start()
  assert.equal(created, 2)
  await host.stop()
})

test('failed cleanup retains providers and retries only incomplete operations', async () => {
  const host = createPluginHost()
  const events = []
  const source = {}
  let consumerContext
  let fail = true
  host.register(definition('source', { provides: [{ interface: SOURCE }], create: () => ({ ports: { [SOURCE]: source }, stop: () => events.push('provider') }) }))
  host.register(definition('consumer', { requires: [{ interface: SOURCE }], create: ctx => {
    consumerContext = ctx
    ctx.onCleanup(() => events.push('successful'))
    ctx.onCleanup(() => {
      assert.equal(ctx.get(SOURCE), source)
      events.push('retryable')
      if (fail) throw Error('resource busy')
    })
    return { stop: () => events.push('stop'), destroy: () => events.push('destroy') }
  } }))
  await host.start()
  await host.stop()
  assert.deepEqual(events, ['stop', 'destroy', 'retryable', 'successful'])
  assert.equal(host.get(SOURCE), null)
  assert.equal(consumerContext.get(SOURCE), null)
  assert.deepEqual(host.list().map(entry => entry.state), ['cleanup-blocked', 'cleanup-failed'])
  fail = false
  await host.stop()
  assert.deepEqual(events, ['stop', 'destroy', 'retryable', 'successful', 'retryable', 'provider'])
  await host.stop()
  assert.equal(events.length, 6)
})

test('same-value enable retries a transient factory failure', async () => {
  const host = createPluginHost()
  let attempts = 0
  host.register(definition('transient', { create: () => { if (++attempts === 1) throw Error('transient'); return {} } }))
  await host.start()
  await host.setEnabled('odk.test.transient', true)
  assert.equal(attempts, 2)
  assert.equal(host.list()[0].state, 'running')
  await host.stop()
})

test('destroy retry skips completed stop and cannot restart unrelated plugins', async () => {
  const host = createPluginHost()
  const events = []
  let fail = true
  let independent = 0
  host.register(definition('retained', { create: () => ({ stop: () => events.push('stop'), destroy() { events.push('destroy'); if (fail) throw Error('busy') } }) }))
  host.register(definition('independent', { create: () => { independent++; return {} } }))
  await host.start()
  await host.setEnabled('odk.test.retained', false)
  await host.setEnabled('odk.test.independent', true)
  assert.equal(independent, 1)
  fail = false
  await host.setEnabled('odk.test.retained', false)
  assert.deepEqual(events, ['stop', 'destroy', 'destroy'])
  await host.stop()
})
