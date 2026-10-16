'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture() {
  const listeners = new Map()
  const root = { addEventListener(name, callback) { listeners.set(name, callback) } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/services.js'), 'utf8'),
    { window: root, navigator: { onLine: true }, console: { error() {} } })
  const service = root.odkServices.get('odk.service.gamepad')
  assert.ok(service, 'The shared gamepad service must own retained state')
  return { service, emit(state) { listeners.get('odk-gamepad-state')({ detail: state }) } }
}

test('gamepad subscriptions immediately replay the retained source state', () => {
  const f = fixture(), first = [], next = []
  const stop = f.service.subscribe(state => first.push(state))
  assert.deepEqual(JSON.parse(JSON.stringify(first)), [{ connected: false, readable: false, id: null }])
  f.emit({ connected: true, readable: true, id: 'Unchanged fixture pad' })
  stop()
  const release = f.service.subscribe(state => next.push(state))
  assert.equal(next.length, 1)
  assert.equal(next[0].id, 'Unchanged fixture pad')
  f.emit({ connected: false, readable: false, id: null })
  assert.equal(first.length, 2)
  assert.equal(next.length, 2)
  release()
})

test('gamepad consumers cannot mutate the retained source state', () => {
  const f = fixture(), seen = []
  const detail = { connected: true, readable: false, id: 'Read-only fixture pad' }
  f.emit(detail)
  detail.id = 'Changed event object'
  const snapshot = f.service.snapshot()
  assert.equal(Object.isFrozen(snapshot), true)
  assert.throws(() => { snapshot.id = 'Changed subscriber object' }, TypeError)
  const release = f.service.subscribe(state => seen.push(state))
  assert.equal(seen[0].id, 'Read-only fixture pad')
  release()
})

test('gamepad subscriber failures do not block peers and cleanup removes callbacks', () => {
  const f = fixture(), seen = []
  const bad = f.service.subscribe(() => { throw Error('Controlled subscriber failure') })
  const good = f.service.subscribe(state => seen.push(state))
  f.emit({ connected: true, readable: true, id: 'Available peer pad' })
  assert.equal(seen.at(-1).id, 'Available peer pad')
  bad(); good(); good()
  const count = seen.length
  f.emit({ connected: false, readable: false, id: null })
  assert.equal(seen.length, count)
})


test('gamepad retained state contains only primitive contract fields', () => {
  const f = fixture()
  f.emit({ connected: true, readable: 'unknown', id: { label: 'Untrusted object' }, privateField: 'not retained' })
  assert.deepEqual(JSON.parse(JSON.stringify(f.service.snapshot())), { connected: true, readable: false, id: null })
  f.emit(null)
  assert.deepEqual(JSON.parse(JSON.stringify(f.service.snapshot())), { connected: false, readable: false, id: null })
})
