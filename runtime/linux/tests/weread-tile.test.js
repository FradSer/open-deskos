const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const wereadSource = fs.readFileSync('src/renderer/plugins/weread.js', 'utf8')

function stubNode() {
  return {
    textContent: '',
    hidden: false,
    style: {},
    clientHeight: 600,
    offsetHeight: 0,
    scrollHeight: 100,
    classList: { toggle() {} },
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

async function mountWith(highlightResult, width = 900) {
  const root = {}
  const sandbox = {
    window: root,
    globalThis: root,
    getComputedStyle: () => ({ paddingTop: '0', paddingBottom: '0' }),
  }
  vm.runInContext(registrySource, vm.createContext(sandbox))
  root.odkPlatform = { getWeReadHighlight: () => Promise.resolve(highlightResult) }
  vm.runInContext(wereadSource, vm.createContext(sandbox))
  const { el, nodes } = createTile()
  el.querySelector('.weread-copy').clientWidth = width
  root.odkPlugins.activate(root.odkPlugins.get('odk.tile.weread'), el, { onTick: () => () => {} })
  await new Promise((resolve) => setImmediate(resolve))
  const text = (selector) => nodes.get(selector)?.textContent
  return { nodes, text }
}

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
