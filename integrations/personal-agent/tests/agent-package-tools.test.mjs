import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'
import { openAgentCatalog } from '../src/agent-catalog/catalog.mjs'
import { createAgentCatalogRuntime } from '../src/agent-catalog/tools.mjs'

async function fixture(t, mcpEnabled = false, ownerAccess = true, onPrivateData = () => {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-package-tools-')))
  const candidates = join(root, 'candidates')
  await mkdir(join(candidates, 'report-helper'), { recursive: true })
  await writeFile(join(candidates, 'report-helper', 'SKILL.md'), '---\nname: report-helper\ndescription: Prepare measured reports.\n---\nRead checks.md.')
  await writeFile(join(candidates, 'report-helper', 'checks.md'), 'Check three regions.')
  const catalog = await openAgentCatalog(join(root, 'catalog'))
  const events = join(root, 'events')
  await writeFile(events, '')
  const runtime = createAgentCatalogRuntime({ catalog, candidatesDirectory: candidates, mcpEnabled, ownerAccess, onPrivateData, env: { ODK_MCP_EVENTS: events } })
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }) })
  const call = async (name, params = {}, signal = undefined) => (await runtime.tools().find(tool => tool.name === name).execute('fixture', params, signal)).structuredContent.value
  return { root, candidates, catalog, runtime, call, events }
}

test('resident package tools install an exact candidate snapshot, retrieve resources and preserve removal/rollback contracts', async t => {
  const { runtime, call } = await fixture(t)
  runtime.beginTurn('Install the report Skill', 'package_manage')
  const candidate = await call('agent_package_candidate', { id: 'report-helper' })
  const installed = await call('agent_package_install', { id: candidate.id, revision: candidate.revision })
  assert.equal(installed.kind, 'skill')
  const main = await call('agent_skill_read', { id: installed.id })
  assert.match(main.text, /Read checks.md/)
  assert.deepEqual(main.resources, ['SKILL.md', 'checks.md'])
  assert.equal((await call('agent_skill_read', { id: installed.id, path: 'checks.md' })).text, 'Check three regions.')
  assert.match(runtime.context(), /report-helper/)
  await call('agent_package_remove', { id: installed.id, expectedRevision: installed.revision })
  assert.equal((await call('agent_packages_list')).total, 0)
  await call('agent_package_rollback', { id: installed.id, revision: installed.revision })
  assert.equal((await call('agent_packages_list')).total, 1)
  runtime.beginTurn('', null)
  await assert.rejects(call('agent_package_remove', { id: installed.id }), /owner turn/i)
})

test('candidate replacement, traversal, and a non-management intent cannot install packages', async t => {
  const { candidates, runtime, catalog, call } = await fixture(t)
  runtime.beginTurn('Inspect a Skill', 'package_query')
  const candidate = await call('agent_package_candidate', { id: 'report-helper' })
  await assert.rejects(call('agent_package_install', { id: candidate.id, revision: candidate.revision }), /management/i)
  runtime.beginTurn('Install the report Skill', 'package_manage')
  await writeFile(join(candidates, 'report-helper', 'checks.md'), 'Replaced source.')
  await assert.rejects(call('agent_package_install', { id: candidate.id, revision: candidate.revision }), /changed/i)
  await assert.rejects(call('agent_package_candidate', { id: '../report-helper' }))
  assert.deepEqual(await catalog.list(), [])
})

test('a pre-cancelled package mutation cannot write', async t => {
  const { runtime, catalog, call } = await fixture(t)
  runtime.beginTurn('Install report', 'package_manage')
  const candidate = await call('agent_package_candidate', { id: 'report-helper' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(call('agent_package_install', { id: candidate.id, revision: candidate.revision }, controller.signal), /abort/i)
  assert.deepEqual(await catalog.list(), [])
})

test('cancellation while a mutation waits for catalog ownership prevents the eventual write', async t => {
  const { root, runtime, catalog, call } = await fixture(t)
  const path = join(root, 'catalog')
  const releaseLock = await lockfile.lock(path, { realpath: false })
  const originalLock = lockfile.lock
  let released = false, entered
  const waiting = new Promise(resolve => { entered = resolve })
  const release = async () => { if (!released) { released = true; await releaseLock() } }
  t.after(async () => { lockfile.lock = originalLock; await release() })
  lockfile.lock = (file, options) => { if (file === path) entered(); return originalLock(file, options) }
  runtime.beginTurn('Install report', 'package_manage')
  const candidate = await call('agent_package_candidate', { id: 'report-helper' })
  const controller = new AbortController()
  const pending = call('agent_package_install', { id: candidate.id, revision: candidate.revision }, controller.signal)
  const rejected = assert.rejects(pending, /aborted/i)
  await waiting
  controller.abort()
  await release()
  await rejected
  assert.deepEqual(await catalog.list(), [])
})

test('installed MCP tools run in one session and removal closes the old connector', async t => {
  const { runtime, catalog, call, events } = await fixture(t, true)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'offline-fixture', name: 'Offline reporting', transport: { type: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))], env: { FIXTURE_EVENTS: { fromEnv: 'ODK_MCP_EVENTS' } } } }
  const installed = await catalog.installMcp(manifest)
  await runtime.refresh()
  assert.match(runtime.routingDescription(), /Offline reporting/)
  runtime.beginTurn('Use the reporting MCP', 'extension')
  const discovery = await call('agent_mcp_tools', { id: manifest.id })
  assert.equal(discovery.tools[0].name, 'echo')
  assert.equal((await call('agent_mcp_call', { id: manifest.id, revision: discovery.revision, tool: 'echo', arguments: { text: 'first' } })).result.structuredContent.calls, 1)
  assert.equal((await call('agent_mcp_call', { id: manifest.id, revision: discovery.revision, tool: 'echo', arguments: { text: 'second' } })).result.structuredContent.calls, 2)
  const pid = Number((await readFile(events, 'utf8')).match(/pid:(\d+)/)[1])
  runtime.beginTurn('Remove reporting connector', 'package_manage')
  await call('agent_package_remove', { id: manifest.id, expectedRevision: installed.revision })
  assert.throws(() => process.kill(pid, 0), /ESRCH/)
  await assert.rejects(call('agent_mcp_tools', { id: manifest.id }), /installed|unavailable/i)
})

test('malformed candidate bytes and private source paths never enter tool errors', async t => {
  const { candidates, runtime, call } = await fixture(t)
  await mkdir(join(candidates, 'bad-mcp'))
  await writeFile(join(candidates, 'bad-mcp', 'manifest.json'), 'private-fixture-value')
  runtime.beginTurn('Inspect candidate', 'package_query')
  await assert.rejects(call('agent_package_candidate', { id: 'bad-mcp' }), error => !/private-fi|candidates/.test(error.message))
})

test('an MCP call cannot silently switch the installed revision after schema discovery', async t => {
  const { runtime, catalog, call, events } = await fixture(t, true)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'offline-fixture', name: 'Original connector', transport: { type: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))], env: { FIXTURE_EVENTS: { fromEnv: 'ODK_MCP_EVENTS' } } } }
  await catalog.installMcp(manifest)
  runtime.beginTurn('Use original connector', 'extension')
  const discovery = await call('agent_mcp_tools', { id: manifest.id })
  await catalog.installMcp({ ...manifest, name: 'Updated connector' })
  await assert.rejects(call('agent_mcp_call', { id: manifest.id, revision: discovery.revision, tool: 'echo', arguments: { text: 'must not reach replacement' } }), /revision changed/i)
  assert(!String(await readFile(events)).includes('called:echo'))
})

test('owner-only connectors remain hidden and cannot start in a child runtime', async t => {
  const { runtime, catalog, call, events } = await fixture(t, true, false)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'private-source', name: 'Private source', policy: { privateData: true, ownerOnly: true },
    transport: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))], env: { FIXTURE_EVENTS: { fromEnv: 'ODK_MCP_EVENTS' } } } }
  const installed = await catalog.installMcp(manifest)
  await runtime.refresh()
  runtime.beginTurn('Use private source', 'extension')
  assert.equal((await call('agent_packages_list')).total, 0)
  assert.doesNotMatch(runtime.context(), /private-source/)
  assert.doesNotMatch(runtime.routingDescription(), /private-source/)
  await assert.rejects(call('agent_mcp_tools', { id: manifest.id }), /unavailable/)
  await assert.rejects(call('agent_mcp_call', { id: manifest.id, revision: installed.revision, tool: 'echo', arguments: { text: 'forbidden' } }), /unavailable/)
  assert.equal(await readFile(events, 'utf8'), '')
})

test('private connector results carry only installed host policy and stale results are withheld', async t => {
  const { runtime, catalog, call, events } = await fixture(t, true)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'private-source', name: 'Private source', policy: { privateData: true },
    transport: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))], env: { FIXTURE_EVENTS: { fromEnv: 'ODK_MCP_EVENTS' } } } }
  await catalog.installMcp(manifest)
  runtime.beginTurn('Read private source', 'extension')
  const discovery = await call('agent_mcp_tools', { id: manifest.id })
  const invoke = text => runtime.tools().find(tool => tool.name === 'agent_mcp_call').execute('private', {
    id: manifest.id, revision: discovery.revision, tool: 'echo', arguments: { text },
  })
  assert.equal((await invoke('private result')).details.privateData, true)
  const originalPackage = catalog.package
  let reads = 0
  catalog.package = async id => {
    if (++reads === 3) await catalog.remove(id)
    return originalPackage(id)
  }
  await assert.rejects(invoke('result withheld after removal'), /installed|unavailable|revision changed/i)
  assert.match(await readFile(events, 'utf8'), /called:echo/)
})

test('child package mutations cannot change the shared owner catalog', async t => {
  const { candidates, runtime, catalog, call } = await fixture(t, false, false)
  runtime.beginTurn('Read public Skill', 'package_query')
  const candidate = await call('agent_package_candidate', { id: 'report-helper' })
  const installed = await catalog.installSkill(join(candidates, 'report-helper'))
  assert.match((await call('agent_skill_read', { id: installed.id })).text, /Read checks/)
  runtime.beginTurn('Change owner packages', 'package_manage')
  await assert.rejects(call('agent_package_install', { id: candidate.id, revision: candidate.revision }), /owner|unavailable/i)
  await assert.rejects(call('agent_package_remove', { id: installed.id }), /owner|unavailable/i)
  await assert.rejects(call('agent_package_rollback', { id: installed.id, revision: installed.revision }), /owner|unavailable/i)
  assert.equal((await catalog.list())[0].revision, installed.revision)
})

test('private connector calls taint the owner turn before failures, cancellation, and oversized results', async t => {
  let tainted = 0
  const { runtime, catalog, call } = await fixture(t, true, true, () => { tainted++ })
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'private-source', name: 'Private source', policy: { privateData: true },
    transport: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))] } }
  const installed = await catalog.installMcp(manifest)
  runtime.beginTurn('Read private source', 'extension')
  await call('agent_mcp_tools', { id: manifest.id })
  const request = tool => ({ id: manifest.id, revision: installed.revision, tool, arguments: { text: 'private request' } })
  let before = tainted
  const failed = await call('agent_mcp_call', request('fail'))
  assert.equal(failed.result.isError, true)
  assert(tainted > before)
  before = tainted
  const large = await call('agent_mcp_call', request('large'))
  assert.equal(large.result.isError, true)
  assert(tainted > before)
  before = tainted
  const controller = new AbortController()
  const pending = call('agent_mcp_call', request('wait'), controller.signal)
  const rejected = assert.rejects(pending, /abort|unknown/i)
  await new Promise(resolve => setTimeout(resolve, 40))
  controller.abort()
  await rejected
  assert(tainted > before)
  await runtime.close()
})

test('failed private connector initialization still marks the admitted owner turn', async t => {
  let tainted = false
  const { root, runtime, catalog, call } = await fixture(t, true, true, () => { tainted = true })
  await catalog.installMcp({ schemaVersion: 1, kind: 'mcp', id: 'missing-private', name: 'Missing private source', policy: { privateData: true },
    transport: { type: 'stdio', command: join(root, 'missing-executable'), args: [] } })
  runtime.beginTurn('Read a private source', 'extension')
  await assert.rejects(call('agent_mcp_tools', { id: 'missing-private' }), /connection|unavailable/i)
  assert.equal(tainted, true)
})

test('child can still read public MCP connectors without tainting the owner turn', async t => {
  let tainted = false
  const { runtime, catalog, call } = await fixture(t, true, false, () => { tainted = true })
  const installed = await catalog.installMcp({ schemaVersion: 1, kind: 'mcp', id: 'public-source', name: 'Public source',
    transport: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))] } })
  runtime.beginTurn('Read public source', 'extension')
  await call('agent_mcp_tools', { id: installed.id })
  const result = await call('agent_mcp_call', { id: installed.id, revision: installed.revision, tool: 'echo', arguments: { text: 'public' } })
  assert.equal(result.result.content[0].text, 'public')
  assert.equal(tainted, false)
})
