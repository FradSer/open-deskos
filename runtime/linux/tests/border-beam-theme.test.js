const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const renderer = path.join(__dirname, '../src/renderer')
function load(saved = undefined, blocked = false) {
  const attributes = {}
  const listeners = {}
  const root = { dataset: {}, setAttribute(k, v) { attributes[k] = v } }
  let stored = saved
  const storage = {
    getItem() { if (blocked) throw Error('denied'); return stored },
    setItem(key, value) { if (blocked) throw Error('denied'); stored = value },
  }
  const window = { localStorage: storage }
  const document = { documentElement: root, hidden: false,
    addEventListener(k, fn) { listeners[k] = fn } }
  vm.runInNewContext(fs.readFileSync(path.join(renderer, 'core/theme.js'), 'utf8'), { window, document })
  return { window, document, root, listeners, saved: () => stored }
}

test('theme defaults, validates and persists an explicit selection', () => {
  const env = load()
  assert.equal(env.root.dataset.theme, 'pixel')
  env.window.odkTheme.set('instrument')
  assert.equal(env.root.dataset.theme, 'instrument')
  assert.equal(env.saved(), 'instrument')
  assert.equal(load(env.saved()).root.dataset.theme, 'instrument')
  env.window.odkTheme.set('border-beam')
  assert.equal(env.root.dataset.theme, 'border-beam')
  assert.equal(env.saved(), 'border-beam')
  assert.equal(load(env.saved()).root.dataset.theme, 'border-beam')
  env.window.odkTheme.set('unknown')
  assert.equal(env.root.dataset.theme, 'instrument')
  assert.equal(load('unknown').root.dataset.theme, 'instrument')
})

test('storage failure cannot prevent theme switching; hidden documents pause', () => {
  const env = load(null, true)
  env.window.odkTheme.set('border-beam')
  assert.equal(env.root.dataset.theme, 'border-beam')
  env.document.hidden = true
  env.listeners.visibilitychange()
  assert.equal(env.root.dataset.themePaused, 'true')
})

test('theme is loaded before content and effects are scoped and input transparent', () => {
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  assert.ok(html.indexOf('core/theme.js') >= 0)
  assert.ok(html.indexOf('core/theme.js') < html.indexOf('<body>'))
  assert.match(html, /themes\/border-beam.css/)
  assert.doesNotMatch(html, /plugins\/status-theme.js/)
  const css = fs.readFileSync(path.join(renderer, 'themes/border-beam.css'), 'utf8')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /pointer-events: none/)
  assert.match(css, /mask-composite: exclude/)
  assert.match(css, /conic-gradient/)
  assert.match(css, /animation-play-state: paused/)
})
