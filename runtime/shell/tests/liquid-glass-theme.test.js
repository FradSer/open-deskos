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

  assert.match(html, /core\/liquid-glass-appearance\.js/)
  assert.match(html, /id="liquid-glass-backdrop" class="lg-content" aria-hidden="true" hidden/)
  assert.match(css, /@glass-sdk\/liquid-glass\/dist\/styles\.css/)
  assert.match(css, /html\[data-theme='liquid-glass'\]\[data-liquid-glass='sdk'\][\s\S]*?background: transparent;/)
  assert.match(css, /html\[data-theme='liquid-glass'\]\[data-liquid-glass='sdk'\][\s\S]*?backdrop-filter: none;/)
  assert.match(css, /--odk-primary:\s*#f3f7fc/)
  assert.match(css, /--odk-radius-card:\s*32px/)
  assert.match(css, /#liquid-glass-backdrop\s*\{\s*position:\s*absolute;\s*inset:\s*0;/)
  assert.doesNotMatch(css, /#status-bar::before/)
  assert.match(css, /#home-desk :is\(\.widget\[data-interaction='display-only'\], :where\(#app-view\)\)\s*\{[^}]*background:\s*var\(--odk-glass-material\)/)
  assert.match(css, /prefers-reduced-transparency/)
  assert.match(css, /forced-colors/)
  assert.match(appearance, /requestAdapter/)
  assert.match(appearance, /glassScene\?\.dispose/)
  assert.match(appearance, /themes\/liquid-glass-sdk\.js/)
  assert.match(appearance, /prefers-reduced-transparency/)
})

test('Liquid Glass keeps Widgets visible while SDK clip paths are prepared', () => {
  const css = fs.readFileSync(path.join(renderer, 'themes/liquid-glass.css'), 'utf8')
  assert.match(css, /html\[data-theme='liquid-glass'\] #home-desk \.widget\.lg-surface\s*\{[^}]*visibility:\s*inherit;/)
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

function fakeAppearanceEnvironment({ sdk, adapter = true } = {}) {
  const rootBox = { left: 100, top: 0, right: 1000, bottom: 800, width: 900, height: 800 }
  const viewportBox = { left: 600, top: 200, right: 1000, bottom: 800, width: 400, height: 600 }
  const desk = fakeElement('home-desk', rootBox)
  const content = fakeElement('desk-content', rootBox)
  const backdrop = fakeElement('liquid-glass-backdrop', rootBox)
  const summary = fakeElement('home-summary', rootBox)
  const viewport = fakeElement('pages-viewport', viewportBox)
  const dash = fakeElement('dash', { left: 700, top: 80, right: 950, bottom: 180, width: 250, height: 100 })
  const widget = fakeElement('widget', { left: 650, top: 240, right: 800, bottom: 390, width: 150, height: 150 }, true)
  const doc = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'liquid-glass' } },
    head: { appendChild() {} },
    getElementById(id) { return ({ 'home-desk': desk, 'desk-content': content, 'liquid-glass-backdrop': backdrop, 'home-summary': summary, 'pages-viewport': viewport })[id] },
    querySelectorAll(selector) { return selector.includes('#home-summary') ? [dash, widget] : [widget] },
    createElement() { return fakeElement('unused', { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) },
    addEventListener() {},
  }
  const scenes = []
  const root = {
    navigator: adapter ? { gpu: { requestAdapter: async () => ({}) } } : {},
    odkLiquidGlassSdk: sdk,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ borderTopLeftRadius: '24px' }),
    addEventListener() {},
    removeEventListener() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1,
    clearTimeout() {},
  }
  return { root, doc, desk, content, backdrop, dash, widget, scenes, targets: () => [dash, widget], getScene: () => scenes[0], addScene(scene) { scenes.push(scene) } }
}

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

  await controller.setActive(false)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass, 'inactive')
  assert.equal(environment.backdrop.hidden, true)
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
  assert.ok(events.some(item => item[0] === 'dispose'))
  assert.equal(events.filter(item => item[0] === 'remove').length, 1)
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
