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
function fixture() {
  const surface = new Element(); surface.hidden = true
  const selectors = ['content', 'heading', 'input', 'transcript', 'stage', 'icon', 'title', 'detail', 'progress', 'level']
  surface.selectors = Object.fromEntries(selectors.map(name => [`.personal-agent-status-${name}`, new Element()]))
  surface.selectors['.personal-agent-status-level span'] = new Element()
  const content = surface.selectors['.personal-agent-status-content']; surface.append(content)
  const local = new Element('button'), commands = [], events = {}
  const document = { querySelector: () => null, getElementById: () => surface, activeElement: local, body: { children: [local, surface] }, createElement: tag => new Element(tag) }
  let render
  const window = { odkPersonalAgent: { subscribe: callback => { render = callback }, onMic() {}, proposalCommand: async command => { commands.push(command); return { accepted: true } } },
    odkPersonalAgentReply: { render: (el, text) => { el.textContent = text } }, addEventListener: (name, callback) => { events[name] = callback }, dispatchEvent() {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/personal-agent-status.js'), 'utf8'), { window, document, CustomEvent: class {}, console })
  return { surface, content, local, commands, render, window, events }
}
const proposal = () => ({ id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry', status: 'pending', confirmation: '记住 watering：检查盆土', advice: '<script>不可信文本</script>', action: { tool: 'memory_update' }, evidence: [{ readingId: 'hydra', field: 'soil', value: 10, state: 'live', measuredAt: '2026-10-02T10:00:00Z' }] })
const flatten = node => [node, ...node.children.flatMap(flatten)]
test('proactive popup is nonmodal and preserves local focus and input authority', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [proposal()], proposalPopup: true })
  assert.equal(f.surface.hidden, false); assert.equal(f.surface.dataset.proactive, 'true')
  assert.equal(f.local.inert, undefined); assert.equal(f.content.focused, undefined)
  assert.equal(f.window.odkPersonalAgentStatus.visible(), false, 'Passive proposal must not block Shell navigation')
  assert.equal(f.window.odkPersonalAgentStatus.handleInput('left'), false)
  assert.equal(f.commands[0].type, 'proposal_presented')
  assert.ok(flatten(f.content).some(n => n.textContent === '<script>不可信文本</script>'))
})
test('touch acceptance shows the exact phrase before a separate confirmation', async () => {
  const f = fixture(); const p = proposal(); f.render({ state: 'idle', proposals: [p], proposalPopup: true })
  const buttons = flatten(f.content).filter(n => n.tagName === 'BUTTON')
  await buttons.find(n => n.textContent === 'Accept').click()
  assert.equal(f.commands.filter(c => c.type === 'proposal_respond').length, 0)
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation).click()
  assert.equal(f.commands.at(-1).confirmation, p.confirmation)
})
test('silent data does not open, expiry removes execution and a voice turn takes the normal path', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [proposal()], proposalPopup: false })
  assert.equal(f.surface.hidden, true)
  f.render({ state: 'idle', proposals: [{ ...proposal(), status: 'expired' }], proposalPopup: true })
  assert.ok(!flatten(f.content).some(n => n.tagName === 'BUTTON' && n.textContent === 'Accept'))
  f.render({ state: 'recording' }); assert.equal(f.surface.dataset.proactive, 'false')
  assert.equal(f.local.inert, true); assert.equal(f.content.focused, true)
})

test('a recovered service error clears without replacing the same suggestion controls', () => {
  const f = fixture(), status = { state: 'idle', proposals: [proposal()], proposalHiddenCount: 1, proposalPopup: true }
  f.render({ ...status, proposalError: 'generation_unavailable' })
  assert.equal(f.content.querySelector('.personal-agent-proposal-error').textContent, 'generation_unavailable')
  const section = f.content.children[0], controls = flatten(section).filter(n => n.tagName === 'BUTTON')
  f.render({ ...status, proposalPopup: false })
  assert.equal(f.content.querySelector('.personal-agent-proposal-error'), null)
  assert.equal(f.content.children[0], section)
  assert.deepEqual(flatten(section).filter(n => n.tagName === 'BUTTON'), controls)
  assert.equal(f.surface.hidden, false)
  f.render({ ...status, proposalError: 'checkpoint_failed' })
  assert.equal(f.content.querySelector('.personal-agent-proposal-error').textContent, 'checkpoint_failed')
})

test('unchanged service status preserves an uncertain command warning and disabled confirmation', async () => {
  const f = fixture(), p = proposal(), status = { state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: true }
  f.render(status)
  f.window.odkPersonalAgent.proposalCommand = async command => { f.commands.push(command); throw Error('Controlled offline delivery failure') }
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Accept').click()
  const confirmation = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === p.confirmation)
  await confirmation.click()
  const warning = f.content.querySelector('.personal-agent-proposal-error')
  assert.match(warning.textContent, /not delivered.*do not repeat an uncertain action/)
  assert.equal(confirmation.disabled, true)
  const count = f.commands.length
  f.render({ ...status, proposalPopup: false, proposalError: 'generation_unavailable' })
  f.render({ ...status, proposalPopup: false })
  assert.equal(f.content.querySelector('.personal-agent-proposal-error'), warning)
  assert.match(warning.textContent, /not delivered.*do not repeat an uncertain action/)
  assert.equal(confirmation.disabled, true)
  assert.equal(flatten(f.content).find(n => n.textContent === p.confirmation), confirmation)
  assert.equal(f.commands.length, count)
})

test('ride details are read-only and explicit endpoint selection enters the ordinary owner channel', async () => {
  const f = fixture(), turns = []
  f.window.odkPersonalAgent.sendText = async text => { turns.push(text); return { accepted: true } }
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
  f.render({ state: 'idle', proposals: [{ ...ride, ridePreview: { ...ride.ridePreview, expiresAt: Date.now() - 1 } }], proposalPopup: true })
  const expired = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Get current quote')
  assert.equal(expired, undefined)
  const refresh = flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Refresh preview')
  assert.ok(refresh); await refresh.click(); assert.equal(turns.at(-1), '刷新行程 preview-handle')
})

test('actual service, private socket and Shell client deliver restored ride refresh into the renderer', { timeout: 10000 }, async t => {
  const { integrationURL } = require('./helpers/repo-root')
  const { tmpdir } = require('node:os')
  const load = file => import(integrationURL(`personal-agent/src/${file}`, __dirname))
  const { PersonalAgentService } = await load('service.mjs'), { listen } = await load('socket.mjs')
  const { createIntentStore, createIntentRuntime } = await load('intents.mjs'), { proposalStateStore } = await load('proactive-state.mjs')
  const { createRidePreview } = await load('didi/preview.mjs'), { ProactiveWatch } = await load('proactive.mjs')
  const { createProposalTools } = await load('proactive-tools.mjs'), { guardIntentTools } = await load('intent-routing.mjs')
  const { protectProactivePath } = await load('proactive-private.mjs')
  const { createPersonalAgentClient } = require('../src/personal-agent-client.js')
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'odk-ride-wire-'))); protectProactivePath(dir)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createIntentStore(path.join(dir, 'intent.md')), checkpoint = proposalStateStore(path.join(dir, 'state.json'))
  let now = Date.now(), turns = [], calls = 0, watch, currentText = ''
  const at = new Date(now).toISOString().slice(11, 16)
  store.save({ wish: '查看午间行程', condition: '每天提醒', at, timeZone: 'UTC', windowMinutes: 10, memoryKeys: [], observations: [], ride: { city: '测试市', from: '测试办公楼', to: '测试健身馆' } })
  const f = fixture()
  const service = new PersonalAgentService({ record: async () => assert.fail('No capture'), transcribe: async () => assert.fail('No transcription'), prompt: async text => {
    turns.push(text); currentText = text
    const tool = guardIntentTools(createProposalTools(() => watch, () => currentText, { intentPreviews: true }), () => 'ride').find(t => t.name === 'personal_agent_ride_preview')
    await tool.execute('owner-refresh', { handle: text.split(' ')[1] }, new AbortController().signal)
    return '新预览已刷新，请重新选择地点。'
  } })
  const make = () => {
    const previews = createRidePreview({ now: () => now, call: async (name, args) => { calls++; return name === 'maps_textsearch' ? [{ display_name: args.keywords, city: args.city, location: { lng: 1, lat: 2 } }] : { traceId: 'never-expose-this-trace', phoneNumberSuffix: 'never-expose-account', items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] } } })
    const intents = createIntentRuntime({ store, memory: async () => ({}), read: async () => null, judge: async () => ({ status: 'true', model: 'jev-test' }), previewRide: previews.search, now: () => now })
    return { previews, watch: new ProactiveWatch({ config: { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }, intents, now: () => now,
      loadState: checkpoint.load, saveState: checkpoint.save, publish: frame => service.propose(frame), save: async () => {}, read: async () => null,
      generate: async ({ topics }) => ({ suggestions: [{ topicId: topics[0].id, key: 'ride', advice: '查看行程。', reason: '按保存计划查看。', evidenceIds: topics[0].evidence.map(e => e.id) }] }),
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
  const client = createPersonalAgentClient({ socketPath: endpoint, token, reconnectDelayMs: 60000 })
  t.after(() => client.stop())
  f.window.odkPersonalAgent.sendText = async text => ({ accepted: await client.sendText(text) })
  f.window.odkPersonalAgent.proposalCommand = async cmd => ({ accepted: client.proposalCommand(cmd) })
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
