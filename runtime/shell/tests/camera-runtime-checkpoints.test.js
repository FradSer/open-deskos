'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { readMarker, writeMarker, installSubscriptionTracker } = require('./helpers/camera-runtime-checkpoints')

async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-camera-checkpoint-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return root
}

test('Camera checkpoint observes a complete atomic marker without leaving its temporary file', async t => {
  const file = path.join(await directory(t), 'ready.json')
  const reading = readMarker(file)
  await writeMarker(file, { version: '2.0.0' })
  assert.deepEqual(await reading, { version: '2.0.0' })
  await assert.rejects(fs.stat(`${file}.tmp`), { code: 'ENOENT' })
})

test('Camera checkpoint stops waiting when its child fails', async t => {
  const error = Error('Controlled child failure')
  await assert.rejects(readMarker(path.join(await directory(t), 'missing.json'),
    { outcome: Promise.resolve({ error }) }), failure => failure === error)
})

test('Camera checkpoint rejects premature child success and caller cancellation', async t => {
  const file = path.join(await directory(t), 'missing.json')
  await assert.rejects(readMarker(file, { outcome: Promise.resolve({ result: {} }) }), /exited before its checkpoint/)
  const controller = new AbortController()
  const error = Error('Controlled cancellation')
  controller.abort(error)
  await assert.rejects(readMarker(file, { signal: controller.signal }), failure => failure === error)
})

test('Camera checkpoint refuses malformed data instead of waiting for another marker', async t => {
  const file = path.join(await directory(t), 'broken.json')
  await fs.writeFile(file, '{')
  await assert.rejects(readMarker(file), SyntaxError)
})

test('Camera tracking includes the first subscription when the service is published', () => {
  const root = {}
  const listeners = new Set()
  installSubscriptionTracker(root)
  root.odkServices = { camera: { subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  } } }
  const first = root.odkServices.camera.subscribe(() => {})
  assert.equal(root.cameraTrackedSubscriptions, 1)
  assert.equal(listeners.size, 1)
  assert.throws(() => root.odkServices.camera.subscribe(() => {}), /Previous Camera subscription retained/)
  first()
  assert.equal(root.cameraTrackedSubscriptions, 0)
  const next = root.odkServices.camera.subscribe(() => {})
  next(); next()
  assert.equal(root.cameraTrackedSubscriptions, 0)
  assert.equal(listeners.size, 0)
})

test('Camera tracking retains a failed release until its explicit retry completes', () => {
  const root = {}
  let refuse = true
  installSubscriptionTracker(root)
  root.odkServices = { camera: { subscribe() { return () => { if (refuse) throw Error('Listener retained') } } } }
  const release = root.odkServices.camera.subscribe(() => {})
  assert.throws(release, /Listener retained/)
  assert.equal(root.cameraTrackedSubscriptions, 1)
  assert.throws(() => root.odkServices.camera.subscribe(() => {}), /Previous Camera subscription retained/)
  refuse = false
  release()
  assert.equal(root.cameraTrackedSubscriptions, 0)
})
