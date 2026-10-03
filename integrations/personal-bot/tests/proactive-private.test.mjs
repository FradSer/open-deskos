import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, realpathSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readProactiveFile, protectProactivePath } from '../src/proactive-private.mjs'
import { proposalStateStore } from '../src/proactive-state.mjs'

const windows = process.platform === 'win32'
test('native host protects private proactive files and round trips checkpoints', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proactive-native-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'owner.json'); writeFileSync(file, '{"owner":true}', { mode: 0o600 }); protectProactivePath(file)
  assert.equal(readProactiveFile(file, 4096), '{"owner":true}')
  const store = proposalStateStore(join(dir, 'checkpoint', 'state.json')); store.save({ version: 1, proposals: [] })
  assert.deepEqual(store.load(), { version: 1, proposals: [] })
})
test('POSIX broad access remains rejected', { skip: windows }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proactive-mode-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'owner.json'); writeFileSync(file, '{}', { mode: 0o600 }); chmodSync(file, 0o644)
  assert.throws(() => readProactiveFile(file, 4096))
})
test('Windows broad ACL is rejected without silently fixing existing files', { skip: !windows }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proactive-acl-')))
  t.after(() => rmSync(dir, { recursive: true, force: true })); protectProactivePath(dir)
  const file = join(dir, 'owner.json'); writeFileSync(file, '{}'); protectProactivePath(file)
  const result = spawnSync('icacls.exe', [file, '/grant', '*S-1-1-0:(R)'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0)
  assert.throws(() => readProactiveFile(file, 4096), /private/)
})

test('temporary private file is protected while empty before content is written', async t => {
  const { openProactiveTemporary } = await import('../src/proactive-private.mjs')
  const { fstatSync, closeSync } = await import('node:fs')
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proactive-empty-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'temporary.json'), fd = openProactiveTemporary(file)
  try { assert.equal(fstatSync(fd).size, 0); assert.equal(readProactiveFile(file, 4096), ''); writeFileSync(fd, '{"safe":true}') } finally { closeSync(fd) }
  assert.equal(readProactiveFile(file, 4096), '{"safe":true}')
})

test('native owner suppression writer publishes a private atomic replacement', async t => {
  const { loadProactiveConfig, ownerConfigWriter } = await import('../src/proactive.mjs')
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proactive-owner-native-')))
  t.after(() => rmSync(dir, { recursive: true, force: true })); protectProactivePath(dir)
  const file = join(dir, 'owner.json')
  const initial = { version: 1, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 3600000, rules: [{ id: 'owner-rule', delivery: 'silent', urgent: false, advice: 'Check plant.', conditions: [{ readingId: 'plant', field: 'soil', op: 'lt', value: 20 }] }], suppressed: [], snoozed: {} }
  writeFileSync(file, JSON.stringify(initial), { mode: 0o600 }); protectProactivePath(file)
  const current = loadProactiveConfig(file); await ownerConfigWriter(file, current)({ ...current, suppressed: ['owner-rule'] })
  assert.deepEqual(loadProactiveConfig(file).suppressed, ['owner-rule'])
})
