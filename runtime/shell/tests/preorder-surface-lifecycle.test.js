'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

test('geometry verification includes the Pre-order browser gate', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  assert.ok(manifest.scripts.geometry.includes('tests/preorder-surface-electron.test.js'))
})

async function fixture(t, independent = false, options = {}) {
  const images = [], ticks = new Set(), draws = [], painted = []
  let currentTheme = options.theme || 'instrument'
  function node() {
    return { children: [], className: '', classList: { toggle() {} },
      append(...children) { this.children.push(...children) },
      set textContent(value) { this.text = String(value); this.children = [] },
      get textContent() { return this.text || this.children.map(child => child.textContent).join('') } }
  }
  const count = node()
  const cover = { width: 0, height: 0, getContext() {
    return { drawImage(...args) { draws.push(args.slice(1)) },
      getImageData(_x, _y, width, height) {
        if (options.pixelDenied) throw Error('Controlled pixel buffer rejection')
        return { data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => (index * 17 + 3) % 256) }
      },
      putImageData(pixels) { painted.push(Array.from(pixels.data)) } }
  } }
  const figure = { clientWidth: options.width ?? 724, clientHeight: options.height ?? 434 }
  const element = { isConnected: true, innerHTML: '', replaceChildren() {}, querySelector(selector) {
    return { '.preorder-count': count, '.preorder-cover': cover, '.preorder-figure': figure }[selector]
  } }
  const document = { documentElement: { dataset: { theme: 'instrument' } }, createElement: node }
  const root = { odkPluginHost: { createPluginHost }, odkTheme: { get: () => currentTheme } }
  const context = vm.createContext({ window: root, document, Date, structuredClone, console,
    Image: class { constructor() { this.naturalWidth = options.sourceWidth || 1200; this.naturalHeight = options.sourceHeight || 900; images.push(this) } } })
  for (const file of ['core/registry.js', 'plugins/preorder.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  let replacement
  root.odkRendererDevelopment = { define(value) { replacement = value } }
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/preorder-surface-replacement/entry.js'), 'utf8'), context)
  root.odkPlugins.captureDefaults()
  if (independent) root.odkPlugins.get('odk.tile.preorder').lifecycle.mount = () => { throw Error('Default Pre-order delegation refused') }
  await root.odkPlugins.start({ replacements: independent ? [replacement] : [] })
  t.after(() => root.odkPlugins.stop())
  let captured
  let releaseFailures = options.failRelease ? 1 : 0
  assert.equal(root.odkPlugins.activate(root.odkPlugins.get('odk.tile.preorder'), element, { onTick(callback) {
    captured = callback
    ticks.add(callback)
    callback(new Date('2026-10-09T12:00:00Z'))
    return () => {
      if (releaseFailures-- > 0) throw Error('Controlled Tick release failure')
      ticks.delete(callback)
    }
  } }), true)
  return { images, draws, painted, ticks, count, cover, captured, registry: root.odkPlugins,
    setTheme: theme => { currentTheme = theme },
    unmount: () => root.odkPlugins.deactivate(root.odkPlugins.get('odk.tile.preorder'), element),
    snapshot: () => ({ text: count.textContent, width: cover.width, height: cover.height, draws: draws.length, images: images.length }) }
}

test('independent Pre-order preserves boundary times, crop geometry, and partial Pixel blocks', async t => {
  for (const theme of ['instrument', 'pixel', 'border-beam']) for (const [width, height] of [[8, 6], [3, 9], [1, 1], [722, 535]]) {
    const options = { theme, width, height, sourceWidth: 966, sourceHeight: 640 }
    const baseline = await fixture(t, false, options), independent = await fixture(t, true, options)
    for (const f of [baseline, independent]) f.images[0].onload()
    assert.deepEqual(independent.draws, baseline.draws)
    assert.deepEqual(independent.painted, baseline.painted)
    for (const time of ['2026-10-15T11:59:59.999Z', '2026-10-16T11:59:59.999Z',
      '2026-10-16T12:00:00Z', '2026-10-17T12:00:00Z', '2026-10-09T12:00:00Z']) {
      for (const f of [baseline, independent]) f.captured(new Date(time))
      assert.equal(independent.count.textContent, baseline.count.textContent)
    }
  }
})

test('independent Pre-order preserves standard drawing when Pixel buffer access fails', async t => {
  for (const independent of [false, true]) {
    const f = await fixture(t, independent, { theme: 'pixel', width: 3, height: 9, pixelDenied: true })
    assert.doesNotThrow(() => f.images[0].onload())
    assert.equal(f.draws.length, 1)
    assert.deepEqual(f.painted, [])
  }
})

for (const independent of [false, true]) {
  const implementation = independent ? 'independent' : 'default'
  test(`${implementation} Pre-order keeps the existing countdown and hero crop while active`, async t => {
    const f = await fixture(t, independent)
    assert.equal(f.count.textContent, '7d0h')
    f.images[0].onload()
    assert.equal(f.draws.length, 1)
    assert.equal(f.cover.width, 724)
    assert.equal(f.cover.height, 434)
    f.captured(new Date('2026-10-16T12:00:00Z'))
    assert.equal(f.count.textContent, 'Open now')
  })

  test(`${implementation} Pre-order ignores an image completion after disable`, async t => {
    const f = await fixture(t, independent)
    const loaded = f.images[0].onload
    await f.registry.setEnabled('odk.tile.preorder', false)
    assert.equal(f.ticks.size, 0)
    const before = f.snapshot()
    loaded()
    assert.deepEqual(f.snapshot(), before)
  })

  test(`${implementation} Pre-order ignores a captured Tick after disable`, async t => {
    const f = await fixture(t, independent)
    await f.registry.setEnabled('odk.tile.preorder', false)
    assert.equal(f.ticks.size, 0)
    const before = f.snapshot()
    f.captured(new Date('2026-10-16T12:00:00Z'))
    assert.deepEqual(f.snapshot(), before)
  })

  test(`${implementation} Pre-order ignores pending work after surface unmount without factory shutdown`, async t => {
    const f = await fixture(t, independent)
    const loaded = f.images[0].onload
    await f.unmount()
    assert.equal(f.ticks.size, 0)
    const before = f.snapshot()
    loaded()
    f.captured(new Date('2026-10-16T12:00:00Z'))
    assert.deepEqual(f.snapshot(), before)
  })

  test(`${implementation} Pre-order fences callbacks while failed Tick release remains retryable`, async t => {
    const f = await fixture(t, independent, { failRelease: true })
    const loaded = f.images[0].onload
    await assert.rejects(f.unmount())
    assert.equal(f.ticks.size, 1)
    const before = f.snapshot()
    loaded()
    f.captured(new Date('2026-10-16T12:00:00Z'))
    assert.deepEqual(f.snapshot(), before)
    await f.unmount()
    assert.equal(f.ticks.size, 0)
  })
}
