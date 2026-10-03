const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const runtimeConfigSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'core', 'runtime-config.js'), 'utf8')
const { resolveLaunchOptions, resolvePiSessionReasoning, rendererQuery } = require('../src/main')

function loadRuntimeConfig(search = '') {
  const root = { location: { search } }
  vm.runInContext(runtimeConfigSource, vm.createContext({ window: root, globalThis: root, URLSearchParams }))
  return root
}

test('the reasoning display is folded when the device runtime says nothing', () => {
  assert.equal(resolvePiSessionReasoning({}), 'hidden')
  assert.equal(resolveLaunchOptions([], {}).piSessionReasoning, 'hidden')
})

test('only an explicit shown value displays reasoning', () => {
  assert.equal(resolvePiSessionReasoning({ ODESK_PI_REASONING: 'shown' }), 'shown')
  // A typo, a boolean, a case variant, or the folded default restated must not
  // become a second way to publish a session's reasoning.
  for (const value of ['hidden', 'SHOWN', ' Shown ', 'true', '1', 'yes', '']) {
    assert.equal(resolvePiSessionReasoning({ ODESK_PI_REASONING: value }), 'hidden', value)
  }
})

test('the renderer query restates only what differs from the folded default', () => {
  const base = { kiosk: false, disabledPlugins: [] }
  assert.equal(rendererQuery({ ...base, piSessionReasoning: 'hidden' }), '')
  assert.equal(rendererQuery({ ...base, piSessionReasoning: 'shown' }), '?piReasoning=shown')
  assert.equal(rendererQuery({ ...base, kiosk: true, piSessionReasoning: 'shown' }), '?kiosk=1&piReasoning=shown')
})

test('the renderer resolves the reasoning display from its own launch configuration', () => {
  const resolved = loadRuntimeConfig().odkRuntimeConfig
  assert.equal(resolved.resolve('').piSessionReasoning, 'hidden')
  assert.equal(resolved.resolve('?piReasoning=shown').piSessionReasoning, 'shown')
  assert.equal(resolved.resolve('?kiosk=1&piReasoning=shown').piSessionReasoning, 'shown')
  assert.equal(loadRuntimeConfig().odkRuntimeConfig.current.piSessionReasoning, 'hidden', 'a renderer launched with no configuration folds reasoning')
  assert.equal(loadRuntimeConfig('?piReasoning=shown').odkRuntimeConfig.current.piSessionReasoning, 'shown')
  // Anything the desk did not recognize stays folded instead of guessing.
  for (const search of ['?piReasoning=hidden', '?piReasoning=true', '?piReasoning=SHOWN', '?piReasoning=']) {
    assert.equal(resolved.resolve(search).piSessionReasoning, 'hidden', search)
  }
})