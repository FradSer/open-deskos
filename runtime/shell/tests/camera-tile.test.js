const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const tileSource = fs.readFileSync('src/renderer/plugins/camera.js', 'utf8')

function mountWith(status, { camera = true } = {}) {
  const subscribers = []
  const refreshed = []
  const nodes = new Map()
  const el = {
    innerHTML: '',
    querySelector(selector) {
      if (!nodes.has(selector)) {
        nodes.set(selector, { textContent: '', hidden: false, src: '', style: {}, removeAttribute() {} })
      }
      return nodes.get(selector)
    },
  }
  const root = {}
  const sandbox = { window: root, globalThis: root }
  vm.runInContext(registrySource, vm.createContext(sandbox))
  vm.runInContext(tileSource, vm.createContext(sandbox))
  const ctx = { onTick: () => () => {} }
  if (camera) {
    ctx.camera = {
      subscribe(callback) {
        subscribers.push(callback)
        callback(status)
        return () => {}
      },
      refresh: () => {
        refreshed.push(true)
        return Promise.resolve(status)
      },
    }
  }
  root.odkPlugins.activate(root.odkPlugins.get('odk.tile.camera'), el, ctx)
  for (const callback of subscribers) callback(status)
  return { el, nodes, refreshed }
}

test('live status renders the latest frame with capture time', () => {
  const { el, nodes, refreshed } = mountWith({
    state: undefined,
    status: 'live',
    frame: 'data:image/jpeg;base64,AAAA',
    capturedAt: new Date(2026, 8, 17, 2, 30).getTime(),
  })
  assert.ok(el.innerHTML.includes('w-camera-frame'))
  assert.equal(nodes.get('.w-camera-frame')?.src, 'data:image/jpeg;base64,AAAA')
  assert.match(nodes.get('.w-camera-state')?.textContent || '', /02:30/)
  assert.equal(refreshed.length, 1)
})

test('unavailable camera renders a truthful state without a frame', () => {
  const { nodes } = mountWith({ status: 'unavailable', frame: null, capturedAt: null })
  assert.equal(nodes.get('.w-camera-frame')?.hidden, true)
  assert.match(nodes.get('.w-camera-state')?.textContent || '', /Camera unavailable/)
})

test('mounting without a camera service never throws', () => {
  assert.doesNotThrow(() => mountWith({ status: 'live', frame: null }, { camera: false }))
})
