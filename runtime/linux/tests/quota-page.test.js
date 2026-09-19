'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/quota-page.js'), 'utf8')

function mount(status, refresh = () => Promise.resolve()) {
  const nodes = new Map()
  const cleanups = []
  const node = () => ({ textContent: '', innerHTML: '', disabled: false, attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v }, removeAttribute(k) { delete this.attrs[k] },
    addEventListener(k, v) { this.listeners[k] = v }, removeEventListener(k) { delete this.listeners[k] } })
  const el = { innerHTML: '', querySelector(key) { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key) } }
  let plugin, notify
  vm.runInNewContext(source, { document: { createElement: () => ({ textContent: '', get innerHTML() { return this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') } }) }, window: { odkPlugins: { register(p) { plugin = p } } } })
  plugin.mount(el, { trackCleanup(fn) { cleanups.push(fn) }, subscription: {
    status: () => status, lastCheck: () => 'Last checked 12:00', refresh,
    subscribe(fn) { notify = fn; fn(status); return () => {} },
  } })
  return { el, nodes, update(next) { status = next; notify(next) }, settle: () => new Promise(setImmediate), cleanups }
}
const account = (remainingPct) => ({ provider: 'codex', fileName: 'work-account.json', plan: 'Pro', groups: [{ title: 'Codex limits', quotas: [{ label: 'Weekly limit', remainingPct, resetAt: '2027-01-01T00:00:00Z' }] }] })
const live = (value) => ({ state: 'available', snapshot: { accounts: [account(value)] } })

test('subscription cards communicate actionable states without merging percentages', async () => {
  for (const [value, state] of [[0, 'Exhausted'], [12, 'Running low'], [80, 'Available'], [null, 'Quota unknown']]) {
    const item = { ...account(value), account: 'work@example.com', resetCredits: { available: 2, expiresAt: [] } }
    const page = mount({ state: 'available', snapshot: { accounts: [item] } }); await page.settle()
    const html = page.nodes.get('#quota-metrics').innerHTML
    assert.match(html, new RegExp(state))
    assert.match(html, /work@example.com/)
    assert.match(html, /<details[^>]*class="provider-details"/)
    assert.ok(html.indexOf('Weekly limit') < html.indexOf('Reset credits'))
  }
})

test('subscription count includes failed accounts and does not invent zero before retrieval', async () => {
  const page = mount({ state: 'unconfigured' }); await page.settle()
  assert.equal(page.el.querySelector('#quota-count').textContent, 'Subscriptions unavailable')
  page.update({ state: 'available', snapshot: { accounts: [account(58), { provider: 'xai', error: 'offline' }] } })
  assert.equal(page.el.querySelector('#quota-count').textContent, '2 subscriptions')
})

test('provider hierarchy and remaining semantics preserve account provenance', async () => {
  const page = mount(live(58)); await page.settle()
  const html = page.nodes.get('#quota-metrics').innerHTML
  assert.match(html, /<h2[^>]*>Codex<\/h2>/)
  assert.match(html, /work-account.json/)
  assert.match(html, /58%<\/span>\s*<span[^>]*>remaining/)
  assert.match(html, /aria-valuetext="58% remaining"/)
  assert.match(html, /Resets/)
})
test('invalid readings never become empty numeric meters while zero stays real', async () => {
  for (const value of [null, undefined, NaN, Infinity, -1, 101, '58']) {
    const page = mount(live(value)); await page.settle()
    const html = page.nodes.get('#quota-metrics').innerHTML
    assert.match(html, /Unavailable/)
    assert.doesNotMatch(html, /role="meter"/)
  }
  const page = mount(live(0)); await page.settle()
  assert.match(page.nodes.get('#quota-metrics').innerHTML, /aria-valuenow="0"/)
})
test('refresh rejection is handled, retains accounts and restores action', async () => {
  let reject
  const page = mount(live(58), () => new Promise((_, r) => { reject = r }))
  assert.equal(page.nodes.get('#quota-refresh').disabled, true)
  assert.match(page.nodes.get('#quota-feedback').textContent, /Refreshing/)
  reject(new Error('offline')); await page.settle()
  assert.equal(page.nodes.get('#quota-refresh').disabled, false)
  assert.match(page.nodes.get('#quota-feedback').textContent, /Refresh failed.*try again/i)
  assert.match(page.nodes.get('#quota-metrics').innerHTML, /58%/)
})
test('partial failures and unauthorized snapshots cannot claim fresh data', async () => {
  const page = mount({ state: 'available', snapshot: { accounts: [account(58), { provider: 'xai', fileName: 'other.json', error: 'Unavailable upstream' }] } }); await page.settle()
  assert.match(page.nodes.get('#quota-feedback').textContent, /1 of 2 accounts available/)
  page.update({ ...live(58), state: 'unauthorized' })
  assert.match(page.nodes.get('#quota-feedback').textContent, /credential/i)
  assert.match(page.nodes.get('#quota-feedback').textContent, /previous/i)
})
