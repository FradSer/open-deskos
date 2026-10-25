import test from 'node:test'
import assert from 'node:assert/strict'
import { createRidePreview } from '../src/didi/preview.mjs'

test('Given mixed-city and ambiguous real places, preview never guesses or mutates an order', async () => {
  const calls = []; let now = 10
  const preview = createRidePreview({ now: () => now, call: async (name, args) => {
    calls.push(name)
    if (name === 'maps_textsearch') return [{ display_name: args.keywords + '甲', city: '测试市', location: { lng: 1, lat: 2 } }, { display_name: '异地门店', city: '另一市', location: { lng: 3, lat: 4 } }, { display_name: args.keywords + '乙', city: '测试市', location: { lng: 5, lat: 6 } }]
    if (name === 'taxi_estimate') return { traceId: 'trace', items: [{ productName: '快车', productCategory: '1', priceText: '20元' }] }
    assert.fail('Paid mutation in preview')
  } })
  const details = await preview.search({ city: '测试市', from: '起点', to: '终点' })
  assert.equal(details.status, 'choose_places'); assert.equal(calls.includes('taxi_estimate'), false)
  assert.equal(details.from.length, 2); assert.equal(details.to.length, 2)
  assert.throws(() => preview.route({ handle: details.handle, from: 'forged', to: details.to[0].handle }))
  const route = preview.route({ handle: details.handle, from: details.from[0].handle, to: details.to[1].handle })
  assert.equal(route.from_name, '起点甲'); assert.equal(route.to_name, '终点乙')
  now += 120001; assert.throws(() => preview.route({ handle: details.handle, from: details.from[0].handle, to: details.to[1].handle }), /expired/)
})
test('Given unique city-verified endpoints, preview uses real estimate and returns no purchase authority', async () => {
  const calls = []
  const preview = createRidePreview({ call: async (name, args) => {
    calls.push(name)
    return name === 'maps_textsearch' ? [{ display_name: args.keywords, city: '测试市', location: { lng: 1, lat: 2 } }] : { traceId: 'trace', items: [{ productName: '快车', productCategory: '1', priceText: '20元' }] }
  } })
  const details = await preview.search({ city: '测试市', from: '起点', to: '终点' })
  assert.equal(details.status, 'quoted'); assert.equal(details.items[0].priceText, '20元'); assert.ok(details.expiresAt > Date.now())
  assert.deepEqual(calls, ['maps_textsearch', 'maps_textsearch', 'taxi_estimate']); assert.equal('confirmationPhrase' in details, false)
})

test('Given a preview, only the actual owner selection enters a fresh interactive quote and a later phrase can submit', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createRideEngine } = await import('../src/didi/engine.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'odk-preview-engine-'))
  const { protectProactivePath } = await import('../src/proactive-private.mjs')
  protectProactivePath(dir)
  const calls = []; let valid = true
  const engine = await createRideEngine({ stateFile: join(dir, 'rides.json'), call: async (name, args) => {
    calls.push(name)
    if (name === 'maps_textsearch') return [{ display_name: args.keywords, city: '测试市', location: { lng: 1, lat: 2 } }]
    if (name === 'taxi_estimate') return { traceId: 'live-trace', items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] }
    if (name === 'taxi_create_order') return { orderId: 'actual-test-order', statusCode: 0 }
    assert.fail('Unexpected call')
  } })
  t.after(async () => { await engine.close(); await rm(dir, { recursive: true, force: true }) })
  const details = await engine.previewRide({ city: '测试市', from: '起点', to: '终点' }, undefined, () => valid)
  assert.equal(engine.snapshot().phase, 'idle'); assert.equal(engine.snapshot().quote, null)
  const params = { handle: details.handle, from: details.from[0].handle, to: details.to[0].handle }
  assert.throws(() => engine.estimatePreview(params), /明确选择/)
  engine.beginTurn(`查看报价 ${params.handle} ${params.from} ${params.to}`)
  await engine.estimatePreview(params); assert.equal(engine.snapshot().phase, 'quoted'); assert.equal(calls.filter(n => n === 'taxi_estimate').length, 2)
  const proposal = await engine.propose({ productCategory: '1' }); await assert.rejects(engine.submit())
  engine.beginTurn(proposal.confirmationPhrase); await engine.submit(); assert.equal(calls.filter(n => n === 'taxi_create_order').length, 1)
  valid = false; engine.beginTurn(`查看报价 ${params.handle} ${params.from} ${params.to}`); assert.throws(() => engine.estimatePreview(params), /过期|失效/)
})

test('Given a quote request whose owner turn ended, a late preview estimate cannot install an interactive quote', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const { createRideEngine } = await import('../src/didi/engine.mjs'), { protectProactivePath } = await import('../src/proactive-private.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'odk-preview-late-')); protectProactivePath(dir)
  let release, enter, hold = false
  const entered = new Promise(resolve => { enter = resolve })
  const engine = await createRideEngine({ stateFile: join(dir, 'rides.json'), call: async (name, args) => {
    if (name === 'maps_textsearch') return [{ display_name: args.keywords, city: args.city, location: { lng: 1, lat: 2 } }]
    if (hold) await new Promise(resolve => { release = resolve; enter() })
    return { traceId: 'test-trace', items: [{ productName: '车型', productCategory: '1', priceText: '20元' }] }
  } })
  t.after(async () => { hold = false; release?.(); await engine.close(); await rm(dir, { recursive: true, force: true }) })
  const p = await engine.previewRide({ city: '测试市', from: '起点', to: '终点' })
  const params = { handle: p.handle, from: p.from[0].handle, to: p.to[0].handle }
  engine.beginTurn(`查看报价 ${params.handle} ${params.from} ${params.to}`); hold = true
  const pending = engine.estimatePreview(params)
  let timer
  try { await Promise.race([entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Quote request never entered the provider')), 2000) })]) } finally { clearTimeout(timer) }
  assert.ok(release); engine.beginTurn(''); release()
  await assert.rejects(pending, /用户输入|user turn/); assert.equal(engine.snapshot().quote, null)
})
