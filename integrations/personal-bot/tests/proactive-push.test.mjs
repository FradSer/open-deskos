import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProactiveWatch } from '../src/proactive.mjs'
import { PersonalBotService } from '../src/service.mjs'
import { listen } from '../src/socket.mjs'
const require = createRequire(import.meta.url)
const { createPersonalBotClient } = require('../../../runtime/linux/src/personal-bot-client.js')
const { createHydraStore } = require('../../../runtime/linux/src/hydra-mqtt.js')
const { createShellDeskData } = require('../../../runtime/linux/src/desk-data.js')
const { createDeskDataRegistry } = require('../../../runtime/linux/src/desk-data-registry.js')
const stamp = Date.parse('2026-10-02T10:00:00Z')
const until = async predicate => { const begin = Date.now(); while (!predicate()) { if (Date.now()-begin>5000) throw Error('fixture timed out'); await new Promise(resolve=>setTimeout(resolve,20)) } }

test('real Hydra update -> authenticated Shell client -> source reread -> Jev push judgment', { skip: process.platform === 'win32' }, async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-jev-push-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let client
  const store = createHydraStore({ onUpdate: () => client?.servicePush(['odk.tile.hydra']) })
  store.markConnected(true)
  for (const [topic,value] of [['main/online','true'],['main/env','v=1;t=26;h=50;p=1000;l=0'],['node1/online','true'],['node1/soil','60']]) store.applyMessage('hydra/'+topic,value,stamp)
  const registry = createShellDeskData({ hydra: { snapshot: () => store.snapshot(stamp) } }).registry
  const service = new PersonalBotService({ record: async () => { throw Error('no audio') }, transcribe: async () => '', prompt: async () => '' })
  const requests = []
  const watch = new ProactiveWatch({ config: { version: 1, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, suppressed: [], snoozed: {}, rules: [{ id: 'soil', delivery: 'immediate', urgent: false, advice: '检查盆土。', conditions: [{ readingId: 'odk.tile.hydra', field: 'plants.0.soilPercent', measuredAtField: 'plants.0.measuredAt', op: 'lt', value: 15 }] }] },
    now: () => stamp, read: async id => (await registry.read(id)).reading, judge: async input => { requests.push(input); return { model: 'jev-fixture', answers: { c0: { probability: input.candidates[0].evidence[0].value < 15 ? 0.95 : 0.05, threshold: 0.8 } } } },
    publish: frame => service.propose(frame), save: async () => {}, phrase: async ({ advice }) => advice, execute: async () => assert.fail('push cannot execute'),
  })
  service.attachWatch(watch)
  const endpoint = join(dir, 'voice', 'agent.sock'), server = await listen(endpoint,service)
  t.after(async () => { client.stop(); await watch.close(); await service.close(); await server.close() })
  client = createPersonalBotClient({ socketPath: endpoint }); client.start()
  await until(() => client.snapshot().state === 'idle')
  await watch.tick(); assert.equal(watch.list().length,0)
  store.applyMessage('hydra/node1/soil','5',stamp)
  await until(() => requests.length === 2 && watch.list().length === 1)
  assert.equal(requests[1].trigger.kind,'service_push'); assert.equal(watch.list()[0].evidence[0].value,5)
  assert.equal(watch.list()[0].judgment.model,'jev-fixture'); assert.equal(service.status.transcript,'')
})

test('only committed declared package values emit source updates', () => {
  const ids = [], registry = createDeskDataRegistry({ onPublish: id => ids.push(id) })
  registry.register({ id:'test.app', label:'test', kind:'package', declaration:{fields:{ soil:{type:'number'} }} })
  assert.equal(registry.publish('test.app',{ advice:'run tools' }).ok,false); assert.deepEqual(ids,[])
  assert.equal(registry.publish('test.app',{ soil:10 }).ok,true); assert.deepEqual(ids,['test.app'])
})
