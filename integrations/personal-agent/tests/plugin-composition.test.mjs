import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPersonalAgentComposition, personalAgentManifest, validatePersonalAgentReplacement, BOT_PORTS } from '../src/plugin-composition.mjs'

function fixture({ failInitialize = false, initialize, failClose = false } = {}) {
  const events = []
  const errors = []
  const service = { close: async () => { events.push('service.close'); if (failClose) throw Error('service failure') } }
  const runtime = { agent: { abort: async () => { events.push('agent.abort') }, close: async () => { events.push('agent.close') } } }
  const composition = createPersonalAgentComposition({
    createService: () => service,
    openChannel: async () => { events.push('channel.open'); return { close: async () => { events.push('channel.close') } } },
    initialize: initialize || (async () => { events.push('agent.initialize'); if (failInitialize) throw Error('configuration failure'); return runtime }),
    createHome: () => ({ start: () => events.push('home.start'), close: () => events.push('home.close') }),
    createWatch: () => ({ start: () => events.push('watch.start'), close: () => events.push('watch.close') }),
    onError: id => errors.push(id),
  })
  return { composition, events, errors, runtime, recoverClose() { failClose = false } }
}

test('runtime disable and restart retain the resident service and channel', async () => {
  const events = []
  let initialized = 0
  const service = { close: async () => events.push('service.close'), suspend: async () => events.push('service.suspend'), resume: async () => events.push('service.resume') }
  const composition = createPersonalAgentComposition({ createService: () => service,
    openChannel: async () => ({ close: async () => events.push('channel.close') }),
    initialize: async () => { initialized++; return { agent: { abort: async () => events.push('agent.abort'), close: async () => events.push('agent.close') } } },
  })
  await composition.start()
  const channel = composition.port(BOT_PORTS.channel)
  events.length = 0
  await composition.setEnabled('odk.personal-agent.runtime', false)
  assert.deepEqual(events, ['agent.abort', 'service.suspend', 'agent.close'])
  assert.equal(composition.port(BOT_PORTS.service), service)
  assert.equal(composition.port(BOT_PORTS.channel), channel)
  assert.equal(composition.port(BOT_PORTS.runtime), null)
  await composition.setEnabled('odk.personal-agent.runtime', true)
  assert.equal(initialized, 2)
  assert.equal(composition.port(BOT_PORTS.channel), channel)
  assert.equal(composition.port(BOT_PORTS.service), service)
  await composition.stop()
  assert.deepEqual(events.slice(-4), ['channel.close', 'agent.abort', 'service.close', 'agent.close'])
})

test('legacy resident providers reject partial teardown before changing their graph', async () => {
  for (const id of ['odk.personal-agent.service', 'odk.personal-agent.channel', 'odk.personal-agent.runtime']) {
    const { composition, events } = fixture()
    await composition.start()
    const before = [...events]
    await assert.rejects(composition.setEnabled(id, false), /does not support runtime suspension/)
    assert.deepEqual(events, before)
    assert.ok(composition.catalog().every(plugin => plugin.state === 'running'))
    await composition.stop()
  }
})

test('configuration failure preserves service and resident channel', async () => {
  const { composition, events } = fixture({ failInitialize: true })
  await composition.start()
  assert.ok(composition.port(BOT_PORTS.service))
  assert.ok(composition.port(BOT_PORTS.channel))
  assert.equal(composition.port(BOT_PORTS.runtime), null)
  assert.deepEqual(events, ['channel.open', 'agent.initialize'])
  await composition.stop()
})

for (const failClose of [false, true]) {
  test(`shutdown owns every resource once and preserves order with cleanup failure=${failClose}`, async () => {
    const { composition, events } = fixture({ failClose })
    await composition.start()
    await composition.start()
    assert.ok(composition.catalog().every(entry => entry.state === 'running'))
    if (failClose) {
      await assert.rejects(composition.stop(), /shutdown failed/)
      await assert.rejects(composition.stop(), /shutdown failed/)
    } else {
      await composition.stop()
      await composition.stop()
    }
    assert.deepEqual(events, ['channel.open', 'agent.initialize', 'home.start', 'watch.start', 'home.close', 'watch.close', 'channel.close', 'agent.abort', 'service.close', 'agent.close', ...(failClose ? ['service.close'] : [])])
  })
}

test('failed Personal Agent cleanup can recover without repeating completed cleanup', async () => {
  const { composition, events, recoverClose } = fixture({ failClose: true })
  await composition.start()
  await assert.rejects(composition.stop(), /shutdown failed/)
  recoverClose()
  await composition.stop()
  await composition.stop()
  assert.equal(events.filter(event => event === 'service.close').length, 2)
  assert.equal(events.filter(event => event === 'agent.close').length, 1)
  assert.equal(events.filter(event => event === 'channel.close').length, 1)
  assert.ok(composition.catalog().every(entry => entry.state === 'stopped'))
})

test('late initialization is cleaned without starting dependent features', async () => {
  let finish
  let entered
  const ready = new Promise(resolve => { entered = resolve })
  const delayed = new Promise(resolve => { finish = resolve })
  const { composition, events, runtime } = fixture({ initialize: async () => { entered(); return delayed } })
  const starting = composition.start()
  await ready
  const stopping = composition.stop()
  finish(runtime)
  await Promise.all([starting, stopping])
  assert.deepEqual(events, ['channel.open', 'channel.close', 'agent.abort', 'service.close', 'agent.close'])
})

test('briefing cancellation precedes a delayed suggestion shutdown', async () => {
  const events = []
  let finish
  let entered
  const pending = new Promise(resolve => { finish = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const composition = createPersonalAgentComposition({
    createService: () => ({ close() {} }),
    openChannel: async () => ({ close() {} }),
    initialize: async () => ({ agent: { abort() {}, close() {} } }),
    createHome: () => ({ start() {}, close() { events.push('home.close') } }),
    createWatch: () => ({ start() {}, close() { entered(); return pending } }),
  })
  await composition.start()
  const stopping = composition.stop()
  await ready
  const beforeRelease = [...events]
  finish()
  await stopping
  assert.deepEqual(beforeRelease, ['home.close'])
})


test('default Watch does not depend on Overview lifecycle', async () => {
  const { composition } = fixture()
  await composition.start()
  try {
    const watch = composition.port(BOT_PORTS.watch)
    const runtime = composition.port(BOT_PORTS.runtime)
    await composition.setEnabled('odk.personal-agent.home', false)
    assert.equal(composition.port(BOT_PORTS.watch), watch)
    assert.equal(composition.port(BOT_PORTS.runtime), runtime)
    assert.equal(composition.port(BOT_PORTS.home), null)
    await composition.setEnabled('odk.personal-agent.home', true)
    assert.equal(composition.port(BOT_PORTS.watch), watch)
  } finally { await composition.stop() }
})


test('legacy Watch replacements retain the original Home dependency contract', async () => {
  const manifest = personalAgentManifest('watch', { legacy: true })
  assert.equal(manifest.version, '1.0.0')
  assert.ok(manifest.requires.some(port => port.interface === BOT_PORTS.home))
  validatePersonalAgentReplacement(manifest)
  const composition = createPersonalAgentComposition({
    createService: () => ({ close() {} }), openChannel: async () => ({ close() {} }),
    initialize: async () => ({ agent: { abort() {}, close() {} } }),
    createHome: () => ({ start() {}, close() {} }), createWatch: () => { throw Error('default must not execute') },
    replacementPlugins: [{ manifest, create: () => ({ start() {}, close() {} }) }],
  })
  await composition.start()
  try {
    assert.ok(composition.port(BOT_PORTS.watch))
    await composition.setEnabled('odk.personal-agent.home', false)
    assert.equal(composition.port(BOT_PORTS.watch), null)
    assert.equal(composition.catalog().find(plugin => plugin.manifest.id === manifest.id).state, 'blocked')
  } finally { await composition.stop() }
})
