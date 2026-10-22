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
  assert.match(html, /<strong>work-account.json<\/strong>/)
  assert.match(html, /<p class="provider-plan">Codex · Pro<\/p>/)
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

// The Home Widget reads the same service. It states one reading and owns no
// control, so these cases assert the text, the meter, and the silence of an
// unchanged reading.
function mountTile(status, refresh) {
  const nodes = new Map()
  const cleanups = []
  const writes = []
  const node = (key) => {
    if (nodes.has(key)) return nodes.get(key)
    const classes = new Set()
    const created = {
      textContent: '', hidden: false, attrs: {}, classes, listeners: {},
      _width: '',
      style: { get width() { return this._width }, set width(value) { this._width = value; writes.push([key, 'width', value]) } },
      setAttribute(k, v) { this.attrs[k] = v },
      getAttribute(k) { return this.attrs[k] ?? null },
      removeAttribute(k) { delete this.attrs[k] },
      addEventListener(k, v) { this.listeners[k] = v },
      removeEventListener(k, v) { delete this.listeners[k] },
      classList: {
        contains: (value) => classes.has(value),
        toggle: (value, force) => { if (force) classes.add(value); else classes.delete(value) },
      },
    }
    Object.defineProperty(created, 'textContent', {
      get() { return this._text },
      set(value) { writes.push([key, 'text']); this._text = value },
    })
    nodes.set(key, created)
    return created
  }
  const el = { innerHTML: '', querySelector(key) { return node(key) } }
  const registered = []
  let tick
  vm.runInNewContext(source, { document: { createElement: () => ({ textContent: '', get innerHTML() { return this.textContent } }) },
    window: { odkPlugins: { register(value) { registered.push(value) } } } })
  const plugin = registered.find(value => value.id === 'odk.tile.quota')
  assert.ok(plugin, 'odk.tile.quota must be registered')
  const subscription = { status: () => status, refresh }
  plugin.mount(el, { trackCleanup(fn) { cleanups.push(fn) }, subscription, onTick(fn) { tick = fn } })
  const meter = () => nodes.get('.quota-tile-meter')
  return { plugin, el, nodes, writes, cleanups,
    update(next) { status = next; tick(new Date()) },
    text: (key) => nodes.get(key)?.textContent,
    attr: (key, name) => nodes.get(key)?.getAttribute(name),
    // The meter is the one place this Widget could invent a reading, so every
    // case asserts its hidden state, its accessible numbers, and its fill.
    meter: () => ({
      hidden: meter()?.hidden,
      now: meter()?.getAttribute('aria-valuenow'),
      spoken: meter()?.getAttribute('aria-valuetext'),
      label: meter()?.getAttribute('aria-label'),
      width: nodes.get('.quota-tile-meter-fill')?.style.width,
      low: nodes.get('.quota-tile-meter-fill')?.classList.contains('is-low'),
      rule: nodes.get('.quota-tile-unknown')?.hidden === false,
    }) }
}

const windows = (values) => ({ state: 'available', snapshot: { accounts: values.map(([label, remainingPct], index) => ({
  provider: 'codex', fileName: `account-${index}.json`, groups: [{ title: 'Codex limits', quotas: [{ label, remainingPct, resetAt: null }] }],
})) } })

// One account states both of its Codex windows, which is what the provider does.
const statedWindows = (quotas, index = 0) => ({ state: 'available', snapshot: { accounts: [{
  provider: 'codex', fileName: `account-${index}.json`,
  groups: [{ title: 'Codex limits', quotas: quotas.map(([label, remainingPct, horizon]) => ({ label, remainingPct, resetAt: null, horizon })) }],
}] } })

test('the AI usage Widget reports the allowance its subscription states', () => {
  const tile = mountTile(statedWindows([['Weekly limit', 58, 'long'], ['5 hour limit', 12, 'short']]))
  assert.equal(tile.plugin.kind, 'tile')
  assert.equal(tile.plugin.interaction, 'display-only')
  assert.equal(tile.plugin.opensApp, 'quota')
  assert.doesNotMatch(tile.el.innerHTML, /<button|Refresh/)
  assert.equal(tile.text('.quota-state'), 'Available')
  assert.equal(tile.text('.quota-tile-value'), '58%')
  assert.equal(tile.text('.quota-tile-context'), 'Weekly limit')
  assert.deepEqual(tile.meter(), { hidden: false, now: '58', spoken: '58% remaining', label: 'Weekly limit', width: '58%', low: false, rule: false })
  const mixed=statedWindows([['Weekly limit',58,'long'],['5 hour limit',12,'short']])
  mixed.snapshot.accounts.push(statedWindows([['Short limit',1,'short']],1).snapshot.accounts[0])
  tile.update(mixed)
  assert.equal(tile.text('.quota-tile-value'),'58%','another account cannot replace an available weekly allowance with its short window')
  assert.equal(tile.text('.quota-tile-context'),'Weekly limit')
})

test('the AI usage Widget falls back to the tightest window an account states', () => {
  // A provider that reports no window length keeps the previous reading: the window
  // that can stop work now is the one the desk reports.
  const tile = mountTile(statedWindows([['Five hourly window', 76], ['Billing period', 12]]))
  assert.equal(tile.text('.quota-state'), 'Low')
  assert.equal(tile.text('.quota-tile-value'), '12%')
  assert.equal(tile.text('.quota-tile-context'), 'Billing period')
  assert.deepEqual(tile.meter(), { hidden: false, now: '12', spoken: '12% remaining', label: 'Billing period', width: '12%', low: true, rule: false })
})

test('the AI usage Widget states a healthy window and every unavailable reading honestly', () => {
  const tile = mountTile(windows([['Weekly limit', 58], ['5 hour limit', 80]]))
  assert.equal(tile.text('.quota-state'), 'Available')
  assert.equal(tile.text('.quota-tile-value'), '58%')
  assert.deepEqual(tile.meter(), { hidden: false, now: '58', spoken: '58% remaining', label: 'Weekly limit', width: '58%', low: false, rule: false })

  tile.update({ state: 'unconfigured' })
  assert.equal(tile.text('.quota-state'), 'Unconfigured')
  assert.equal(tile.text('.quota-tile-value'), '--%')
  assert.deepEqual(tile.meter(), { hidden: true, now: null, spoken: null, label: null, width: '0%', low: false, rule: true })

  tile.update({ state: 'unauthorized' })
  assert.equal(tile.text('.quota-state'), 'Unauthorized')
  assert.equal(tile.text('.quota-tile-context'), 'Renew access')
  assert.deepEqual(tile.meter(), { hidden: true, now: null, spoken: null, label: null, width: '0%', low: false, rule: true })

  tile.update({ state: 'unavailable' })
  assert.equal(tile.text('.quota-state'), 'Unavailable')
  assert.equal(tile.text('.quota-tile-value'), '--%')
  assert.deepEqual(tile.meter(), { hidden: true, now: null, spoken: null, label: null, width: '0%', low: false, rule: true })
})

test('the AI usage Widget counts accounts with no usable window and invents no percentage', () => {
  const tile = mountTile({ state: 'available', snapshot: { accounts: [account(null), account(null)] } })
  assert.equal(tile.text('.quota-state'), 'Available')
  assert.equal(tile.text('.quota-tile-value'), '2')
  assert.equal(tile.text('.quota-tile-context'), '2 accounts')
  assert.deepEqual(tile.meter(), { hidden: true, now: null, spoken: null, label: null, width: '0%', low: false, rule: true })

  // A malformed percentage is the same path: no meter at all.
  tile.update(windows([['Weekly limit', 'not-a-number'], ['5 hour limit', null]]))
  assert.equal(tile.text('.quota-tile-value'), '2')
  assert.deepEqual(tile.meter(), { hidden: true, now: null, spoken: null, label: null, width: '0%', low: false, rule: true })

  tile.update({ state: 'available', snapshot: { accounts: [account(0)] } })
  assert.equal(tile.text('.quota-state'), 'Low')
  assert.equal(tile.text('.quota-tile-value'), '0%')
  assert.deepEqual(tile.meter(), { hidden: false, now: '0', spoken: '0% remaining', label: 'Weekly limit', width: '0%', low: true, rule: false })

  tile.update({ state: 'available', snapshot: { accounts: [] } })
  assert.equal(tile.text('.quota-tile-value'), '--%')
  assert.equal(tile.text('.quota-state'), 'No data')
  assert.equal(tile.text('.quota-tile-context'), 'Open to refresh')
  assert.deepEqual(tile.meter(), { hidden: true, now: null, spoken: null, label: null, width: '0%', low: false, rule: true })
})

test('the AI usage Widget rewrites nothing while its reading is unchanged', () => {
  const tile = mountTile(windows([['Weekly limit', 58]]))
  const settled = tile.writes.length
  tile.update(windows([['Weekly limit', 58]]))
  assert.equal(tile.writes.length, settled)

  for (const cleanup of tile.cleanups.splice(0)) cleanup()
  tile.update(windows([['Weekly limit', 12]]))
  assert.equal(tile.text('.quota-tile-value'), '58%')
})

test('failed accounts cannot supply a current Widget meter', () => {
  const failed = { ...account(12), error: 'offline' }
  const tile = mountTile({ state: 'available', snapshot: { accounts: [failed, account(58)] } })
  assert.equal(tile.text('.quota-tile-value'), '58%')
  tile.update({ state: 'available', snapshot: { accounts: [failed] } })
  assert.equal(tile.text('.quota-state'), 'Unavailable')
  assert.equal(tile.text('.quota-tile-value'), '--%')
  assert.equal(tile.meter().hidden, true)
})

test('a low raw reading stays low when its displayed percentage rounds up', () => {
  const tile = mountTile(live(24.6))
  assert.equal(tile.text('.quota-tile-value'), '25%')
  assert.equal(tile.text('.quota-state'), 'Low')
  assert.equal(tile.meter().low, true)
})

// Given a newly mounted Widget, the first reading must not wait for the minute timer.
test('the usage Widget requests its initial shared reading and ignores completion after release', async () => {
  let calls = 0, complete
  const tile = mountTile({ state: 'unconfigured' }, () => { calls++; return new Promise(resolve => { complete = resolve }) })
  await new Promise(setImmediate)
  assert.equal(calls, 1)
  tile.update(windows([['Weekly window', 64]]))
  tile.cleanups.forEach(fn => fn())
  tile.writes.length = 0
  complete()
  await new Promise(setImmediate)
  assert.equal(tile.writes.length, 0)
})


test('the quota Widget identifies the service that owns its reported window', () => {
  const status = windows([['Weekly', 58], ['5 hour', 12]])
  status.snapshot.accounts[1].provider = 'antigravity'
  const tile = mountTile(status)
  assert.equal(tile.text('.widget-heading'), 'Antigravity')
  tile.update(windows([['Weekly', 58]]))
  assert.equal(tile.text('.widget-heading'), 'ChatGPT')
  tile.update({ state: 'unconfigured' })
  assert.equal(tile.text('.widget-heading'), 'AI usage')
  assert.equal(tile.text('.quota-tile-context'), 'Connect an account')
})
