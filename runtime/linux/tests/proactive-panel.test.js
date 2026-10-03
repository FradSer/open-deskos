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
  querySelector(selector) { return this.selectors?.[selector] ?? null }
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
  const document = { getElementById: () => surface, activeElement: local, body: { children: [local, surface] }, createElement: tag => new Element(tag) }
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
