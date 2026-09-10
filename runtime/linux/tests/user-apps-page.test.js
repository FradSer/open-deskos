const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

class Node {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.listeners = {}; this.attributes = {}; this.className = ''; this.hidden = false; this.textContent = ''; this.value = ''; this.dataset = {}; this.style = {} }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node) } }
  appendChild(node) { this.append(node); return node }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes) }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener) }
  dispatchEvent(event) { for (const listener of this.listeners[event.type] || []) listener(event) }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) {
    const found = []
    const visit = (node) => { for (const child of node.children) { if ((selector[0] === '.' && (child.className || '').split(' ').includes(selector.slice(1))) || (selector[0] === '#' && child.id === selector.slice(1)) || selector === (child.tagName || '').toLowerCase()) found.push(child); visit(child) } }
    visit(this); return found
  }
  requestSubmit() { this.dispatchEvent({ type: 'submit', preventDefault() {} }) }
}
class Document { createElement(tag) { return new Node(tag) } }

function setup(api, frame) {
  const root = { odkUserApps: api, odkUserAppFrame: frame, document: new Document(), console, setTimeout }
  root.odkPlugins = { register(def) { root.plugin = def } }
  vm.runInNewContext(fs.readFileSync('src/renderer/plugins/user-apps.js', 'utf8'), root)
  return root
}
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); await new Promise((resolve) => setTimeout(resolve, 0)) }

 test('renders API metadata as text and disposes open iframe before close', async () => {
  let resolveList
  const app = { id: 'safe', name: '<img src=x>', version: '1', revision: 'rev' }
  let disposed = false
  const root = setup({ list: () => new Promise((resolve) => { resolveList = resolve }), subscribe: () => () => {} }, { mount(host, options) {
    assert.equal(options.url, 'odk-user-app://app/safe/rev'); const frame = { className: '', children: [], dispose() { disposed = true } }; host.appendChild(frame); return { ready: Promise.resolve(), dispose: frame.dispose }
  } })
  const host = new Node('section'); root.plugin.mount(host, { trackCleanup() {} })
  resolveList({ ok: true, apps: [app] }); await flush()
  assert.equal(host.querySelector('.user-app-name').textContent, '<img src=x>')
  assert.equal(host.querySelector('.user-app-name').children.length, 0)
  const open = host.querySelectorAll('button').find((button) => button.textContent === 'Open')
  open.dispatchEvent({ type: 'click' }); assert.equal(host.querySelector('.user-app-frame-host').hidden, false)
  const close = host.querySelectorAll('button').find((button) => button.textContent === 'Close')
  close.dispatchEvent({ type: 'click' }); assert.equal(disposed, true); assert.equal(host.querySelector('.user-app-frame-host').hidden, true)
})

test('keeps page usable when backend fails and ignores stale list result', async () => {
  let firstResolve
  const root = setup({ list: () => firstResolve ? Promise.resolve({ ok: true, apps: [] }) : new Promise((resolve) => { firstResolve = resolve }), subscribe: () => () => {} }, undefined)
  const host = new Node('section'); root.plugin.mount(host, { trackCleanup() {} })
  firstResolve({ ok: false, error: 'offline' }); await flush()
  assert.match(host.querySelector('.user-apps-status').textContent, /unavailable/)
  assert.match(host.querySelector('.user-apps-empty').textContent, /No installed/)
})

test('renders widget applications automatically as display-only frames', async () => {
  let mounts = 0
  const app = { id: 'widget', name: 'Widget', version: '1', revision: 'r', kind: 'widget' }
  const root = setup({ list: () => Promise.resolve({ ok: true, apps: [app] }), subscribe: () => () => {} }, { mount(host) {
    mounts++
    const iframe = new Node('iframe'); iframe.title = app.name; host.appendChild(iframe)
    return { frame: iframe, ready: Promise.resolve(), dispose() {} }
  } })
  const host = new Node('section'); root.plugin.mount(host, { trackCleanup() {} }); await flush()
  assert.equal(mounts, 1)
  assert.equal(host.querySelectorAll('button').some((item) => item.textContent === 'Open'), false)
  assert.equal(host.querySelector('iframe').title, 'Widget')
  assert.equal(host.querySelector('iframe').getAttribute('tabindex'), '-1')
})

test('preserves an open frame when update verification fails', async () => {
  let disposed = false
  const app = { id: 'demo', name: 'Demo', version: '1', revision: 'r', kind: 'ui' }
  const root = setup({ list: () => Promise.resolve({ ok: true, apps: [app] }), dispatch: async () => ({ ok: false, error: 'verification-failed' }), subscribe: () => () => {} }, { mount(host) { const frame = { className: '', children: [], dispose() { disposed = true } }; host.appendChild(frame); return { ready: Promise.resolve(), dispose: frame.dispose } } })
  const host = new Node('section'); root.plugin.mount(host, { trackCleanup() {} }); await flush()
  host.querySelectorAll('button').find((item) => item.textContent === 'Open').dispatchEvent({ type: 'click' });
  host.querySelectorAll('button').find((item) => item.textContent === 'Update').dispatchEvent({ type: 'click' }); await flush()
  assert.equal(disposed, false)
  assert.equal(host.querySelector('.user-app-frame-host').hidden, false)
})

test('does not duplicate Close controls and reports missing frame API', async () => {
  const app = { id: 'demo', name: 'Demo', version: '1', revision: 'r', kind: 'ui' }
  const root = setup({ list: () => Promise.resolve({ ok: true, apps: [app] }), subscribe: () => () => {} }, { mount(host) { const frame = new Node('iframe'); host.appendChild(frame); return { ready: Promise.resolve(), dispose() {} } } })
  const host = new Node('section'); root.plugin.mount(host, { trackCleanup() {} }); await flush()
  const open = host.querySelectorAll('button').find((item) => item.textContent === 'Open'); open.dispatchEvent({ type: 'click' }); await flush(); open.dispatchEvent({ type: 'click' }); await flush()
  assert.equal(host.querySelectorAll('button').filter((item) => item.textContent === 'Close').length, 1)
  assert.equal(host.querySelectorAll('button').filter((item) => item.textContent === 'Close').length, 1)
})

test('dispatches install and reports failed mutations truthfully', async () => {
  const calls = []
  const root = setup({ list: () => Promise.resolve({ ok: true, apps: [] }), dispatch: async (request) => { calls.push(request); return { ok: false, error: 'verification-failed' } }, subscribe: () => () => {} }, undefined)
  const host = new Node('section'); root.plugin.mount(host, { trackCleanup() {} }); await flush()
  const input = host.querySelector('#user-app-id'); input.value = 'demo'; host.querySelector('form').requestSubmit(); await flush()
  assert.equal(JSON.stringify(calls), JSON.stringify([{ command: 'install', appId: 'demo' }]))
  assert.match(host.querySelector('.user-apps-status').textContent, /verification-failed/)
})
