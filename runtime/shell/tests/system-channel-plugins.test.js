'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { selectIndependentCoordinators } = require('./fixtures/service-coordinator-replacements')
const { createSystemChannelPlugins, SYSTEM_PORTS } = require('../src/plugins/system-channels')

function fixture({ smokeMode = false, independent = false } = {}) {
  const handlers = new Map()
  const broadcasts = []
  const callbacks = new Map()
  const calls = []
  const frames = new Set()
  let state = 'idle'
  let connected = true
  const bot = {
    subscribe: cb => { callbacks.set('bot', cb); return () => callbacks.delete('bot') },
    snapshot: () => ({ state }),
    servicePush: ids => { calls.push(ids); return true },
    toggle: () => { calls.push('toggle'); return connected },
    proposalCommand: request => { calls.push(request); return connected },
    start: () => calls.push('bot:start'), stop: () => calls.push('bot:stop'),
  }
  let currentBot = bot
  const instances = { bot: [], remote: [] }
  const remote = {
    onLinkState: cb => { callbacks.set('link', cb); cb('disconnected'); return () => callbacks.delete('link') },
    onNavigation: cb => { callbacks.set('navigation', cb); return () => callbacks.delete('navigation') },
    onInput: cb => { callbacks.set('input', cb); return () => callbacks.delete('input') },
    getLinkState: () => 'disconnected',
    publishPageState: value => { calls.push(value); return true },
    start: () => calls.push('remote:start'), stop: () => calls.push('remote:stop'),
  }
  let currentRemote = remote
  const apps = { list: () => [{ appId: 'calendar' }], get: id => ({ appId: id }), dispatch: intent => ({ ok: true, intent }) }
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'shell.frames': { subscribe: callback => { frames.add(callback); return () => frames.delete(callback) } },
    broadcast: (name, value) => broadcasts.push([name, value]),
    'system.personal-agent': { create: () => { instances.bot.push(currentBot); return currentBot }, options: { socketPath: null }, smokeMode },
    'system.remote-link': { create: options => { callbacks.set('mic', options.onRemoteMic); instances.remote.push(currentRemote); return currentRemote }, options: { socketPath: null }, smokeMode },
    'system.app-manager': { create: () => apps },
  } })
  const definitions = createSystemChannelPlugins()
  for (const plugin of independent ? selectIndependentCoordinators(definitions) : definitions) host.register(plugin)
  return { host, handlers, broadcasts, callbacks, calls, bot, remote, instances, apps, frames, setBot: value => { currentBot = value }, setRemote: value => { currentRemote = value }, setState: value => { state = value }, setConnected: value => { connected = value } }
}

for (const [kind, id] of [['bot', 'odk.system.personal-agent'], ['remote', 'odk.transport.remote-link']]) {
  for (const asynchronous of [false, true]) {
    test(`${kind} retries ${asynchronous ? 'rejected' : 'throwing'} client stop before replacement`, async t => {
      const f = fixture()
      t.after(() => f.host.stop())
      let failed = true
      let attempts = 0
      const stop = () => { attempts++; if (failed) throw Error('controlled stop failure') }
      f[kind].stop = asynchronous ? async () => stop() : stop
      await f.host.start()
      const replacement = { ...f[kind], stop() {} }
      if (kind === 'bot') f.setBot(replacement)
      else f.setRemote(replacement)
      await f.host.setEnabled(id, false)
      assert.equal(f.host.list().find(record => record.manifest.id === id).state, 'cleanup-failed')
      await f.host.setEnabled(id, true)
      assert.equal(attempts, 2, 'cleanup must retry the actual client operation')
      assert.equal(f.instances[kind].length, 1, 'retained client must prevent replacement')
      const independent = kind === 'bot' ? 'odk.transport.remote-link' : 'odk.system.personal-agent'
      assert.equal(f.host.list().find(record => record.manifest.id === independent).state, 'running')
      failed = false
      await f.host.setEnabled(id, true)
      assert.equal(attempts, 3)
      assert.equal(f.instances[kind].length, 2)
      await f.host.stop()
      assert.equal(attempts, 3, 'registered cleanup must not repeat successful client stop')
    })
  }
}

test('default system plugins preserve Remote events and App manager endpoints', async () => {
  const f = fixture()
  await f.host.start()
  assert.equal(f.host.get(SYSTEM_PORTS.personalAgent), f.bot)
  assert.equal(f.host.get(SYSTEM_PORTS.appManager), f.apps)
  f.callbacks.get('navigation')('right')
  f.callbacks.get('input')('primary')
  f.callbacks.get('mic')()
  assert.deepEqual(f.broadcasts, [
    ['odk-remote-link-state', { state: 'disconnected', sequence: 1 }],
    ['odk-remote-navigation', { direction: 'right' }], ['odk-remote-input', { input: 'primary' }],
    ['odk-personal-agent-mic', undefined],
  ])
  assert.deepEqual(f.handlers.get('odk-remote-link-state')(), { state: 'disconnected', sequence: 1 })
  assert.equal(f.handlers.get('odk-remote-publish-page-state')(null, { page: 'home' }), true)
  assert.deepEqual(f.handlers.get('odk-app-manager-list')(), [{ appId: 'calendar' }])
  assert.deepEqual(f.handlers.get('odk-app-manager-state')(null, 'calendar'), { appId: 'calendar' })
  assert.deepEqual(f.handlers.get('odk-app-manager-intent')(null, { type: 'open-app' }), { ok: true, intent: { type: 'open-app' } })
  await f.host.stop()
  assert.equal(f.handlers.size, 0)
  assert.deepEqual([...f.callbacks.keys()], ['mic'])
  assert.deepEqual(f.calls.filter(value => typeof value === 'string'), ['bot:start', 'remote:start', 'remote:stop', 'bot:stop'])
})

test('Personal Agent preserves busy, pending, and stale acknowledgement guards', async () => {
  const f = fixture()
  const current = { agents: { state: 'live', tasks: [{ taskId: 'fixture-child', state: 'running' }] }, transcript: 'Current input', activated: true }
  f.bot.snapshot = () => ({ ...current, state: 'idle' })
  await f.host.start()
  f.broadcasts.length = 0
  const toggle = f.handlers.get('odk-personal-agent-toggle')
  assert.deepEqual(toggle(), { accepted: true })
  assert.equal(f.broadcasts[0][1].state, 'starting')
  assert.deepEqual(f.broadcasts[0][1].agents, current.agents)
  assert.equal(f.broadcasts[0][1].transcript, current.transcript)
  assert.equal(f.broadcasts[0][1].activated, true)
  f.bot.snapshot = () => ({ ...current, state: 'recording' })
  assert.deepEqual(toggle(), { accepted: false })
  f.callbacks.get('bot')({ state: 'idle' })
  assert.equal(f.broadcasts.length, 1)
  f.setState('recording')
  f.callbacks.get('bot')({ state: 'recording' })
  assert.deepEqual(toggle(), { accepted: true })
  assert.equal(f.broadcasts.at(-1)[1].state, 'sending')
  assert.deepEqual(f.broadcasts.at(-1)[1].agents, current.agents)
  f.bot.snapshot = () => ({ ...current, state: 'thinking' })
  const count = f.broadcasts.length
  f.callbacks.get('bot')({ state: 'recording' })
  assert.equal(f.broadcasts.length, count)
  f.setState('thinking')
  f.callbacks.get('bot')({ state: 'thinking' })
  assert.deepEqual(toggle(), { accepted: false })
  f.setState('unavailable')
  f.bot.snapshot = () => ({ state: 'unavailable', agents: { state: 'unavailable', tasks: [] } })
  f.setConnected(false)
  f.callbacks.get('bot')({ state: 'unavailable' })
  assert.deepEqual(toggle(), { accepted: false })
  assert.equal(f.broadcasts.at(-1)[1].activated, true)
  await f.host.stop()
})

test('proposal validation remains bounded at the same IPC boundary', async () => {
  const f = fixture()
  await f.host.start()
  const proposal = f.handlers.get('odk-personal-agent-proposal')
  for (const request of [null, { type: 'unknown' }, { type: 'proposal_respond', id: 'short', decision: 'accept' }, { type: 'proposal_presented', ids: ['short'] }, { type: 'proposal_list', text: 'x'.repeat(4096) }]) {
    assert.deepEqual(proposal(null, request), { accepted: false })
  }
  assert.deepEqual(proposal(null, { type: 'proposal_list' }), { accepted: true })
  assert.deepEqual(proposal(null, { type: 'proposal_respond', id: 'a'.repeat(36), decision: 'ignore' }), { accepted: true })
  assert.deepEqual(f.calls.filter(value => typeof value === 'object'), [{ type: 'proposal_list' }, { type: 'proposal_respond', id: 'a'.repeat(36), decision: 'ignore' }])
  await f.host.stop()
})

test('smoke composition does not start optional clients', async () => {
  const f = fixture({ smokeMode: true })
  await f.host.start()
  assert.deepEqual(f.calls, [])
  assert.equal(f.handlers.has('odk-personal-agent-status'), true)
  assert.equal(f.handlers.has('odk-remote-link-state'), true)
  await f.host.stop()
})


for (const independent of [false, true]) {
test(`${independent ? 'independent' : 'default'} notification plugin forwards unchanged identities and becomes inert on disable`, async () => {
  const f = fixture({ independent })
  await f.host.start()
  const forwarder = f.host.get(SYSTEM_PORTS.serviceNotifications)
  const ids = ['odk.tile.weather']
  assert.equal(forwarder.publish(ids), true)
  assert.equal(f.calls.at(-1), ids)
  await f.host.setEnabled('odk.system.service-notifications', false)
  assert.equal(f.host.get(SYSTEM_PORTS.personalAgent), f.bot)
  const count = f.calls.length
  assert.equal(forwarder.publish(ids), undefined)
  assert.equal(f.calls.length, count)
  await f.host.setEnabled('odk.system.service-notifications', true)
  assert.notEqual(f.host.get(SYSTEM_PORTS.serviceNotifications), forwarder)
  assert.equal(f.host.get(SYSTEM_PORTS.serviceNotifications).publish(ids), true)
  await f.host.setEnabled('odk.system.personal-agent', false)
  assert.equal(f.host.get(SYSTEM_PORTS.serviceNotifications).publish(ids), undefined)
  const replacement = { ...f.bot, servicePush: values => { f.calls.push(['replacement', values]); return false } }
  f.setBot(replacement)
  await f.host.setEnabled('odk.system.personal-agent', true)
  assert.equal(f.host.get(SYSTEM_PORTS.personalAgent), replacement)
  assert.equal(f.host.get(SYSTEM_PORTS.serviceNotifications).publish(ids), false)
  await f.host.stop()
})

test(`${independent ? 'independent' : 'default'} frame status preserves broadcast destinations, fallbacks, and cleanup`, async () => {
  const f = fixture({ independent })
  await f.host.start()
  const sends = []
  const frame = { send: (channel, payload) => sends.push([channel, payload]) }
  f.broadcasts.length = 0
  assert.equal(f.frames.size, 1)
  const initial = [...f.frames][0]
  initial(frame)
  assert.deepEqual(f.broadcasts, [['odk-personal-agent-status', { state: 'idle' }]])
  assert.deepEqual(sends, [['odk-remote-link-state', { state: 'disconnected', sequence: 1 }]])
  await f.host.setEnabled('odk.system.personal-agent', false)
  await f.host.setEnabled('odk.transport.remote-link', false)
  f.broadcasts.length = 0
  sends.length = 0
  for (const callback of f.frames) callback(frame)
  assert.deepEqual(f.broadcasts, [['odk-personal-agent-status', { state: 'unavailable' }]])
  assert.deepEqual(sends, [['odk-remote-link-state', { state: 'disconnected', sequence: 0 }]])
  await f.host.setEnabled('odk.system.personal-agent', true)
  f.setState('thinking')
  f.broadcasts.length = 0
  for (const callback of f.frames) callback(frame)
  assert.deepEqual(f.broadcasts, [['odk-personal-agent-status', { state: 'thinking' }]])
  await f.host.setEnabled('odk.transport.remote-link', true)
  sends.length = 0
  for (const callback of f.frames) callback(frame)
  assert.deepEqual(sends, [['odk-remote-link-state', { state: 'disconnected', sequence: 1 }]])
  await f.host.setEnabled('odk.system.frame-status', false)
  assert.equal(f.frames.size, 0)
  const count = f.broadcasts.length
  initial(frame)
  assert.equal(f.broadcasts.length, count)
  await f.host.setEnabled('odk.system.frame-status', true)
  assert.equal(f.frames.size, 1)
  await f.host.stop()
  assert.equal(f.frames.size, 0)
})

}


test('session replies retain exact references across the system channel and refuse extra authority',async()=>{
 const f=fixture();const sent=[]
 f.bot.sendText=async(...args)=>{sent.push(args);return true}
 await f.host.start()
 try {
  const send=f.handlers.get('odk-personal-agent-text')
  const reference={messageId:'a'.repeat(64),sourceKey:'b'.repeat(64),sourceRevision:'c'.repeat(64)}
  assert.deepEqual(await send(null,'继续',reference),{accepted:true})
  assert.deepEqual(sent,[['继续',reference]])
  assert.deepEqual(await send(null,'Untrusted',{...reference,target:'mac'}),{accepted:false})
  assert.equal(sent.length,1)
  assert.deepEqual(await send(null,'Ordinary'),{accepted:true})
  assert.deepEqual(sent.at(-1),['Ordinary'])
 } finally {await f.host.stop()}
})
