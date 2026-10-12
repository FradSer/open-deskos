const nodeTest = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const wereadSource = fs.readFileSync('src/renderer/plugins/weread.js', 'utf8')

for (const independent of [false, true]) {
const test = (name, ...args) => nodeTest(`${independent ? 'independent' : 'default'} WeRead ${name}`, ...args)

function stubNode() {
  return {
    textContent: '',
    hidden: false,
    style: {},
    clientHeight: 600,
    offsetHeight: 0,
    scrollHeight: 100,
    classList: { toggle() {} },
    handlers: new Map(),
    addEventListener(name, handler) { this.handlers.set(name, handler) },
  }
}

function createTile() {
  const nodes = new Map()
  const el = {
    innerHTML: '',
    clientHeight: 700,
    replaceChildren() {},
    querySelector(selector) {
      if (!nodes.has(selector)) {
        const node = stubNode()
        if (selector === '.weread-foot') node.offsetHeight = 140
        nodes.set(selector, node)
      }
      return nodes.get(selector)
    },
  }
  return { el, nodes }
}

async function mountWith(highlightResult, width = 900, layout = {}) {
  const root = { odkPluginHost: require('../src/plugin-host') }
  const sandbox = {
    structuredClone,
    window: root,
    globalThis: root,
    getComputedStyle: () => ({ paddingTop: '0', paddingBottom: '0', rowGap: layout.gap }),
    ...layout.globals,
  }
  vm.runInContext(registrySource, vm.createContext(sandbox))
  root.odkPlatform = { getWeReadHighlight: layout.read || (() => Promise.resolve(highlightResult)) }
  const contextVM = vm.createContext(sandbox)
  vm.runInContext(wereadSource, contextVM)
  if (independent) {
    let selected
    root.odkRendererDevelopment = { define(definition) { selected = definition } }
    vm.runInContext(fs.readFileSync('tests/fixtures/weread-surface-replacement/entry.js', 'utf8'), contextVM)
    await root.odkPlugins.start({ replacements: [selected] })
  }
  const { el, nodes } = createTile()
  el.querySelector('.weread-copy').clientWidth = width
  if (layout.scrollHeight) Object.defineProperty(el.querySelector('.weread-text'), 'scrollHeight', {
    get: () => layout.scrollHeight(nodes.get('.weread-text').style.fontSize),
  })
  if (layout.clientHeight !== undefined) el.querySelector('.weread-text').clientHeight = layout.clientHeight
  const context = { onTick: layout.onTick || (() => () => {}) }
  const definition = root.odkPlugins.get('odk.tile.weread')
  assert.equal(root.odkPlugins.activate(definition, el, context), true)
  await new Promise((resolve) => setImmediate(resolve))
  const text = (selector) => nodes.get(selector)?.textContent
  return { nodes, text, root, el, context, definition }
}

for (const outcome of ['resolve', 'reject']) {
  test(`released reading ${outcome} cannot overwrite remounted content`, async () => {
    let complete
    const pending = new Promise((resolve, reject) => { complete = outcome === 'resolve' ? resolve : reject })
    const fixture = await mountWith(null, 900, { read: () => pending })
    const { root, el, context, definition, text } = fixture
    await root.odkPlugins.deactivate(definition, el)
    root.odkPlatform.getWeReadHighlight = () => Promise.resolve({ status: 'live', highlight: { title: 'New book', markText: 'New reading' } })
    assert.equal(root.odkPlugins.activate(definition, el, context), true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(text('.weread-text'), 'New reading')
    complete(outcome === 'resolve' ? { status: 'live', highlight: { title: 'Old book', markText: 'Old reading' } } : Error('Old failure'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(text('.weread-text'), 'New reading')
    assert.equal(text('.weread-title'), 'New book')
    await root.odkPlugins.deactivate(definition, el)
  })
}

test('release cancels fitting and retains failed observer cleanup for retry', async () => {
  const observers = []
  const frames = new Map()
  let frameId = 0
  let tick
  let removedTick = 0
  class Observer {
    constructor(callback) { this.callback = callback; this.calls = 0; observers.push(this) }
    observe(element) { this.element = element }
    disconnect() { if (++this.calls === 1) throw Error('Disconnect failed') }
  }
  const { root, el, definition } = await mountWith({ status: 'live', highlight: { title: 'Book', markText: 'Reading' } }, 900, {
    globals: { ResizeObserver: Observer,
      requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
      cancelAnimationFrame(id) { frames.delete(id) } },
    onTick(listener) { tick = listener; return () => { removedTick++ } },
  })
  assert.equal(observers.length, 1)
  const delayedFit = [...frames.values()]
  await assert.rejects(root.odkPlugins.deactivate(definition, el), /release failed/)
  assert.equal(frames.size, 0)
  assert.equal(removedTick, 1)
  el.querySelector = () => { throw Error('Released instance accessed nodes') }
  for (const callback of delayedFit) callback()
  observers[0].callback()
  tick()
  await root.odkPlugins.deactivate(definition, el)
  assert.equal(observers[0].calls, 2)
  assert.equal(removedTick, 1)
})

test('each remount receives its own resize observer', async () => {
  const observers = []
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
    observe(element) { this.element = element }
    disconnect() { this.disconnected = true }
  }
  const { root, el, context, definition } = await mountWith({ status: 'empty' }, 900, { globals: { ResizeObserver: Observer } })
  await root.odkPlugins.deactivate(definition, el)
  assert.equal(observers[0].disconnected, true)
  assert.equal(root.odkPlugins.activate(definition, el, context), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(observers.length, 2)
  assert.equal(observers[1].element, el)
  assert.equal(observers[1].disconnected, false)
  await root.odkPlugins.deactivate(definition, el)
  assert.equal(observers[1].disconnected, true)
})

test('superseded or released cover callbacks cannot change the current cover', async () => {
  const images = []
  const drawn = []
  let tick
  let reading = { status: 'live', highlight: { title: 'Book', markText: 'Reading', cover: 'first' } }
  class CoverImage { constructor() { this.naturalWidth = 2; this.naturalHeight = 4; images.push(this) } }
  const { root, el, context, definition, nodes } = await mountWith(null, 900, {
    read: () => Promise.resolve(reading), onTick(listener) { tick = listener; return () => {} },
    globals: { Image: CoverImage, document: { documentElement: { dataset: { theme: 'instrument' } } } },
  })
  const canvas = nodes.get('.weread-cover')
  canvas.getContext = () => ({ drawImage(image) { drawn.push(image.src) } })
  const oldLoad = images[0].onload
  const oldError = images[0].onerror
  reading = { ...reading, highlight: { ...reading.highlight, cover: 'second' } }
  tick()
  await new Promise(resolve => setImmediate(resolve))
  const current = images.at(-1)
  const currentLoad = current.onload
  const currentError = current.onerror
  currentLoad()
  assert.deepEqual(drawn, ['second'])
  oldLoad(); oldError()
  assert.deepEqual(drawn, ['second'])
  assert.equal(nodes.get('.weread-cover-wrap').hidden, false)
  reading = { ...reading, highlight: { ...reading.highlight, cover: '' } }
  for (let count = 0; count < 60; count++) tick()
  await new Promise(resolve => setImmediate(resolve))
  currentLoad(); currentError()
  assert.equal(nodes.get('.weread-cover-wrap').hidden, true)
  assert.deepEqual(drawn, ['second'])
  await root.odkPlugins.deactivate(definition, el)
  assert.equal(root.odkPlugins.activate(definition, el, context), true)
  await new Promise(resolve => setImmediate(resolve))
  nodes.get('.weread-cover-wrap').hidden = false
  currentLoad(); currentError()
  assert.equal(nodes.get('.weread-cover-wrap').hidden, false)
  assert.deepEqual(drawn, ['second'])
  await root.odkPlugins.deactivate(definition, el)
})

test('unchanged ticks retain pending cover decoding and failed theme-change loads remain retryable', async () => {
  const images = []
  let tick
  const document = { documentElement: { dataset: { theme: 'instrument' } } }
  class CoverImage { constructor() { this.naturalWidth = 2; this.naturalHeight = 4; images.push(this) } }
  const { root, el, definition, nodes } = await mountWith({ status: 'live', highlight: { title: 'Book', markText: 'Reading', cover: 'cover' } }, 900, {
    globals: { Image: CoverImage, document }, onTick(listener) { tick = listener; return () => {} },
  })
  nodes.get('.weread-cover').getContext = () => ({ drawImage() {} })
  for (let count = 0; count < 5; count++) tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(images.length, 1)
  assert.equal(images[0].src, 'cover')
  document.documentElement.dataset.theme = 'pixel'
  for (let count = 0; count < 5; count++) tick()
  assert.equal(images.length, 2)
  assert.equal(images[0].src, '')
  images[1].onerror()
  tick()
  assert.equal(images.length, 3)
  images[2].onload()
  tick()
  assert.equal(images.length, 3)
  await root.odkPlugins.deactivate(definition, el)
})

test('excerpt fitting reserves the resolved row gap instead of the fixed fallback', async () => {
  const result = await mountWith({ status: 'live', highlight: { title: 'Book', markText: 'Complete reading' } }, 900, {
    gap: '36px', scrollHeight: size => parseFloat(size) > 70 ? 430 : 420,
  })
  assert.equal(result.nodes.get('.weread-text').style.fontSize, '70px')
  assert.equal(result.text('.weread-text'), 'Complete reading')
})

test('the minimum-size excerpt keeps a vertical scroll path for complete source text', () => {
  const css = fs.readFileSync('src/renderer/plugins/weread.css', 'utf8')
  const excerpt = css.match(/\.w-weread \.weread-text\s*\{([^}]+)\}/)[1]
  assert.match(excerpt, /overflow-y:\s*auto/)
  assert.match(excerpt, /overflow-x:\s*hidden/)
})

test('overflowing excerpt owns vertical scroll keys and preserves Shell escape and horizontal navigation', async () => {
  const { nodes } = await mountWith({ status: 'live', highlight: { title: 'Book', markText: 'Complete reading' } }, 900, {
    gap: '36px', scrollHeight: () => 430, clientHeight: 44,
  })
  const text = nodes.get('.weread-text')
  assert.equal(text.style.fontSize, '14px')
  assert.equal(text.tabIndex, 0)
  const keydown = text.handlers.get('keydown')
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', 'ArrowLeft', 'ArrowRight']) {
    let stopped = false
    let prevented = false
    text.scrollTop = 25
    keydown({ key, stopPropagation() { stopped = true }, preventDefault() { prevented = true } })
    assert.equal(stopped, !['Escape', 'ArrowLeft', 'ArrowRight'].includes(key))
    assert.equal(prevented, ['Home', 'End'].includes(key))
    if (key === 'Home') assert.equal(text.scrollTop, 0)
    if (key === 'End') assert.equal(text.scrollTop, text.scrollHeight)
  }
  text.clientHeight = 500
  keydown({ key: 'ArrowDown', stopPropagation() { throw Error('Nonoverflowing text must retain page navigation') } })
})

test('fractional fitting steps cannot shrink below the fourteen pixel floor', async () => {
  const { nodes } = await mountWith({ status: 'live', highlight: { title: 'Book', markText: 'Complete reading' } }, 300, {
    gap: '36px', scrollHeight: () => 430, clientHeight: 44,
  })
  assert.equal(nodes.get('.weread-text').style.fontSize, '14px')
})

test('highlight meta splits into bracket-free title, author, and date lines', async () => {
  const { nodes, text } = await mountWith({
    status: 'ok',
    highlight: {
      title: '《道德经》',
      author: '老子',
      markText: '道可道，非常道',
      createTime: 1725800000,
      cover: '',
    },
  })
  assert.equal(text('.weread-title'), '道德经')
  assert.equal(text('.weread-author'), '老子')
  assert.equal(nodes.get('.weread-author').hidden, false)
  assert.match(text('.weread-date'), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(nodes.get('.weread-date').hidden, false)
  assert.equal(text('.weread-text'), '道可道，非常道')
  assert.equal(nodes.get('.weread-text').style.fontSize, '72px')
})

test('missing author and date collapse their lines without breaking fit', async () => {
  const { nodes, text } = await mountWith({
    status: 'ok',
    highlight: { title: 'WeRead', author: '', markText: 'hello', createTime: 0, cover: '' },
  })
  assert.equal(text('.weread-title'), 'WeRead')
  assert.equal(nodes.get('.weread-author').hidden, true)
  assert.equal(nodes.get('.weread-date').hidden, true)
  assert.match(nodes.get('.weread-text').style.fontSize, /^\d+px$/)
})

test('unconfigured state stays honest across the new lines', async () => {
  const { nodes, text } = await mountWith({ status: 'unconfigured', highlight: null })
  assert.equal(text('.weread-title'), 'Not configured')
  assert.equal(text('.weread-text'), 'Set WEREAD_API_KEY to sync')
  assert.equal(nodes.get('.weread-author').hidden, true)
  assert.equal(nodes.get('.weread-date').hidden, true)
})

test('excerpt responds to available width while author and date share a size', async () => {
  const state = { status: 'ok', highlight: { title: 'Book', markText: 'Responsive reading '.repeat(4) } }
  const wide = await mountWith(state, 900)
  const narrow = await mountWith(state, 300)
  assert.ok(parseFloat(wide.nodes.get('.weread-text').style.fontSize) > parseFloat(narrow.nodes.get('.weread-text').style.fontSize))
  const css = fs.readFileSync('src/renderer/plugins/weread.css', 'utf8')
  const size = role => css.match(new RegExp('\\.weread-' + role + ' \\{[^}]*font-size: ([^;]+)'))?.[1]
  assert.ok(size('author'))
  assert.equal(size('author'), size('date'))
})

test('cover follows book details on the right', () => {
  const css = fs.readFileSync('src/renderer/plugins/weread.css', 'utf8')
  assert.ok(wereadSource.indexOf('class="weread-meta"') < wereadSource.indexOf('class="weread-cover-wrap"'))
  assert.doesNotMatch(css, /order:\s*-1/)
})

test('excerpt uses the shared widget inset without an oversized horizontal gutter', () => {
  const css = fs.readFileSync('src/renderer/plugins/weread.css', 'utf8')
  const copy = css.match(/\.weread-copy\s*\{([^}]+)\}/)[1]
  assert.match(copy, /padding:\s*var\(--odk-widget-inset\)/)
})

}

nodeTest('independent WeRead stylesheet preserves the public visual snapshot', () => {
  assert.deepEqual(fs.readFileSync('tests/fixtures/weread-surface-replacement/weread.css'), fs.readFileSync('src/renderer/plugins/weread.css'))
})
