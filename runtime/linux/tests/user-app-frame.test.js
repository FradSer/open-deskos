'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/core/user-app-frame.js'), 'utf8')

// Disposal settles readiness as a rejection, which the host is expected to handle;
// tests that only check the URL silence it here.
function disposeQuietly(mounted) {
  mounted.ready.catch(() => {})
  mounted.dispose()
}

function create({ theme = 'instrument', withObserver = true, radius = '23.04px' } = {}) {
  const listeners = new Set()
  const resizes = new Set()
  const observers = []
  const documentElement = { dataset: { theme } }
  const root = {
    crypto: { randomUUID: () => 'token' },
    location: { href: 'file:///shell.html' },
    document: { documentElement },
    getComputedStyle: () => ({ borderTopLeftRadius: radius }),
    addEventListener: (type, cb) => { if (type === 'resize') resizes.add(cb); else listeners.add(cb) },
    removeEventListener: (type, cb) => { if (type === 'resize') resizes.delete(cb); else listeners.delete(cb) },
  }
  if (withObserver) {
    root.MutationObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
      trigger() { this.callback() }
    }
  }
  const posted = []
  const frame = {
    dataset: {}, remove() { this.removed = true }, setAttribute() {},
    contentWindow: { postMessage: (message) => posted.push(message) },
    addEventListener: (_type, cb) => { frame.loaded = cb },
  }
  const container = { ownerDocument: { createElement: () => frame }, appendChild(value) { this.child = value } }
  const module = { exports: {} }
  vm.runInNewContext(source, { window: root, globalThis: root, module, setTimeout, clearTimeout, URL })
  return { mount: module.exports.mount, root, documentElement, frame, container, listeners, resizes, observers, posted }
}

test('frame readiness rejects on timeout and removes iframe', async () => {
  const h = create()
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r', timeoutMs: 10 })
  await assert.rejects(mounted.ready, /timed out/)
  mounted.dispose()
  assert.equal(mounted.frame.removed, true)
  assert.equal(h.listeners.size, 0)
})

test('frame startup error rejects, invokes callback, and cleans timer listener', async () => {
  const h = create()
  let reported
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r', timeoutMs: 1000, onError: (error) => { reported = error } })
  const [listener] = h.listeners
  listener({ source: h.frame.contentWindow, data: { type: 'odk-user-app-error', token: 'token', error: 'blocked' } })
  await assert.rejects(mounted.ready, /blocked/)
  assert.match(reported.message, /blocked/)
  assert.equal(mounted.frame.removed, true)
  assert.equal(h.listeners.size, 0)
})

test('a frame is told the appearance it renders under', () => {
  const h = create({ theme: 'pixel' })
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r' })
  const target = new URL(h.frame.src)
  assert.equal(target.searchParams.get('token'), 'token')
  assert.equal(target.searchParams.get('theme'), 'pixel')
  assert.equal(target.searchParams.get('radius'), '23.04px', 'the package must know the frame radius it renders inside')
  assert.equal(mounted.frame.dataset.theme, 'pixel')
  disposeQuietly(mounted)
})

test('a theme change reaches a mounted frame and re-sends after load', () => {
  const h = create({ theme: 'pixel' })
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r' })
  assert.equal(h.observers.length, 1)
  h.documentElement.dataset.theme = 'border-beam'
  h.observers[0].trigger()
  const expected = { type: 'odk-user-app-theme', token: 'token', theme: 'border-beam', radius: '23.04px' }
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted.at(-1))), expected)
  h.frame.loaded()
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted.at(-1))), expected)
  for (const listener of h.resizes) listener()
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted.at(-1))), expected, 'a resize republishes the measured radius')
  disposeQuietly(mounted)
  assert.equal(h.resizes.size, 0)
})

test('a mounted frame keeps following the theme after readiness', async () => {
  const h = create({ theme: 'pixel' })
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r', timeoutMs: 1000 })
  const [listener] = h.listeners
  listener({ source: h.frame.contentWindow, data: { type: 'odk-user-app-ready', token: 'token' } })
  await mounted.ready
  h.documentElement.dataset.theme = 'border-beam'
  h.observers[0].trigger()
  assert.equal(h.frame.dataset.theme, 'border-beam', 'readiness must not end the appearance subscription')
  assert.equal(h.posted.at(-1).theme, 'border-beam')
  mounted.dispose()
  assert.equal(h.observers[0].disconnected, true, 'disposal must release the observer')
  assert.equal(h.resizes.size, 0, 'disposal must release the resize listener')
})

test('disposal disconnects the appearance observer', async () => {
  const h = create({ theme: 'pixel' })
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r', timeoutMs: 5 })
  await assert.rejects(mounted.ready, /timed out/)
  assert.equal(h.observers[0].disconnected, true)
})

test('a host without a theme or an observer still mounts', () => {
  const h = create({ theme: undefined, withObserver: false, radius: null })
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r' })
  assert.equal(new URL(h.frame.src).searchParams.get('theme'), 'instrument')
  assert.equal(new URL(h.frame.src).searchParams.get('radius'), null, 'a host without a measured radius adds none')
  disposeQuietly(mounted)
})