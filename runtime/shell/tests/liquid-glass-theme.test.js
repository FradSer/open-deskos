'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createAppearancePlugins } = require('../src/renderer/core/appearance-plugins')
const { createLiquidGlassAppearance } = require('../src/renderer/core/liquid-glass-appearance')

const renderer = path.join(__dirname, '../src/renderer')

test('Liquid Glass is the fourth built-in appearance and preserves Shell typography', () => {
  const plugins = createAppearancePlugins()
  assert.deepEqual(plugins.map(plugin => plugin.appearance.theme), ['instrument', 'pixel', 'border-beam', 'liquid-glass'])

  const plugin = plugins.find(item => item.appearance.theme === 'liquid-glass')
  assert.equal(plugin.manifest.id, 'odk.theme.liquid-glass')
  assert.equal(plugin.manifest.name, 'Liquid Glass')
  assert.equal(plugin.appearance.css, 'themes/liquid-glass.css')
  assert.deepEqual(plugin.appearance.faces, ['noto-sans-sc', 'montserrat-bold', 'zpix'])
  assert.equal(plugin.appearance.tokens['--odk-font'], '"Noto Sans SC", "Montserrat", "Zpix", sans-serif')
  assert.equal(plugin.appearance.tokens['--odk-radius-card'], '32px')
})

test('Liquid Glass uses the local SDK stylesheet and static accessibility fallback', () => {
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  const css = fs.readFileSync(path.join(renderer, 'themes/liquid-glass.css'), 'utf8')
  const appearance = fs.readFileSync(path.join(renderer, 'core/liquid-glass-appearance.js'), 'utf8')
  const frame = fs.readFileSync(path.join(renderer, 'card-frame.css'), 'utf8')
  assert.match(html, /href="card-frame\.css"/)

  assert.match(html, /core\/liquid-glass-appearance\.js/)
  assert.match(html, /id="liquid-glass-backdrop" class="lg-content" aria-hidden="true" hidden/)
  assert.match(css, /@glass-sdk\/liquid-glass\/dist\/styles\.css/)
  assert.match(frame, /data-liquid-glass='sdk'[\s\S]*?--odk-frame-fill: transparent;/)
  assert.match(frame, /data-liquid-glass='sdk'[\s\S]*?--odk-frame-filter: none;/)
  assert.match(css, /--odk-primary:\s*#f3f7fc/)
  assert.match(css, /--odk-radius-card:\s*32px/)
  assert.match(css, /#liquid-glass-backdrop\s*\{\s*position:\s*absolute;\s*inset:\s*0;/)
  assert.doesNotMatch(css, /#status-bar::before/)
  assert.match(frame, /--odk-frame-fill:\s*var\(--odk-glass-material\)/)
  assert.match(css, /prefers-reduced-transparency/)
  assert.match(css, /forced-colors/)
  assert.match(appearance, /requestAdapter/)
  assert.match(appearance, /glassScene\?\.dispose/)
  assert.match(appearance, /themes\/liquid-glass-sdk\.js/)
  assert.match(appearance, /prefers-reduced-transparency/)
})

test('Liquid Glass keeps Widgets visible while SDK clip paths are prepared', () => {
  const css = fs.readFileSync(path.join(renderer, 'card-frame.css'), 'utf8')
  assert.match(css, /html\[data-theme='liquid-glass'\] #home-desk :is\(\.widget, #app-view\)\.lg-surface\s*\{[^}]*visibility:\s*inherit;/)
})

function fakeElement(id, box, inViewport = false) {
  const classes = new Set()
  const children = []
  const element = {
    id,
    dataset: {},
    style: {},
    hidden: id === 'liquid-glass-backdrop',
    children,
    removed: false,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    },
    appendChild(child) { children.push(child); child.parentElement = element },
    remove() { this.removed = true; this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1) },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => box,
    closest: selector => selector === '#pages-viewport' && inViewport ? {} : null,
  }
  return element
}

function fakeAppearanceEnvironment({ sdk, adapter = true, voiceControl = false } = {}) {
  const rootBox = { left: 100, top: 0, right: 1000, bottom: 800, width: 900, height: 800 }
  const viewportBox = { left: 600, top: 200, right: 1000, bottom: 800, width: 400, height: 600 }
  const desk = fakeElement('home-desk', rootBox)
  const content = fakeElement('desk-content', rootBox)
  const backdrop = fakeElement('liquid-glass-backdrop', rootBox)
  const summary = fakeElement('home-summary', rootBox)
  const viewport = fakeElement('pages-viewport', viewportBox)
  const dash = fakeElement('dash', { left: 700, top: 80, right: 950, bottom: 180, width: 250, height: 100 })
  const widget = fakeElement('widget', { left: 650, top: 240, right: 800, bottom: 390, width: 150, height: 150 }, true)
  const card = fakeElement('app-view', rootBox)
  const mic = fakeElement('agent-mic', { left: 140, top: 700, right: 540, bottom: 750, width: 400, height: 50 })
  card.hidden = true
  let mutationCallback, scheduled
  const doc = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'liquid-glass' } },
    head: { appendChild() {} },
    getElementById(id) { return ({ 'home-desk': desk, 'desk-content': content, 'liquid-glass-backdrop': backdrop, 'home-summary': summary, 'pages-viewport': viewport, 'app-view': card })[id] },
    querySelectorAll(selector) { return selector.includes('#home-summary') ? [dash, widget] : [widget, ...(selector.includes('#app-view') && !card.hidden ? [card] : []), ...(voiceControl && selector.includes('.agent-mic') ? [mic] : [])] },
    createElement() { return fakeElement('unused', { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) },
    addEventListener() {},
  }
  const scenes = []
  const root = {
    navigator: adapter ? { gpu: { requestAdapter: async () => ({}) } } : {},
    odkLiquidGlassSdk: sdk,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: target => ({ borderTopLeftRadius: '24px', visibility: target.hidden ? 'hidden' : 'visible' }),
    addEventListener() {},
    removeEventListener() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(callback) { mutationCallback = callback } observe() {} disconnect() {} },
    requestAnimationFrame: callback => { scheduled = callback; return 1 },
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
  }
  return { root, doc, desk, content, backdrop, dash, widget, card, mic, scenes, reconcile() { mutationCallback(); scheduled() }, targets: () => [dash, widget], getScene: () => scenes[0], addScene(scene) { scenes.push(scene) } }
}

test('Personal Agent microphone shares the bounded Widget material lifecycle', async () => {
  const added = [], removed = []
  const environment = fakeAppearanceEnvironment({voiceControl:true,sdk:{createGlassScene(_root, options) {
    return {setContent() {}, addSurface(target, material) {
      added.push({target,material})
      options.onDiagnostic({surfaces:added.length,maps:added.length})
      return () => removed.push(target)
    },dispose() {}}
  }}})
  const controller = createLiquidGlassAppearance(environment.root,environment.doc)
  await controller.setActive(true)
  assert.ok(added.some(item=>item.target===environment.mic && item.material.material==='regular' && item.material.interactive===false))
  assert.ok(environment.mic.classList.contains('lg-surface'))
  await controller.setActive(false)
  assert.ok(removed.includes(environment.mic))
  assert.equal(environment.mic.classList.contains('lg-surface'),false)
})

test('Liquid Glass registers bounded SDK surfaces and disposes them on theme switch', async () => {
  const events = []
  let configuration
  const environment = fakeAppearanceEnvironment({ sdk: {
    createGlassScene(root, options) {
      configuration = { root, options }
      const scene = {
        setContent(content) { events.push(['content', content.id]) },
        addSurface(surface, options) {
          events.push(['surface', options, surface.id])
          const surfaces = events.filter(item => item[0] === 'surface').length
          configuration.options.onDiagnostic({ surfaces, maps: surfaces })
          return () => events.push(['remove', surface.id])
        },
        dispose() { events.push(['dispose']) },
      }
      environment.addScene(scene)
      return scene
    },
    clearMaterialMapCache() { events.push(['clear-cache']) },
  } })
  const controller = createLiquidGlassAppearance(environment.root, environment.doc)

  await controller.setActive(true)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass, 'sdk')
  assert.equal(configuration.root, environment.desk)
  assert.equal(configuration.options.maxSurfaces, 10)
  assert.deepEqual(events.filter(item => item[0] === 'content').map(item => item[1]), ['liquid-glass-backdrop'])
  assert.equal(environment.backdrop.hidden, false)
  assert.deepEqual(events.filter(item => item[0] === 'surface').map(item => item[1].refraction), [24])
  assert.deepEqual(events.filter(item => item[0] === 'surface').map(item => item[2]), ['widget'])
  assert.equal(environment.dash.classList.contains('lg-surface'), false)
  assert.equal(environment.widget.classList.contains('lg-surface'), true)
  assert.ok(environment.targets().every(surface => surface.style.pointerEvents === undefined))

  // A Widget continuation replaces its hidden source with the same SDK material.
  environment.widget.hidden = true
  environment.card.hidden = false
  environment.reconcile()
  assert.equal(environment.widget.classList.contains('lg-surface'), false)
  assert.equal(environment.card.classList.contains('lg-surface'), true)
  assert.deepEqual(events.filter(item => item[0] === 'surface').at(-1).slice(1), [events.find(item => item[0] === 'surface')[1], 'app-view'])
  environment.widget.hidden = false
  environment.card.hidden = true
  environment.reconcile()
  assert.equal(environment.card.classList.contains('lg-surface'), false)
  assert.equal(environment.widget.classList.contains('lg-surface'), true)

  await controller.setActive(false)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass, 'inactive')
  assert.equal(environment.backdrop.hidden, true)
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
  assert.ok(events.some(item => item[0] === 'dispose'))
  assert.equal(events.filter(item => item[0] === 'remove').length, 3)
  assert.ok(events.some(item => item[0] === 'clear-cache'))
})

test('Liquid Glass uses local static surfaces when WebGPU is unavailable', async () => {
  let sdkRequested = false
  const environment = fakeAppearanceEnvironment({ adapter: false })
  environment.doc.head.appendChild = () => { sdkRequested = true }
  const controller = createLiquidGlassAppearance(environment.root, environment.doc)

  await controller.setActive(true)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass, 'fallback')
  assert.equal(environment.backdrop.hidden, false)
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
  assert.equal(sdkRequested, false)
  await controller.setActive(false)
  assert.equal(environment.backdrop.hidden, true)
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
})

test('Liquid Glass uses the static frame when the user requests more contrast', async () => {
  let scenes=0
  const environment=fakeAppearanceEnvironment({sdk:{createGlassScene(){scenes++;throw Error('SDK must remain inactive')}}})
  environment.root.matchMedia=query=>({matches:query==='(prefers-contrast: more)',addEventListener(){},removeEventListener(){}})
  const controller=createLiquidGlassAppearance(environment.root,environment.doc)
  await controller.setActive(true)
  assert.equal(scenes,0)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass,'fallback')
  await controller.setActive(false)
})
