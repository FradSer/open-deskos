const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.hidden = false; this.dataset = {}; this.style = {}; this.events = {}; this.attributes = {}; this.textContent = ''; this.scrollTop = 0; this.isConnected = true }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parent = this } }
  appendChild(node) { this.append(node); return node }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  addEventListener(name, cb) { this.events[name] = cb }
  setAttribute(name, value) { this.attributes[name] = value }
  contains(node) { return this === node || this.children.some(child => child.contains(node)) }
  focus() { this.focused = true }
  querySelector(selector) { return this.selectors?.[selector] ?? this.children.find(child => child.className?.split(/\s+/).includes(selector.slice(1))) ?? this.children.map(child => child.querySelector(selector)).find(Boolean) ?? null }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1) }
  scrollBy() {}
  async click() { await this.events.click?.() }
}
function fixture({ readiness = false, hidden = false } = {}) {
  let now = Date.now()
  class Clock extends Date { static now() { return now } }
  const surface = new Element(); surface.hidden = true
  const selectors = ['content', 'heading', 'input', 'transcript', 'stage', 'icon', 'title', 'detail', 'progress', 'level']
  surface.selectors = Object.fromEntries(selectors.map(name => [`.personal-bot-status-${name}`, new Element()]))
  surface.selectors['.personal-bot-status-level span'] = new Element()
  const content = surface.selectors['.personal-bot-status-content']; surface.append(content)
  const local = new Element('button'), commands = [], ready = [], events = {}, observers = []
  const document = { hidden, visibilityState: hidden ? 'hidden' : 'visible', addEventListener(name, cb) { events[name] = cb }, removeEventListener() {}, querySelector: () => null, getElementById: () => surface, activeElement: local, body: { children: [local, surface] }, createElement: tag => new Element(tag) }
  let render
  const window = { odkPersonalBot: { subscribe: callback => { render = callback }, onMic() {}, proposalCommand: async command => { commands.push(command); return { accepted: true } } },
    odkPersonalBotReply: { render: (el, text) => { el.textContent = text } }, addEventListener: (name, callback) => { events[name] = callback }, dispatchEvent() {} }
  if (readiness) window.odkPersonalBot.consumerReady = id => { ready.push(id); return Promise.resolve({ accepted: true }) }
  let sequence = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/personal-bot-status.js'), 'utf8'), { window, document, crypto: { randomUUID: () => `11111111-1111-4111-8111-${String(++sequence).padStart(12, '0')}` }, CustomEvent: class {}, console, Date: Clock, IntersectionObserver: class { constructor(callback) { this.callback = callback; this.nodes = new Set(); observers.push(this) } observe(node) { this.nodes.add(node) } disconnect() { this.nodes.clear() } unobserve(node) { this.nodes.delete(node) } } })
  return { surface, content, local, commands, ready, render, window, events, document, observers, advance(ms) { now += ms }, visible(node, ratio = 1, { height = 44, viewportHeight = 200 } = {}) { for (const observer of observers) if (observer.nodes.has(node)) observer.callback([{ target: node, isIntersecting: ratio > 0, intersectionRatio: ratio, boundingClientRect: { width: 100, height }, rootBounds: { width: 100, height: viewportHeight }, intersectionRect: { width: ratio > 0 ? 100 : 0, height: height * ratio } }]) } }
}
const proposal = () => ({ id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry', status: 'pending', offered: true, presented: false, confirmation: '记住 watering：检查盆土', advice: '<script>不可信文本</script>', action: { tool: 'memory_update' }, evidence: [{ readingId: 'hydra', field: 'soil', value: 10, state: 'live', measuredAt: '2026-10-02T10:00:00Z' }] })
const flatten = node => [node, ...node.children.flatMap(flatten)]
test('a desk-projected next step stays readable on the read-only Android surface', () => {
  const { projectPersonalAgentFrame } = require('../src/personal-agent-frame')
  const p = { ...proposal(), advice: 'Keep a soil inspection note.', nextStep: 'Save a soil inspection note' }
  const frame = projectPersonalAgentFrame({ state: 'idle', proposals: [p], proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  const f = fixture()
  f.render(frame)
  assert.ok(flatten(f.content).some(n => n.className === 'personal-bot-proposal-next-step' && n.textContent === p.nextStep))
  const state = f.content.querySelector('.personal-bot-proposal-state').textContent
  assert.ok(state.includes('Read-only preview'))
  assert.ok(!state.includes('Earlier suggestion'))
  assert.equal(flatten(f.content).filter(n => n.tagName === 'BUTTON' && n.dataset.proposalAction).length, 0)
  assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-confirm'))
  f.visible(f.content.querySelector('.personal-bot-proposal-advice'))
  assert.equal(f.commands.length, 0)
})
test('a technical-advice placeholder cannot acknowledge hidden original advice', async () => {
  const f = fixture(), p = { ...proposal(), action: null, advice: `Inspect expectedSHA256 ${'a'.repeat(64)}` }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const placeholder = f.content.querySelector('.personal-bot-proposal-advice')
  const sources = f.content.querySelector('.personal-bot-proposal-sources')
  const original = flatten(sources).find(n => n.textContent === p.advice)
  assert.ok(f.observers.some(observer => observer.nodes.has(original)))
  assert.ok(f.observers.every(observer => !observer.nodes.has(placeholder)))
  f.visible(placeholder)
  assert.equal(f.commands.length, 0, 'A source-inspection placeholder is not the actual advice')
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'View sources').click()
  assert.equal(sources.open, true)
  assert.equal(f.commands.length, 0, 'Opening Sources alone does not prove visible advice')
  f.visible(original, 0)
  f.visible(original, 0.49)
  assert.equal(f.commands.length, 0, 'Non-intersecting or insufficiently visible original advice stays unread')
  f.visible(original)
  assert.deepEqual(f.commands.map(c => c.type), ['proposal_presented'])
  assert.deepEqual(Array.from(f.commands[0].ids), [p.id])
})

function technicalPresentationWait() {
  const source = fs.readFileSync(path.join(__dirname, 'proactive-panel.cjs'), 'utf8')
  const start = source.indexOf('async function waitForTechnicalAdvicePresentation(')
  const end = source.indexOf('app.whenReady().then(async () => {', start)
  assert.ok(start >= 0 && end > start)
  const context = { assert, performance, setTimeout }
  vm.runInNewContext(source.slice(start, end) + '\nthis.wait = waitForTechnicalAdvicePresentation', context)
  return context.wait
}

test('technical advice acceptance waits for a delayed same-ID visibility receipt', async () => {
  const wait = technicalPresentationWait(), commands = [], id = 'technical-advice', calls = []
  const unrelated = setTimeout(() => commands.push({ type: 'proposal_presented', ids: ['another-suggestion'] }), 25)
  const receipt = setTimeout(() => commands.push({ type: 'proposal_presented', ids: [id] }), 180)
  try {
    await wait(async script => { calls.push(script); return {} }, commands, id, 1000)
    assert.ok(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(id)))
    assert.ok(calls.some(script => script.includes('document.fonts.ready') && script.includes('requestAnimationFrame')))
  } finally { clearTimeout(unrelated); clearTimeout(receipt) }
})

test('technical advice acceptance rejects missing or late visibility receipts', async () => {
  for (const late of [false, true]) {
    const wait = technicalPresentationWait(), commands = [{ type: 'proposal_presented', ids: ['another-suggestion'] }]
    const receipt = late ? setTimeout(() => commands.push({ type: 'proposal_presented', ids: ['technical-advice'] }), 180) : undefined
    try {
      await assert.rejects(wait(async () => ({ sourcesOpen: true, documentHidden: false }), commands, 'technical-advice', 60),
        /Technical original advice was not acknowledged.*technical-advice.*sourcesOpen/)
      assert.equal(commands.some(c => c.ids.includes('technical-advice')), false)
    } finally { clearTimeout(receipt) }
  }
})

for (const revoked of [{ state: 'unavailable' }, { state: 'idle', proposalCapabilities: { read: false, respond: false, acknowledge: false } }]) {
test(`suggestion ${revoked.state === 'unavailable' ? 'provider' : 'read capability'} withdrawal clears old content and observers`, () => {
  const f = fixture(), p = proposal()
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const section = f.content.querySelector('.personal-bot-proposals')
  const advice = flatten(section).find(node => node.className === 'personal-bot-proposal-advice')
  assert.ok(advice)
  f.render(revoked)
  assert.equal(section.children.length, 0)
  assert.equal(section.hidden, true)
  assert.equal(f.surface.hidden, true)
  assert.ok(f.observers.every(observer => observer.nodes.size === 0))
  f.render({ state: 'starting' })
  assert.equal(section.children.length, 0, 'legacy replacement status cannot revive the withdrawn view')
  f.visible(advice)
  assert.equal(f.commands.length, 0)
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  assert.equal(section.hidden, false)
  const current = flatten(section).find(node => node.className === 'personal-bot-proposal-advice')
  assert.notEqual(current, advice)
  f.visible(current)
  assert.deepEqual(f.commands.map(command => command.type), ['proposal_presented'])
})
}

test('a withdrawn provider command cannot overwrite replacement suggestion feedback', async () => {
  const f = fixture(), p = { ...proposal(), action: null, confirmation: '' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  let reject
  f.window.odkPersonalBot.proposalCommand = () => new Promise((_resolve, fail) => { reject = fail })
  const pending = flatten(f.content).find(node => node.tagName === 'BUTTON' && node.textContent === 'Done').click()
  f.render({ state: 'unavailable' })
  f.render({ state: 'idle', proposals: [{ ...p, id: '11111111-1111-4111-8111-111111111111', advice: 'Current provider suggestion' }], proposalPopup: true })
  reject(Error('Withdrawn provider failure'))
  await pending
  assert.equal(f.content.querySelector('.personal-bot-proposal-error'), null)
  assert.ok(flatten(f.content).some(node => node.textContent === 'Current provider suggestion'))
})

test('proactive popup is nonmodal and preserves local focus and input authority', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [proposal()], proposalPopup: true })
  assert.equal(f.surface.hidden, false); assert.equal(f.surface.dataset.proactive, 'true')
  assert.equal(f.local.inert, undefined); assert.equal(f.content.focused, undefined)
  assert.equal(f.window.odkPersonalBotStatus.visible(), false, 'Passive proposal must not block Shell navigation')
  assert.equal(f.window.odkPersonalBotStatus.handleInput('left'), false)
  assert.equal(f.commands.length, 0, 'Delivered content is not yet visible acknowledgement')
  f.visible(flatten(f.content).find(n => n.className === 'personal-bot-proposal-advice'))
  assert.equal(f.commands[0].type, 'proposal_presented')
  assert.ok(flatten(f.content).some(n => n.textContent === '<script>不可信文本</script>'))
})
test('touch acceptance shows the exact phrase before a separate confirmation', async () => {
  const f = fixture(); const p = proposal(); f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const buttons = flatten(f.content).filter(n => n.tagName === 'BUTTON')
  await buttons.find(n => n.textContent === 'Run action').click()
  assert.equal(f.commands.filter(c => c.type === 'proposal_respond').length, 0)
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation).click()
  assert.equal(f.commands.at(-1).confirmation, p.confirmation)
})
test('silent data does not open, expiry removes execution and a voice turn takes the normal path', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [proposal()], proposalPopup: false })
  assert.equal(f.surface.hidden, true)
  f.render({ state: 'idle', proposals: [{ ...proposal(), status: 'expired' }], proposalPopup: true })
  assert.ok(!flatten(f.content).some(n => n.tagName === 'BUTTON' && n.textContent === 'Run action'))
  f.render({ state: 'recording' }); assert.equal(f.surface.dataset.proactive, 'false')
  assert.equal(f.local.inert, true); assert.equal(f.content.focused, true)
})

test('a recovered service error clears without replacing the same suggestion controls', () => {
  const f = fixture(), status = { state: 'idle', proposals: [proposal()], proposalHiddenCount: 1, proposalPopup: true }
  f.render({ ...status, proposalError: 'generation_unavailable' })
  assert.equal(f.content.querySelector('.personal-bot-proposal-error').textContent, 'generation_unavailable')
  const section = f.content.children[0], controls = flatten(section).filter(n => n.tagName === 'BUTTON')
  f.render({ ...status, proposalPopup: false })
  assert.equal(f.content.querySelector('.personal-bot-proposal-error'), null)
  assert.equal(f.content.children[0], section)
  assert.deepEqual(flatten(section).filter(n => n.tagName === 'BUTTON'), controls)
  assert.equal(f.surface.hidden, false)
  f.render({ ...status, proposalError: 'checkpoint_failed' })
  assert.equal(f.content.querySelector('.personal-bot-proposal-error').textContent, 'checkpoint_failed')
})

test('unchanged service status preserves an uncertain command warning and disabled confirmation', async () => {
  const f = fixture(), p = proposal(), status = { state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: true }
  f.render(status)
  f.window.odkPersonalBot.proposalCommand = async command => { f.commands.push(command); throw Error('Controlled offline delivery failure') }
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Run action').click()
  const confirmation = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
  await confirmation.click()
  const warning = f.content.querySelector('.personal-bot-proposal-error')
  assert.match(warning.textContent, /not delivered.*do not repeat an uncertain action/)
  assert.equal(confirmation.disabled, true)
  const count = f.commands.length
  f.render({ ...status, proposalPopup: false, proposalError: 'generation_unavailable' })
  f.render({ ...status, proposalPopup: false })
  assert.equal(f.content.querySelector('.personal-bot-proposal-error'), warning)
  assert.match(warning.textContent, /not delivered.*do not repeat an uncertain action/)
  assert.equal(confirmation.disabled, true)
  assert.equal(flatten(f.content).find(n => n.textContent === p.confirmation), confirmation)
  assert.equal(f.commands.length, count)
})

test('ride details are read-only and explicit endpoint selection enters the ordinary owner channel', async () => {
  const f = fixture(), turns = []
  f.window.odkPersonalBot.sendText = async text => { turns.push(text); return { accepted: true } }
  const ride = { ...proposal(), action: null, confirmation: '', ridePreview: { handle: 'preview-handle', status: 'choose_places', sandbox: true, expiresAt: Date.now() + 60000, measuredAt: new Date().toISOString(), from: [{ handle: 'from-a', name: '<script>起点甲</script>', city: '测试市', address: '测试路' }, { handle: 'from-b', name: '起点乙', city: '测试市' }], to: [{ handle: 'to-a', name: '终点', city: '测试市' }] } }
  f.render({ state: 'idle', proposals: [ride], proposalPopup: true })
  const open = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'View ride details')
  assert.ok(open); await open.click(); assert.equal(turns.length, 0); assert.equal(f.commands.filter(c => c.type === 'proposal_respond').length, 0)
  assert.ok(flatten(f.content).some(n => n.textContent === 'Sandbox preview; no real vehicle or trip.'))
  assert.ok(flatten(f.content).some(n => n.textContent.includes('<script>起点甲</script>')))
  const selects = flatten(f.content).filter(n => n.tagName === 'SELECT')
  const quote = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Get current quote')
  await quote.click(); assert.equal(turns.length, 0, 'ambiguous pickup must not default to the first place')
  selects[0].value = 'from-b'; selects[1].value = 'to-a'; await quote.click()
  assert.equal(turns[0], '查看报价 preview-handle from-b to-a'); assert.equal(quote.disabled, true)
  f.render({ state: 'idle', proposals: [{ ...ride, ridePreview: { ...ride.ridePreview, expiresAt: 0 } }], proposalPopup: true })
  const expired = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Get current quote')
  assert.equal(expired, undefined)
  const refresh = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Refresh preview')
  assert.ok(refresh); await refresh.click(); assert.equal(turns.at(-1), '刷新行程 preview-handle')
})

test('actual service, private socket and Shell client deliver restored ride refresh into the renderer', { timeout: 10000 }, async t => {
  const { integrationURL } = require('./helpers/repo-root')
  const { tmpdir } = require('node:os')
  const load = file => import(integrationURL(`personal-bot/src/${file}`, __dirname))
  const { PersonalBotService } = await load('service.mjs'), { listen } = await load('socket.mjs')
  const { createIntentStore, createIntentRuntime } = await load('intents.mjs'), { proposalStateStore } = await load('proactive-state.mjs')
  const { createRidePreview } = await load('didi/preview.mjs'), { ProactiveWatch } = await load('proactive.mjs')
  const { createProposalTools } = await load('proactive-tools.mjs'), { guardIntentTools } = await load('intent-routing.mjs')
  const { protectProactivePath } = await load('proactive-private.mjs')
  const { createPersonalBotClient } = require('../src/personal-bot-client.js')
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'odk-ride-wire-'))); protectProactivePath(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createIntentStore(path.join(dir, 'intent.md')), checkpoint = proposalStateStore(path.join(dir, 'state.json'))
  let now = Date.now(), turns = [], calls = 0, watch, currentText = ''
  const at = new Date(now).toISOString().slice(11, 16)
  store.save({ wish: '查看午间行程', condition: '每天提醒', at, timeZone: 'UTC', windowMinutes: 10, memoryKeys: [], observations: [], ride: { city: '测试市', from: '测试办公楼', to: '测试健身馆' } })
  const f = fixture()
  const service = new PersonalBotService({ record: async () => assert.fail('No capture'), transcribe: async () => assert.fail('No transcription'), prompt: async text => {
    turns.push(text); currentText = text
    const tool = guardIntentTools(createProposalTools(() => watch, () => currentText, { intentPreviews: true }), () => 'ride').find(t => t.name === 'personal_bot_ride_preview')
    await tool.execute('owner-refresh', { handle: text.split(' ')[1] }, new AbortController().signal)
    return '新预览已刷新，请重新选择地点。'
  } })
  const make = () => {
    const previews = createRidePreview({ now: () => now, call: async (name, args) => { calls++; return name === 'maps_textsearch' ? [{ display_name: args.keywords, city: args.city, location: { lng: 1, lat: 2 } }] : { traceId: 'never-expose-this-trace', phoneNumberSuffix: 'never-expose-account', items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] } } })
    const intents = createIntentRuntime({ store, memory: async () => ({}), read: async () => null, judge: async () => ({ status: 'true', model: 'jev-test' }), previewRide: previews.search, now: () => now })
    return { previews, watch: new ProactiveWatch({ config: { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }, intents, now: () => now,
      loadState: checkpoint.load, saveState: checkpoint.save, publish: frame => service.propose(frame), save: async () => {}, read: async () => null,
      generate: async ({ topics }) => ({ suggestions: [{ topicId: topics[0].id, key: 'ride', advice: '查看行程。', nextStep: '选择起点和终点后查看报价。', evidenceIds: topics[0].evidence.map(e => e.id) }] }),
      judge: async ({ candidates }) => ({ model: 'jev-test', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.95, groundingProbability: 0.95, threshold: 0.8 }])) }) }) }
  }
  watch = make().watch; service.attachWatch(watch); service.setState('idle', 'Ready')
  await watch.tick(); const old = watch.list()[0].ridePreview; await watch.presented([watch.list()[0].id]); await watch.close()
  now += 20 * 60000 // Manual refresh remains possible outside the scheduled offer window.
  const restarted = make(); watch = restarted.watch; service.attachWatch(watch)
  t.after(() => watch.close())
  assert.throws(() => restarted.previews.route({ handle: old.handle, from: old.from[0].handle, to: old.to[0].handle }), /expired/)
  await watch.tick(); assert.equal(calls, 3, 'Restart cannot repeat scheduled MCP discovery')
  const endpoint = process.platform === 'win32' ? '\\\\.\\pipe\\odk-ride-wire-' + process.pid : path.join(dir, 'agent.sock')
  const token = 'a'.repeat(64), server = await listen(endpoint, service, { token })
  t.after(() => server.close())
  const client = createPersonalBotClient({ socketPath: endpoint, token, reconnectDelayMs: 60000 })
  t.after(() => client.stop())
  f.window.odkPersonalBot.sendText = async text => ({ accepted: await client.sendText(text) })
  f.window.odkPersonalBot.proposalCommand = async cmd => ({ accepted: client.proposalCommand(cmd) })
  client.subscribe(frame => f.render(frame))
  const until = predicate => new Promise(resolve => { let off = () => {}; off = client.subscribe(frame => { if (predicate(frame)) { off(); resolve(frame) } }) })
  const connected = until(frame => frame.state === 'idle'); client.start(); await connected
  const shown = until(frame => frame.proposalPopup === true); await watch.readProposals(); await shown
  assert.equal(watch.list()[0].status, 'expired')
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'View ride details').click()
  const updated = until(frame => frame.proposals?.[0]?.ridePreview?.handle && frame.proposals[0].ridePreview.handle !== old.handle)
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Refresh preview').click()
  const frame = await updated
  assert.deepEqual(turns, [`刷新行程 ${old.handle}`]); assert.equal(calls, 6)
  assert.notEqual(frame.proposals[0].ridePreview.from[0].handle, old.from[0].handle)
  assert.equal(frame.proposals[0].action, null); assert.equal(frame.proposals[0].confirmation, '')
  assert.equal(frame.proposals[0].offered, true); assert.equal(frame.proposals[0].presented, true)
  assert.equal(checkpoint.load().intentClaims.length, 1); assert.equal(frame.proposalPopup, false)
  assert.equal(JSON.stringify(frame).includes('never-expose'), false)
  assert.ok(flatten(f.content).some(n => n.textContent === 'View ride details'))
})


test('only an offered pending suggestion visible in the current viewport is acknowledged', () => {
  const f = fixture(), first = proposal(), second = { ...proposal(), id: 'd311a280-c0b9-4411-96cd-4e1e92385349' }
  f.render({ state: 'idle', proposals: [first, second], proposalPopup: true })
  assert.equal(f.commands.length, 0)
  const advice = flatten(f.content).filter(n => n.className === 'personal-bot-proposal-advice')
  f.visible(advice[0], 0); assert.equal(f.commands.length, 0)
  f.document.hidden = true; f.visible(advice[0]); assert.equal(f.commands.length, 0)
  f.document.hidden = false; f.visible(advice[0])
  assert.deepEqual(Array.from(f.commands[0].ids), [first.id])
  f.visible(advice[0]); assert.equal(f.commands.length, 1)
  f.window.odkPersonalBotStatus.close(); f.visible(advice[1]); assert.equal(f.commands.length, 1)
})

test('unoffered and snoozed suggestions cannot become visible acknowledgements', () => {
  const f = fixture()
  f.render({ state: 'idle', proposals: [{ ...proposal(), offered: false }, { ...proposal(), id: 'd311a280-c0b9-4411-96cd-4e1e92385349', snoozedUntil: Date.now() + 60000 }], proposalPopup: true })
  for (const node of flatten(f.content).filter(n => n.className === 'personal-bot-proposal-advice')) f.visible(node)
  assert.equal(f.commands.length, 0)
})

test('earlier actionless advice preserves feedback and sources without implying an executable step', async () => {
  const f = fixture(), p = { ...proposal(), action: null, nextStep: 'Touch the soil before deciding whether to water.', reason: 'Observed soil is below the selected threshold.' }
  f.render({ state: 'idle', proposals: [p, { ...p, id: 'd311a280-c0b9-4411-96cd-4e1e92385349', status: 'completed' }], proposalPopup: true })
  assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-reason' || n.textContent.includes(p.reason)))
  assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-next-step'))
  assert.ok(flatten(f.content).some(n => n.textContent.includes('No executable action')))
  const sources = flatten(f.content).find(n => n.className === 'personal-bot-proposal-sources')
  assert.ok(flatten(sources).some(n => n.textContent === p.nextStep))
  const article = flatten(f.content).find(n => n.className === 'personal-bot-proposal')
  assert.ok(article.children.findIndex(n => n.className === 'personal-bot-proposal-actions') < article.children.findIndex(n => n.className === 'personal-bot-proposal-sources'))
  assert.ok(flatten(article).filter(n => n.tagName === 'DETAILS').every(n => !n.open))
  assert.ok(flatten(f.content).some(n => n.tagName === 'DETAILS' && n.className === 'personal-bot-proposal-sources'))
  assert.ok(flatten(f.content).some(n => n.tagName === 'DETAILS' && n.className === 'personal-bot-proposal-history'))
  for (const [label, decision] of [['Done', 'done'], ['Later', 'snooze'], ['Useful', 'useful'], ['Not relevant', 'irrelevant'], ['Incorrect', 'incorrect']]) {
    const button = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === label)
    assert.ok(button, label)
    await button.click()
    assert.equal(f.commands.at(-1).type, 'proposal_respond'); assert.equal(f.commands.at(-1).id, p.id); assert.equal(f.commands.at(-1).decision, decision)
  }
})

test('read-only suggestion capabilities keep evidence and hide every response control', async () => {
  const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note', reason: 'Actual observation.' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
  for (const node of flatten(f.content).filter(n => n.className === 'personal-bot-proposal-advice')) f.visible(node)
  assert.equal(f.commands.length, 0)
  const labels = flatten(f.content).filter(n => n.tagName === 'BUTTON').map(n => n.textContent)
  for (const label of ['Accept', 'Run action', p.nextStep, 'Done', 'Later', 'Useful', 'Not relevant', 'Incorrect', 'Ignore', 'Never suggest this category']) assert.ok(!labels.includes(label), label)
  assert.ok(flatten(f.content).some(n => n.textContent.includes('read-only on this device')))
})


test('visibility acknowledgement retries are bounded and recover after a lost connection', () => {
  const f = fixture(), status = { state: 'idle', proposals: [proposal()], proposalPopup: true }
  f.render(status)
  const advice = flatten(f.content).find(n => n.className === 'personal-bot-proposal-advice')
  f.visible(advice); assert.equal(f.commands.length, 1)
  for (let i = 0; i < 10; i++) f.render(status)
  assert.equal(f.commands.length, 1, 'Meter updates do not resend visibility')
  f.advance(5001); f.render(status); assert.equal(f.commands.length, 2, 'Unconfirmed resident state can retry after the limit')
  f.advance(5001); f.render(status); assert.equal(f.commands.length, 3)
  f.advance(5001); f.render(status); assert.equal(f.commands.length, 3, 'Retries stop after three attempts per connection')
  f.render({ state: 'unavailable' }); f.render(status)
  f.visible(flatten(f.content).find(n => n.className === 'personal-bot-proposal-advice'))
  assert.equal(f.commands.length, 4, 'Reconnection can recover an acknowledgement the resident never saved')
  f.render({ ...status, proposals: [{ ...proposal(), presented: true }] })
  f.advance(5001)
  for (const node of flatten(f.content).filter(n => n.className === 'personal-bot-proposal-advice')) f.visible(node)
  assert.equal(f.commands.length, 4, 'A resident-confirmed visible state never resends')
})

test('legacy executable suggestions retain confirmation without a misleading Done response', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [proposal()], proposalPopup: true })
  const labels = flatten(f.content).filter(n => n.tagName === 'BUTTON').map(n => n.textContent)
  assert.ok(labels.includes('Run action')); assert.ok(labels.includes('Ignore')); assert.ok(labels.includes('Never suggest this category'))
  assert.ok(labels.includes('Later'))
  for (const label of ['Done', 'Useful', 'Not relevant', 'Incorrect']) assert.ok(!labels.includes(label), label)
})


test('an explicit resident visibility failure can recover without replaying responses', () => {
  const f = fixture(), status = { state: 'idle', proposals: [proposal()], proposalPopup: true }
  f.render(status); f.visible(flatten(f.content).find(n => n.className === 'personal-bot-proposal-advice'))
  assert.equal(f.commands.length, 1)
  f.render({ ...status, proposalError: 'Private state could not be saved' })
  f.advance(6000); f.render({ ...status, proposalError: 'Private state could not be saved' })
  assert.equal(f.commands.length, 1)
  f.render(status)
  assert.equal(f.commands.length, 2)
  assert.ok(f.commands.every(row => row.type === 'proposal_presented'))
})


test('long advice uses the visible viewport while a heading-only glimpse is insufficient', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [{ ...proposal(), advice: '测'.repeat(1000) }], proposalPopup: true })
  const body = flatten(f.content).find(n => n.className === 'personal-bot-proposal-advice')
  f.visible(body, 0.01, { height: 1000, viewportHeight: 200 })
  assert.equal(f.commands.length, 0, 'Ten visible pixels below a heading do not establish a visible body')
  f.visible(body, 0.1, { height: 1000, viewportHeight: 200 })
  assert.equal(f.commands.length, 1, 'Half the available viewport is meaningful even for a very long paragraph')
})

test('a recovered offer cannot reopen a suggestion dismissed in the current document', () => {
  const f = fixture(), p = proposal()
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  f.window.odkPersonalBotStatus.close()
  assert.equal(f.surface.hidden, true)
  f.render({ state: 'idle', proposals: [p], proposalPopup: true, proposalRecovery: true })
  assert.equal(f.surface.hidden, true)
  f.render({ state: 'idle', proposals: [{ ...p, id: '11111111-1111-4111-8111-111111111111' }], proposalPopup: true })
  assert.equal(f.surface.hidden, false, 'a genuinely new offer keeps the original opening behavior')
})

test('only visible subscribed consumers request recovery and replacement reuses the episode identity', () => {
  const f = fixture({ readiness: true, hidden: true })
  assert.equal(f.ready.length, 0)
  f.document.hidden = false; f.document.visibilityState = 'visible'; f.events.visibilitychange()
  assert.equal(f.ready.length, 1)
  const first = f.ready[0]
  f.render({ state: 'unavailable' }); f.render({ state: 'idle', proposals: [] })
  assert.equal(f.ready.at(-1), first, 'replacement clients receive the same visible episode ID')
  f.document.hidden = true; f.document.visibilityState = 'hidden'; f.events.visibilitychange()
  assert.equal(f.ready.at(-1), null, 'hidden consumers clear reconnect readiness')
  f.document.hidden = false; f.document.visibilityState = 'visible'; f.events.visibilitychange()
  assert.notEqual(f.ready.at(-1), first)
  assert.equal(f.commands.length, 0, 'readiness never fabricates a presented command')
})

test('watch capability replacement on the same resident starts a new readiness episode', () => {
  const f = fixture({ readiness: true })
  const first = f.ready.at(-1)
  f.render({ state: 'idle', proposals: [], proposalCapabilities: { read: false } })
  f.render({ state: 'idle', proposals: [], proposalCapabilities: { read: true } })
  assert.notEqual(f.ready.at(-1), first)
  const restored = f.ready.at(-1)
  f.render({ state: 'idle', proposals: [], proposalCapabilities: { read: true } })
  assert.equal(f.ready.at(-1), restored)
})

test('earlier technical advice moves intact into Sources with an explicit reading action', async () => {
  const f = fixture(), hash = 'a'.repeat(64), p = { ...proposal(), action: null, confirmation: '', advice: `Review the file with SHA256 ${hash}.`, reason: 'Earlier reason.' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const article = flatten(f.content).find(n => n.className === 'personal-bot-proposal')
  const sources = flatten(article).find(n => n.className === 'personal-bot-proposal-sources')
  assert.equal(flatten(article).find(n => n.className === 'personal-bot-proposal-advice').textContent, 'Review the earlier suggestion in Sources.')
  assert.ok(flatten(sources).some(n => n.textContent === p.advice))
  assert.ok(!flatten(article).some(n => n.textContent.includes(p.reason)))
  assert.equal(sources.open, false)
  await flatten(article).find(n => n.tagName === 'BUTTON' && n.textContent === 'View sources').click()
  assert.equal(sources.open, true)
  assert.equal(f.commands.length, 0)
})

test('earlier nontechnical advice remains readable without inventing a next step', async () => {
  const f = fixture(), p = { ...proposal(), action: null, confirmation: '', advice: 'Inspect the actual soil reading.' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  assert.equal(flatten(f.content).find(n => n.className === 'personal-bot-proposal-advice').textContent, p.advice)
  assert.ok(flatten(f.content).some(n => n.className === 'personal-bot-proposal-state' && n.textContent.includes('Earlier suggestion')))
  assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-next-step'))
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'View sources').click()
  assert.equal(f.commands.length, 0)
})

test('technical next steps stay complete inside Sources instead of the primary action text', async () => {
  const f = fixture(), p = { ...proposal(), action: null, confirmation: '', nextStep: `Compare SHA256 ${'b'.repeat(64)}.`, advice: 'Review the controlled export file.' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-next-step'))
  const sources = flatten(f.content).find(n => n.className === 'personal-bot-proposal-sources')
  assert.equal(sources.open, false)
  assert.ok(flatten(sources).some(n => n.textContent === p.nextStep))
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'View sources').click()
  assert.equal(sources.open, true); assert.equal(f.commands.length, 0)
})

for (const nextStep of ['', ' '.repeat(240) + 'Check soil.', 'Check\u0000soil.']) {
  test(`invalid next step ${JSON.stringify(nextStep).slice(0, 40)} cannot appear as the current action`, () => {
    const f = fixture(); f.render({ state: 'idle', proposals: [{ ...proposal(), nextStep }], proposalPopup: true })
    assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-next-step'))
  })
}

test('concrete execution requires exact confirmation and dispatches only once until authoritative settlement', async () => {
  const f = fixture(), p = { ...proposal(), actionId: 'save-note', nextStep: 'Save the watering note' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const execute = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep)
  assert.ok(execute, 'The concrete next step must be the execution control')
  await execute.click()
  assert.equal(f.commands.length, 0)
  let settle
  f.window.odkPersonalBot.proposalCommand = cmd => { f.commands.push(cmd); return new Promise(resolve => { settle = resolve }) }
  const confirm = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
  const pending = confirm.click()
  await confirm.click()
  assert.equal(f.commands.length, 1)
  assert.equal(f.commands[0].decision, 'accept')
  assert.equal(f.commands[0].confirmation, p.confirmation)
  settle({ accepted: true }); await pending
  assert.ok(confirm.disabled)
  assert.ok(!flatten(f.content).some(n => n.textContent === 'Completed'))
  for (const status of ['executing', 'unknown', 'completed']) {
    f.render({ state: 'idle', proposals: [{ ...p, status }], proposalPopup: true })
    assert.ok(!flatten(f.content).some(n => n.tagName === 'BUTTON' && [p.nextStep, p.confirmation, 'Run action'].includes(n.textContent)), status)
  }
})

test('cancel returns to the concrete action without sending a plugin command', async () => {
  const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).click()
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Cancel').click()
  assert.equal(f.commands.length, 0)
  assert.ok(flatten(f.content).some(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep))
})

test('an action without exact confirmation cannot masquerade as an executable next step', () => {
  const f = fixture(), p = { ...proposal(), confirmation: '', nextStep: 'Save the watering note' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  assert.ok(!flatten(f.content).some(n => n.className === 'personal-bot-proposal-next-step'))
  assert.ok(!flatten(f.content).some(n => n.tagName === 'BUTTON' && [p.nextStep, 'Run action'].includes(n.textContent)))
  assert.ok(flatten(f.content).some(n => n.textContent.includes('No executable action')))
})

test('execution receipts remain collapsed source text without asserting completion', async () => {
  const f = fixture(), p = { ...proposal(), status: 'unknown', result: 'The plugin accepted the operation.', execution: { outcome: 'accepted', receipt: { taskId: 'fixture-task', target: '<script>untrusted target</script>', sha256: 'a'.repeat(64) } } }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const article = flatten(f.content).find(n => n.className === 'personal-bot-proposal')
  const sources = flatten(article).find(n => n.className === 'personal-bot-proposal-sources')
  const receipt = flatten(sources).find(n => n.className === 'personal-bot-proposal-evidence personal-bot-proposal-execution')
  assert.ok(receipt, 'The host receipt must remain inspectable')
  assert.equal(sources.open, false)
  assert.ok(receipt.textContent.includes(JSON.stringify(p.execution)))
  assert.ok(!article.children.filter(n => n !== sources).some(n => n.textContent.includes(p.execution.receipt.taskId) || n.textContent.includes(p.execution.receipt.sha256)))
  assert.equal(flatten(article).some(n => n.tagName === 'SCRIPT'), false)
  assert.ok(flatten(article).some(n => n.textContent.startsWith('Outcome not confirmed')))
  assert.ok(!flatten(article).some(n => n.textContent === 'Completed'))
  sources.open = true
  assert.ok(receipt.textContent.includes(p.execution.receipt.target))
})

test('uncertain accept remains reserved across other-card redraw and service reconnect', async () => {
  const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note' }
  f.window.odkPersonalBot.proposalCommand = async cmd => { f.commands.push(cmd); throw Error('Controlled transport failure') }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).click()
  const confirm = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
  await confirm.click()
  const other = { ...p, id: '11111111-1111-4111-8111-111111111111', advice: 'Another suggestion changed.' }
  for (const reconnect of [false, true]) {
    if (reconnect) f.render({ state: 'unavailable' })
    f.render({ state: 'idle', proposals: [p, { ...other, advice: other.advice + reconnect }], proposalPopup: true })
    const first = flatten(f.content).find(n => n.className === 'personal-bot-proposal' && n.dataset.proposalId === p.id)
    const execute = flatten(first).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep)
    assert.ok(!execute || execute.disabled, 'A redraw cannot make an uncertain action repeatable')
    if (execute) await execute.click()
    await confirm.click()
    assert.equal(f.commands.length, 1)
    assert.match(f.content.querySelector('.personal-bot-proposal-error')?.textContent ?? '', /do not repeat an uncertain action/)
  }
  for (const status of ['completed', 'unknown']) {
    f.render({ state: 'idle', proposals: [{ ...p, status }], proposalPopup: true })
    assert.ok(!flatten(f.content).some(n => n.tagName === 'BUTTON' && [p.nextStep, p.confirmation].includes(n.textContent)))
  }
})

test('a pending execution reservation survives redraw before its transport receipt settles', async () => {
  const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note' }
  f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).click()
  let reject
  f.window.odkPersonalBot.proposalCommand = cmd => { f.commands.push(cmd); return new Promise((_resolve, fail) => { reject = fail }) }
  const pending = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation).click()
  f.render({ state: 'idle', proposals: [p], proposalHiddenCount: 1, proposalPopup: true })
  const execute = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep)
  assert.ok(execute.disabled)
  await execute.click()
  assert.equal(f.commands.length, 1)
  assert.ok(flatten(f.content).some(n => n.textContent.includes('waiting for its confirmed outcome')))
  f.render({ state: 'idle', proposals: [{ ...p, status: 'completed' }], proposalPopup: true })
  reject(Error('Late lost transport receipt'))
  await pending
  assert.equal(f.content.querySelector('.personal-bot-proposal-error'), null, 'A late transport failure cannot override an authoritative terminal outcome')
})

test('a late uncertain receipt after reconnect warns the same reserved suggestion', async () => {
  const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note' }
  const status = { state: 'idle', proposals: [p], proposalPopup: true }
  f.render(status)
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).click()
  let reject
  f.window.odkPersonalBot.proposalCommand = cmd => { f.commands.push(cmd); return new Promise((_resolve, fail) => { reject = fail }) }
  const pending = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation).click()
  f.render({ state: 'unavailable' }); f.render(status)
  reject(Error('Lost receipt from the previous connection'))
  await pending
  assert.match(f.content.querySelector('.personal-bot-proposal-error')?.textContent ?? '', /do not repeat an uncertain action/)
  assert.equal(f.commands.length, 1)
  assert.ok(flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).disabled)
})

for (const rawResult of [
  `Saved SHA256 ${'a'.repeat(64)}`,
  'b'.repeat(32),
  ' { "target": "cm5", "project": "/workspace/example", "taskId": "fixture", "html": "<script>untrusted</script>" } ',
  '[{"target":"cm5","status":"accepted"}]',
]) {
  test(`technical legacy results stay complete in Sources: ${rawResult.slice(0, 30)}`, () => {
    const f = fixture(), p = { ...proposal(), status: 'unknown', result: rawResult }
    f.render({ state: 'idle', proposals: [p], proposalPopup: true })
    const article = flatten(f.content).find(n => n.className === 'personal-bot-proposal')
    const sources = flatten(article).find(n => n.className === 'personal-bot-proposal-sources')
    assert.equal(sources.open, false)
    const original = flatten(sources).find(n => n.textContent === rawResult)
    assert.ok(original, 'Sources must retain the exact original result')
    assert.equal(article.children.some(n => n.textContent === rawResult), false, 'Technical result cannot enter the primary card')
    assert.equal(flatten(article).some(n => n.tagName === 'SCRIPT'), false)
    sources.open = true
    assert.equal(original.textContent, rawResult)
    assert.ok(flatten(article).some(n => n.className === 'personal-bot-proposal-state' && n.textContent.startsWith('Outcome not confirmed')))
    assert.equal(flatten(article).some(n => n.className === 'personal-bot-proposal-state' && n.textContent.startsWith('Completed')), false)
  })
}
for (const rawResult of ['Memory updated.', 'The request was accepted; completion remains unconfirmed.', '"Saved a note."', '42', '{not valid JSON}']) {
  test(`human-readable legacy result remains primary without inventing completion: ${rawResult}`, () => {
    const f = fixture(), p = { ...proposal(), status: 'unknown', result: rawResult }
    f.render({ state: 'idle', proposals: [p], proposalPopup: true })
    const article = flatten(f.content).find(n => n.className === 'personal-bot-proposal')
    assert.ok(article.children.some(n => n.textContent === rawResult && n.attributes.role === 'status'))
    assert.ok(flatten(article).some(n => n.className === 'personal-bot-proposal-state' && n.textContent.startsWith('Outcome not confirmed')))
  })
}

for (const update of ['presented receipt', 'another suggestion']) {
  test(`exact confirmation survives ${update} redraw without duplicate acceptance`, async () => {
    const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note' }
    f.render({ state: 'idle', proposals: [p], proposalPopup: true })
    await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).click()
    const original = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
    assert.ok(original)
    const proposals = update === 'presented receipt' ? [{ ...p, presented: true }] : [p, { ...p, id: '11111111-1111-4111-8111-111111111111', advice: 'An independent suggestion changed.' }]
    f.render({ state: 'idle', proposals, proposalPopup: false })
    const retained = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
    assert.ok(retained, 'Unchanged authorized confirmation must survive metadata and peer redraws')
    await retained.click()
    await original.click()
    await retained.click()
    assert.equal(f.commands.length, 1)
    assert.equal(f.commands[0].id, p.id)
    assert.equal(f.commands[0].decision, 'accept')
    assert.equal(f.commands[0].confirmation, p.confirmation)
  })
}
for (const invalidation of ['confirmation changed', 'action changed', 'unavailable', 'read withdrawn', 'respond withdrawn', 'proposal removed', 'completed', 'unknown', 'expired', 'ignored']) {
  test(`an earlier exact confirmation cannot execute after ${invalidation}`, async () => {
    const f = fixture(), p = { ...proposal(), nextStep: 'Save the watering note', action: { tool: 'memory_update', params: { category: 'watering', value: 'Inspect soil.' } } }
    f.render({ state: 'idle', proposals: [p], proposalPopup: true })
    await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.nextStep).click()
    const earlier = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
    let status = { state: 'idle', proposals: [p], proposalPopup: true }
    if (invalidation === 'confirmation changed') status.proposals = [{ ...p, confirmation: '记住 watering：New confirmation.' }]
    else if (invalidation === 'action changed') status.proposals = [{ ...p, action: { tool: 'memory_update', params: { category: 'watering', value: 'Changed action.' } } }]
    else if (invalidation === 'unavailable') status = { state: 'unavailable' }
    else if (invalidation === 'read withdrawn') status.proposalCapabilities = { read: false, respond: false, acknowledge: false }
    else if (invalidation === 'respond withdrawn') status.proposalCapabilities = { read: true, respond: false, acknowledge: true }
    else if (invalidation === 'proposal removed') status.proposals = []
    else status.proposals = [{ ...p, status: invalidation }]
    f.render(status)
    await earlier.click()
    assert.equal(f.commands.length, 0, 'A stale or detached confirmation cannot send a proposal acceptance')
  })
}
