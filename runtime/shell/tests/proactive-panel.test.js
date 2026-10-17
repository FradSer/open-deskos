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
  surface.selectors = Object.fromEntries(selectors.map(name => [`.personal-bot-status-${name}`, new Element()]))
  surface.selectors['.personal-bot-status-level span'] = new Element()
  const content = surface.selectors['.personal-bot-status-content']; surface.append(content)
  const local = new Element('button'), commands = [], events = {}
  const document = { querySelector: () => null, getElementById: () => surface, activeElement: local, body: { children: [local, surface] }, createElement: tag => new Element(tag) }
  let render
  const window = { odkPersonalBot: { subscribe: callback => { render = callback }, onMic() {}, proposalCommand: async command => { commands.push(command); return { accepted: true } } },
    odkPersonalBotReply: { render: (el, text) => { el.textContent = text } }, addEventListener: (name, callback) => { events[name] = callback }, dispatchEvent() {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/personal-bot-status.js'), 'utf8'), { window, document, CustomEvent: class {}, console })
  return { surface, content, local, commands, render, window, events }
}
const proposal = () => ({ id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry', status: 'pending', confirmation: '记住 watering：检查盆土', advice: '<script>不可信文本</script>', action: { tool: 'memory_update' }, evidence: [{ readingId: 'hydra', field: 'soil', value: 10, state: 'live', measuredAt: '2026-10-02T10:00:00Z' }] })
const flatten = node => [node, ...node.children.flatMap(flatten)]
test('proactive popup is nonmodal and preserves local focus and input authority', () => {
  const f = fixture(); f.render({ state: 'idle', proposals: [proposal()], proposalPopup: true })
  assert.equal(f.surface.hidden, false); assert.equal(f.surface.dataset.proactive, 'true')
  assert.equal(f.local.inert, undefined); assert.equal(f.content.focused, undefined)
  assert.equal(f.window.odkPersonalBotStatus.visible(), false, 'Passive proposal must not block Shell navigation')
  assert.equal(f.window.odkPersonalBotStatus.handleInput('left'), false)
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
  await flatten(f.content).find(n => n.tagName === 'BUTTON' && n.textContent === 'Accept').click()
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
