const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const tileSource = fs.readFileSync('src/renderer/plugins/futu.js', 'utf8')

function mountWith(reading, height = 400) {
  const nodes = new Map()
  const attributes = new Map()
  const el = {
    innerHTML: '',
    dataset: {},
    clientHeight: height,
    querySelector(selector) {
      if (!nodes.has(selector)) {
        nodes.set(selector, {
          textContent: '',
          className: '',
          style: {},
          scrollWidth: 0,
          clientWidth: 100,
          setAttribute: (name, value) => attributes.set(`${selector}:${name}`, value),
        })
      }
      return nodes.get(selector)
    },
  }
  const root = { odkPlatform: { getFutuHoldings: async () => reading } }
  const sandbox = { window: root, globalThis: root }
  vm.runInContext(registrySource, vm.createContext(sandbox))
  vm.runInContext(tileSource, vm.createContext(sandbox))
  root.odkPlugins.activate(root.odkPlugins.get('odk.tile.futu'), el, { onTick: () => () => {} })
  return new Promise((resolve) => setTimeout(() => resolve({ el, nodes, attributes }), 50))
}

test('live tile shows day ratio plus top holdings ratios without amounts', async () => {
  const { el, nodes } = await mountWith({ state: 'live', snapshot: { totals: { plRatio: 0.0235, dayByCcy: { USD: 1240.5 } }, positions: [
    { code: 'US.TEM', marketVal: 7311, dayRatio: 0.031 },
    { code: 'US.SDGR', marketVal: 5373, dayRatio: -0.012 },
    { code: 'US.TSLA', marketVal: 7067, dayRatio: 0.005 },
    { code: 'US.PATH', marketVal: 1377, dayRatio: 0.08 },
    { code: 'US.QS', marketVal: 1032, dayRatio: -0.05 },
  ] } })
  assert.equal(nodes.get('#futu-value').textContent, '+2.35%')
  assert.match(el.innerHTML, /Holdings/)
  const rows = nodes.get('#futu-rows').innerHTML
  assert.match(rows, /TEM/)
  assert.match(rows, /\+3\.10%/)
  assert.match(rows, /-1\.20%/)
  assert.match(rows, /futu-pill is-gain/)
  assert.match(rows, /futu-pill is-loss/)
  assert.doesNotMatch(rows, /PATH/)
  assert.doesNotMatch(rows, /QS/)
  assert.doesNotMatch(rows, /1,240|1240/)
})

test('compact tile shows three current prices and missing prices honestly', async () => {
  const { nodes } = await mountWith({ state: 'live', snapshot: { totals: { plRatio: 0.01 }, positions: [
    { code: 'US.TEM', price: 64.25, dayRatio: 0.03 },
    { code: 'US.SDGR', price: null, dayRatio: -0.01 },
    { code: 'US.TSLA', price: 345.6, dayRatio: 0.02 },
  ] } }, 220)
  const rows = nodes.get('#futu-rows').innerHTML
  assert.match(rows, /64\.25/)
  assert.match(rows, /345\.60/)
  assert.match(rows, /futu-price[^>]*>--</)
  assert.equal((rows.match(/class="futu-holding"/g) || []).length, 3)
})

test('empty positions render no ratio instead of zero', async () => {
  const { nodes } = await mountWith({ state: 'live', snapshot: { totals: { plRatio: 0 }, positions: [] } })
  assert.equal(nodes.get('#futu-value').textContent, '--')
  assert.equal(nodes.get('#futu-detail').textContent, 'No positions')
})

test('stale snapshot renders dimmed values with an explicit stale label', async () => {
  const updatedAt = new Date(2026, 8, 18, 14, 32).getTime()
  const { nodes } = await mountWith({ state: 'unavailable', error: 'stale snapshot', updatedAt,
    snapshot: { totals: { plRatio: 0.0235 }, positions: [{ code: 'US.TEM', marketVal: 7311, dayRatio: 0.031 }] } })
  assert.equal(nodes.get('#futu-value').textContent, '+2.35%')
  assert.match(nodes.get('#futu-value').className, /is-stale/)
  assert.match(nodes.get('#futu-detail').textContent, /Stale/)
})

test('non-live states render short honest labels without numbers', async () => {
  for (const [state, label] of [['unconfigured', 'Not configured'], ['needs-auth', 'Trade unlock needed'], ['unavailable', 'Holdings unavailable'], ['syncing', 'Syncing holdings']]) {
    const { nodes } = await mountWith({ state })
    assert.equal(nodes.get('#futu-value').textContent, '--')
    assert.equal(nodes.get('#futu-detail').textContent, label)
  }
})
