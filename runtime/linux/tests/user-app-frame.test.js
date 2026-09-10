'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/renderer/core/user-app-frame.js'), 'utf8')

function harness() {
  const listeners = new Set()
  const root = {
    crypto: { randomUUID: () => 'token' }, location: { href: 'file:///shell.html' },
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
  }
  const frame = { dataset: {}, remove() { this.removed = true }, setAttribute() {}, contentWindow: {} }
  const container = {
    ownerDocument: { createElement: () => frame },
    appendChild(value) { this.child = value },
  }
  vm.runInNewContext(source, { window: root, globalThis: root, module: { exports: {} }, setTimeout, clearTimeout })
  return { api: vm.runInNewContext('module.exports', { module: { exports: {} } }), root, frame, container, listeners }
}

function create() {
  const listeners = new Set()
  const root = {
    crypto: { randomUUID: () => 'token' }, location: { href: 'file:///shell.html' },
    addEventListener: (_type, cb) => listeners.add(cb), removeEventListener: (_type, cb) => listeners.delete(cb),
  }
  const frame = { dataset: {}, remove() { this.removed = true }, setAttribute() {}, contentWindow: {} }
  const container = { ownerDocument: { createElement: () => frame }, appendChild(value) { this.child = value } }
  const module = { exports: {} }
  vm.runInNewContext(source, { window: root, globalThis: root, module, setTimeout, clearTimeout, URL })
  return { mount: module.exports.mount, root, frame, container, listeners }
}

test('frame readiness rejects on timeout and removes iframe', async () => {
  const h = create(); const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r', timeoutMs: 10 })
  await assert.rejects(mounted.ready, /timed out/)
  mounted.dispose()
  assert.equal(mounted.frame.removed, true)
  assert.equal(h.listeners.size, 0)
})

test('frame startup error rejects, invokes callback, and cleans timer listener', async () => {
  const h = create(); let reported
  const mounted = h.mount(h.container, { url: 'odk-user-app://app/a/r', timeoutMs: 1000, onError: (error) => { reported = error } })
  const [listener] = h.listeners
  listener({ source: h.frame.contentWindow, data: { type: 'odk-user-app-error', token: 'token', error: 'blocked' } })
  await assert.rejects(mounted.ready, /blocked/)
  assert.match(reported.message, /blocked/)
  assert.equal(mounted.frame.removed, true)
  assert.equal(h.listeners.size, 0)
})
