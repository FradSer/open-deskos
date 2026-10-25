'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createHydraPlanStore } = require('../src/hydra-control-plan-store')
const A = '02:00:00:00:00:01', B = '02:00:00:00:00:02'
function fixture(t) { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-plan-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const file = path.join(root, 'sequence.json'); return { file, store: createHydraPlanStore(file) } }
test('sequence store persists per peer/node monotonic reservations without writing on read', async t => {
  const { file, store } = fixture(t); assert.equal(store.get(A, 1), 0); assert.equal(fs.existsSync(file), false)
  await store.reserve(A, 1, 100); await assert.rejects(store.reserve(A, 1, 100)); await store.reserve(A, 2, 2); await store.reserve(B, 1, 3)
  const reloaded = createHydraPlanStore(file); assert.equal(reloaded.get(A, 1), 100); assert.equal(reloaded.get(A, 2), 2); assert.equal(reloaded.get(B, 1), 3); assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})
test('unsafe or linked sequence state fails closed instead of discarding its high-water mark', async t => {
  const { file, store } = fixture(t); await store.reserve(A, 1, 100); fs.chmodSync(file, 0o644); assert.throws(() => store.get(A, 1)); await assert.rejects(store.reserve(A, 1, 101)); fs.chmodSync(file, 0o600)
  fs.linkSync(file, file + '.link'); assert.throws(() => store.get(A, 1)); fs.unlinkSync(file + '.link')
  fs.renameSync(file, file + '.old'); fs.symlinkSync(file + '.old', file); assert.throws(() => store.get(A, 1)); await assert.rejects(store.reserve(A, 1, 101))
})
test('an existing reservation lock is preserved without altering prior state', async t => {
  const { file, store } = fixture(t); await store.reserve(A, 1, 100); const before = fs.readFileSync(file); fs.writeFileSync(file + '.lock', 'foreign', { mode: 0o600 })
  await assert.rejects(store.reserve(A, 1, 101)); assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.readFileSync(file + '.lock', 'utf8'), 'foreign')
})
