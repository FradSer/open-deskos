import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtempSync, writeFileSync, rmSync, realpathSync, chmodSync, linkSync, unlinkSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import childProcess, { spawnSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createProactiveDirectory, checkProactivePath, readProactiveFile, protectProactivePath } from '../src/proactive-private.mjs'
import { proposalStateStore } from '../src/proactive-state.mjs'
import { createMemoryStore } from '../src/memory.mjs'

const windows = process.platform === 'win32'

test('an unavailable filesystem root preserves its error without recursive retries', t => {
  const unavailable = Object.assign(Error('Unavailable fixture root'), { code: 'ENOENT' })
  const blocked = t.mock.method(fs, 'mkdirSync', () => { throw unavailable })
  syncBuiltinESMExports()
  try {
    assert.throws(() => createProactiveDirectory(parse(process.cwd()).root), error => error === unavailable)
    assert.equal(blocked.mock.callCount(), 1)
  } finally { blocked.mock.restore(); syncBuiltinESMExports() }
})

test('Windows repeatedly checks fresh private ACLs without a command processor', { skip: !windows }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-native-acl-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'owner.json')
  writeFileSync(file, '{}')
  protectProactivePath(file)
  const blocked = t.mock.method(childProcess, 'spawnSync', () => { throw Error('Permission checks must not start a command processor') })
  syncBuiltinESMExports()
  try {
    for (let i = 0; i < 50; i++) { checkProactivePath(dir); assert.equal(readProactiveFile(file, 4096), '{}') }
  } finally { blocked.mock.restore(); syncBuiltinESMExports() }
  const broaden = spawnSync('icacls.exe', [file, '/grant', '*S-1-1-0:(R)'], { encoding: 'utf8', windowsHide: true })
  assert.equal(broaden.status, 0)
  assert.throws(() => readProactiveFile(file, 4096), /private/)
})
test('Windows native ACL checks reject unsafe descriptors and directory aliases', { skip: !windows }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-acl-boundaries-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, '记录 é.json')
  writeFileSync(file, '{}')
  protectProactivePath(file)
  assert.equal(readProactiveFile(file, 4096), '{}')
  const fixture = fileURLToPath(new URL('./fixtures/private-acl.ps1', import.meta.url))
  for (const mode of ['NullDacl', 'CallbackAllow']) {
    const applied = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture, '-Mode', mode, '-Path', file], { encoding: 'utf8', windowsHide: true })
    assert.equal(applied.status, 0, `ACL fixture failed: ${mode}`)
    assert.equal(applied.stdout.trim(), 'APPLIED')
    assert.throws(() => readProactiveFile(file, 4096), /private/)
    protectProactivePath(file)
    assert.equal(readProactiveFile(file, 4096), '{}')
  }
  const child = join(dir, 'child'), alias = join(dir, 'alias')
  mkdirSync(child)
  protectProactivePath(child)
  const applied = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture, '-Mode', 'Unprotected', '-Path', child], { encoding: 'utf8', windowsHide: true })
  assert.equal(applied.status, 0)
  assert.throws(() => checkProactivePath(child), /private/)
  protectProactivePath(child)
  symlinkSync(child, alias, 'junction')
  assert.throws(() => checkProactivePath(alias), /private/)
  assert.throws(() => protectProactivePath(alias), /private/)
  checkProactivePath(child)
  assert.throws(() => checkProactivePath(join(dir, 'missing')))
})

test('native memory preserves exact grants across private atomic writes', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-memory-native-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'notes', 'MEMORY.json')
  const memory = createMemoryStore(file)
  await assert.rejects(memory.update({ category: 'language', value: 'zh-CN' }), /exact explicit/)
  memory.beginTurn('remember language: zh-CN')
  assert.equal(await memory.update({ category: 'language', value: 'zh-CN' }), 'Memory updated.')
  assert.equal(readProactiveFile(file, 16384), '{"language":"zh-CN"}')
  assert.equal(await createMemoryStore(file).read(), '{"language":"zh-CN"}')
  await assert.rejects(memory.update({ category: 'language', value: 'zh-CN' }), /exact explicit/)
  memory.beginTurn('remember language: en')
  await memory.update({ category: 'language', value: 'en' })
  assert.equal(readProactiveFile(file, 16384), '{"language":"en"}')
  memory.beginTurn('forget language')
  assert.equal(await memory.forget({ category: 'language' }), 'Memory forgotten.')
  assert.equal(await memory.read(), '{}')
})

test('Windows memory rejects broad existing ACLs without repairing them', { skip: !windows }, async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-memory-acl-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'MEMORY.json')
  writeFileSync(file, '{"note":"fixture"}')
  protectProactivePath(file)
  for (const target of [file, dir]) {
    const broaden = spawnSync('icacls.exe', [target, '/grant', '*S-1-1-0:(R)'], { encoding: 'utf8', windowsHide: true })
    assert.equal(broaden.status, 0)
    const before = spawnSync('icacls.exe', [target], { encoding: 'utf8', windowsHide: true }).stdout
    const memory = createMemoryStore(file)
    await assert.rejects(memory.read(), /unsafe/)
    memory.beginTurn('remember note: changed')
    await assert.rejects(memory.update({ category: 'note', value: 'changed' }), /unsafe/)
    assert.equal(spawnSync('icacls.exe', [target], { encoding: 'utf8', windowsHide: true }).stdout, before)
    protectProactivePath(target)
  }
  assert.equal(await createMemoryStore(file).read(), '{"note":"fixture"}')
})

test('native memory rejects hard links without changing saved notes', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-memory-links-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'MEMORY.json'), alias = join(dir, 'alias.json')
  writeFileSync(file, '{"note":"fixture"}', { mode: 0o600 })
  protectProactivePath(file)
  linkSync(file, alias)
  const memory = createMemoryStore(file)
  await assert.rejects(memory.read(), /unsafe/)
  memory.beginTurn('remember note: changed')
  await assert.rejects(memory.update({ category: 'note', value: 'changed' }), /unsafe/)
  unlinkSync(alias)
  assert.equal(await memory.read(), '{"note":"fixture"}')
})
test('native host protects private proactive files and round trips checkpoints', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proactive-native-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  protectProactivePath(dir)
  const file = join(dir, 'owner.json'); writeFileSync(file, '{"owner":true}', { mode: 0o600 }); protectProactivePath(file)
  assert.equal(readProactiveFile(file, 4096), '{"owner":true}')
  const store = proposalStateStore(join(dir, 'checkpoint', 'nested', 'state.json')); store.save({ version: 1, proposals: [] })
  assert.deepEqual(store.load(), { version: 1, proposals: [] })
  checkProactivePath(join(dir, 'checkpoint'))
  checkProactivePath(join(dir, 'checkpoint', 'nested'))
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

test('ordinary model judgment identities survive private checkpoint reload without Jev aliases', t => {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'odk-model-judgment-')));protectProactivePath(dir);t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const store=proposalStateStore(join(dir,'state.json'))
  const id='12345678-1234-4123-8123-123456789abc',model='synthetic/model-v1'
  const proposal={id,ruleId:'synthetic',subject:'synthetic',ruleVersion:'{}',status:'pending',advice:'Synthetic advice',confirmation:'',result:'',createdAt:'2026-10-18T00:00:00Z',action:null,offered:false,presented:false,evidence:[],judgment:{model,probability:0.99,threshold:0.8,trigger:'heartbeat',judgedAt:'2026-10-18T00:00:00Z'}}
  const claim={key:id+':1:2026-10-18',intentId:id,revision:1,date:'2026-10-18',status:'condition_unknown',updatedAt:'2026-10-18T00:00:00Z',model}
  store.save({version:1,proposals:[proposal],intentClaims:[claim]});assert.equal(store.load().proposals[0].judgment.model,model);assert.equal(store.load().intentClaims[0].model,model)
  assert.throws(()=>store.save({version:1,proposals:[{...proposal,judgment:{...proposal.judgment,model:'https://user:secret@host/path'}}]}))
})
