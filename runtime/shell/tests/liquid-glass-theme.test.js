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
  assert.equal(plugin.appearance.tokens['--odk-radius-card'], '24px')
})

test('Liquid Glass uses the local SDK stylesheet and static accessibility fallback', () => {
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  const css = fs.readFileSync(path.join(renderer, 'themes/liquid-glass.css'), 'utf8')
  const appearance = fs.readFileSync(path.join(renderer, 'core/liquid-glass-appearance.js'), 'utf8')

  assert.match(html, /core\/liquid-glass-appearance\.js/)
  assert.match(css, /@glass-sdk\/liquid-glass\/dist\/styles\.css/)
  assert.match(css, /--odk-primary:\s*#f3f7fc/)
  assert.match(css, /--odk-radius-card:\s*24px/)
  assert.match(css, /prefers-reduced-transparency/)
  assert.match(css, /forced-colors/)
  assert.match(appearance, /requestAdapter/)
  assert.match(appearance, /glassScene\?\.dispose/)
  assert.match(appearance, /themes\/liquid-glass-sdk\.js/)
  assert.match(appearance, /prefers-reduced-transparency/)
})

function fakeElement(id, box, inViewport = false) {
  const classes = new Set()
  const children = []
  const element = {
    id,
    dataset: {},
    style: {},
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
  const summary = fakeElement('home-summary', rootBox)
  const viewport = fakeElement('pages-viewport', viewportBox)
  const dash = fakeElement('dash', { left: 700, top: 80, right: 950, bottom: 180, width: 250, height: 100 })
  const widget = fakeElement('widget', { left: 650, top: 240, right: 800, bottom: 390, width: 150, height: 150 }, true)
  const doc = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'liquid-glass' } },
    head: { appendChild() {} },
    getElementById(id) { return ({ 'home-desk': desk, 'desk-content': content, 'home-summary': summary, 'pages-viewport': viewport })[id] },
    querySelectorAll() { return [dash, widget] },
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
  return { root, doc, desk, dash, widget, scenes, targets: () => [dash, widget], getScene: () => scenes[0], addScene(scene) { scenes.push(scene) } }
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
          if (events.filter(item => item[0] === 'surface').length === 2) configuration.options.onDiagnostic({ surfaces: 2, maps: 2 })
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
  assert.deepEqual(events.filter(item => item[0] === 'surface').map(item => item[1].refraction), [10, 10])
  assert.deepEqual(events.filter(item => item[0] === 'surface').map(item => item[2]), ['dash', 'widget'])
  assert.ok(environment.targets().every(surface => surface.classList.contains('lg-surface')))
  assert.ok(environment.targets().every(surface => surface.style.pointerEvents === undefined))

  await controller.setActive(false)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass, 'inactive')
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
  assert.ok(events.some(item => item[0] === 'dispose'))
  assert.equal(events.filter(item => item[0] === 'remove').length, 2)
  assert.ok(events.some(item => item[0] === 'clear-cache'))
})

test('Liquid Glass uses local static surfaces when WebGPU is unavailable', async () => {
  let sdkRequested = false
  const environment = fakeAppearanceEnvironment({ adapter: false })
  environment.doc.head.appendChild = () => { sdkRequested = true }
  const controller = createLiquidGlassAppearance(environment.root, environment.doc)

  await controller.setActive(true)
  assert.equal(environment.doc.documentElement.dataset.liquidGlass, 'fallback')
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
  assert.equal(sdkRequested, false)
  await controller.setActive(false)
  assert.ok(environment.targets().every(surface => !surface.classList.contains('lg-surface')))
})
