import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateMcpObserver, PRIVATE_SOURCE_PROVENANCE } from '../src/private-mcp-observer.mjs'

const revision = 'a'.repeat(64)
const snapshot = () => ({ schemaVersion: 1, kind: 'mcp', id: 'mail', name: 'Private mail', policy: { ownerOnly: true, privateData: true }, transport: { type: 'stdio', command: process.execPath, args: [] } })
function fixture() {
  let selected = { revision, snapshot: snapshot() }, opens = 0, closes = 0, opening
  const calls = []
  const session = { closed: false, tools: async () => ['read'].map(name => ({ name, annotations: { readOnlyHint: true, destructiveHint: false } })),
    call: async (name, args) => { calls.push({ name, args }); return { structuredContent: { message: 'fixture', privateData: false } } }, close: async () => { closes++ } }
  const observer = createPrivateMcpObserver({ catalog: { package: async () => { if (!selected) throw Error('absent'); return structuredClone(selected) } }, connectorId: 'mail', readOnlyTools: ['read'], openSession: async () => { opens++; return opening ? opening() : session } })
  return { observer, session, calls, select: value => { selected = value }, setOpening: value => { opening = value }, counts: () => ({ opens, closes }) }
}

test('private observer has host-owned provenance and no ambient turn state', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  const result = await f.observer.run(async ({ call }) => call('read', {}))
  assert.deepEqual(result.provenance, PRIVATE_SOURCE_PROVENANCE)
  assert.equal(result.provenance.learningEligible, false)
  assert.equal(result.value.structuredContent.privateData, false)
  assert.equal(result.connectorRevision, revision)
  assert.equal(await f.observer.isCurrent(result), true)
  assert.deepEqual(f.calls, [{ name: 'read', args: {} }])
})

test('host allowlist rejects extra tools even if their metadata says read-only', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  f.session.tools = async () => ['read', 'publish'].map(name => ({ name, annotations: { readOnlyHint: true, destructiveHint: false } }))
  await assert.rejects(f.observer.run(({ call }) => call('publish', {})), /Private source/)
  assert.equal(f.calls.length, 0)
})

test('private policy is checked before opening the connector', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  const value = snapshot(); value.policy.ownerOnly = false
  f.select({ revision, snapshot: value })
  await assert.rejects(f.observer.run(() => 1), /Private source/)
  assert.equal(f.counts().opens, 0)
})

test('a revision change while a provider runs refuses its old result', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  f.session.call = async () => { f.select({ revision: 'b'.repeat(64), snapshot: snapshot() }); return { structuredContent: { message: 'late' } } }
  await assert.rejects(f.observer.run(({ call }) => call('read', {})), /Private source/)
  assert.equal(f.counts().closes, 1)
})

test('disable aborts an in-flight read and invalidates its snapshot', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  let entered
  const started = new Promise(resolve => { entered = resolve })
  f.session.call = async (_name, _args, signal) => { entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('private fixture payload')), { once: true })) }
  const attempt = f.observer.run(({ call }) => call('read', {}))
  await started
  await f.observer.setEnabled(false)
  await assert.rejects(attempt, /Private source/)
  assert.equal(f.counts().closes, 1)
  await assert.rejects(f.observer.run(() => 1), /Private source/)
})

test('removal invalidates a snapshot without reading cached source values', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  const result = await f.observer.run(() => 'value')
  f.select(null)
  assert.equal(await f.observer.isCurrent(result), false)
  assert.equal(f.counts().closes, 1)
})

test('provider error text never escapes the private observer', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  f.session.call = async () => { throw Error('fixture-private-token-and-mail') }
  await assert.rejects(f.observer.run(({ call }) => call('read', {})), error => !error.message.includes('fixture-private'))
})

test('abort during pending connector opening settles promptly and closes a late session', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  f.setOpening(() => { enter(); return new Promise(resolve => { release = resolve }) })
  const signal = new AbortController()
  const attempt = f.observer.run(({ call }) => call('read', {}), { signal: signal.signal })
  const settled = attempt.then(() => 'unexpected-success', () => 'aborted')
  await entered; signal.abort()
  let result
  try { result = await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve('timeout'), 100))]) }
  finally { release(f.session); await settled }
  assert.equal(result, 'aborted')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 0)
  assert.equal(f.counts().closes, 1)
})

test('disable during pending discovery settles promptly without dispatching a tool', async t => {
  const f = fixture(); t.after(() => f.observer.close())
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  f.session.tools = () => { enter(); return new Promise(resolve => { release = resolve }) }
  const attempt = f.observer.run(({ call }) => call('read', {}))
  const settled = attempt.then(() => 'unexpected-success', () => 'aborted')
  await entered
  const disabled = f.observer.setEnabled(false)
  let result
  try { result = await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve('timeout'), 100))]) }
  finally { release([]); await settled; await disabled }
  assert.equal(result, 'aborted')
  assert.equal(f.calls.length, 0)
})
