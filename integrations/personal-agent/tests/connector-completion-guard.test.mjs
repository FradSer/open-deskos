import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAgentCatalog } from '../src/agent-catalog/catalog.mjs'
import { createConnectorCompletionGuard, composeConnectorOwnerPrompt, snapshotConnectorCatalog } from '../src/connector-completion-guard.mjs'

function admission(overrides = {}) {
  return { owner: {}, intent: 'extension', ownerAccess: true, requestReady: true, mcpAdmitted: true,
    allowedCapabilities: ['agent_packages_list', 'agent_mcp_tools', 'agent_mcp_call'],
    catalogFingerprint: 'a'.repeat(64), signal: new AbortController().signal, ...overrides }
}

test('a ready owner request allows one evidence check and a truthful zero-call fallback', () => {
  const current = admission(), guard = createConnectorCompletionGuard(current)
  assert.equal(guard.shouldBuffer(current), true)
  const first = guard.requestRepair(current)
  assert.equal(first.kind, 'continue')
  assert.match(first.instruction, /host-generated/i)
  assert.match(first.instruction, /not.*authoriz/i)
  assert.match(first.instruction, /missing.*input|clarif/i)
  assert.equal(guard.requestRepair(current).kind, 'none')
  const final = guard.finalize(current)
  assert.equal(final.kind, 'fallback')
  assert.match(final.answer, /本轮.*未.*读取/)
  assert.doesNotMatch(final.answer, /权限.*未开放|权限不足/)
  assert.deepEqual(guard.evidence(), { attemptedRepairs: 1, toolAttempts: 0, toolDispatches: 0, invalidated: false })
})

test('clarification and non-owner or non-MCP workflows are not repaired or replaced', () => {
  for (const variant of [{ intent: 'clarify' }, { requestReady: false }, { ownerAccess: false },
    { mcpAdmitted: false }, { allowedCapabilities: ['agent_mcp_tools'] }, { catalogFingerprint: '' }]) {
    const current = admission(variant), guard = createConnectorCompletionGuard(current)
    assert.equal(guard.shouldBuffer(current), false)
    assert.equal(guard.requestRepair(current).kind, 'none')
    assert.equal(guard.finalize(current).kind, 'keep')
  }
})

test('any tool attempt or dispatch permanently forbids a second generation', () => {
  for (const event of ['recordToolAttempt', 'recordDispatch']) {
    const current = admission(), guard = createConnectorCompletionGuard(current)
    guard[event](current.owner)
    assert.equal(guard.requestRepair(current).kind, 'none')
    assert.equal(guard.finalize(current).kind, 'keep')
  }
})

test('a tool after the internal check preserves the tool-backed final answer', () => {
  const current = admission(), guard = createConnectorCompletionGuard(current)
  assert.equal(guard.requestRepair(current).kind, 'continue')
  guard.recordToolAttempt(current.owner)
  guard.recordDispatch(current.owner)
  assert.equal(guard.finalize(current).kind, 'keep')
  assert.equal(guard.requestRepair(current).kind, 'none')
})

test('owner, catalog, permission, or readiness changes cancel rather than publish a fallback', () => {
  for (const change of [{ owner: {} }, { catalogFingerprint: 'b'.repeat(64) }, { ownerAccess: false },
    { allowedCapabilities: ['agent_mcp_tools', 'agent_mcp_call', 'unexpected'] }, { requestReady: false }]) {
    const current = admission(), guard = createConnectorCompletionGuard(current)
    assert.equal(guard.requestRepair(current).kind, 'continue')
    assert.equal(guard.finalize({ ...current, ...change }).kind, 'cancel')
    assert.equal(guard.finalize(current).kind, 'cancel', 'restoring an old scope cannot reactivate the check')
  }
})

test('abort and stale dispatch callbacks cancel a pending check', () => {
  const controller = new AbortController(), current = admission({ signal: controller.signal })
  const guard = createConnectorCompletionGuard(current)
  guard.requestRepair(current); controller.abort()
  assert.equal(guard.finalize(current).kind, 'cancel')
  const other = admission(), stale = createConnectorCompletionGuard(other)
  stale.recordDispatch({})
  assert.equal(stale.requestRepair(other).kind, 'cancel')
})

test('the current host workflow follows untrusted context and directly precedes the owner request', () => {
  const result = composeConnectorOwnerPrompt({ referenceContext: 'Old reference: a connector was unavailable.',
    workflowContext: 'Current allowed capability names: agent_mcp_tools, agent_mcp_call.', request: 'Read my latest message.' })
  assert(result.indexOf('Old reference:') < result.indexOf('Current allowed capability names:'))
  assert.match(result, /agent_mcp_call\.\nPersonal Agent request:\nRead my latest message\.$/)
})

test('another catalog writer changes freshly read admission without updating a routing cache', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'connector-guard-catalog-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const catalog = await openAgentCatalog(directory), writer = await openAgentCatalog(directory)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'private-source', name: 'Private source',
    policy: { ownerOnly: true, privateData: true }, transport: { type: 'stdio', command: process.execPath, args: ['--version'] } }
  const installed = await writer.installMcp(manifest)
  const first = await snapshotConnectorCatalog(catalog, { ownerAccess: true })
  const current = admission(first), guard = createConnectorCompletionGuard(current)
  await writer.installMcp({ ...manifest, name: 'Changed source' }, { expectedRevision: installed.revision })
  const next = await snapshotConnectorCatalog(catalog, { ownerAccess: true })
  assert.notEqual(first.catalogFingerprint, next.catalogFingerprint)
  assert.equal(guard.requestRepair({ ...current, ...next }).kind, 'cancel')
  assert.equal((await snapshotConnectorCatalog(catalog, { ownerAccess: false })).mcpAdmitted, false)
})
