import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile, symlink, link, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAgentCatalog, validateMcpManifest } from '../src/agent-catalog/catalog.mjs'

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-catalog-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'skill')
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '---\nname: report-helper\ndescription: |\n  Prepare reports from measured source data.\n---\nRead references/checks.md.\n')
  await writeFile(join(source, 'references', 'checks.md'), 'Check every requested region.')
  return { directory, source, catalog: await openAgentCatalog(join(directory, 'catalog')) }
}

test('Skill install snapshots all text resources, survives restart, and never follows resource traversal', async t => {
  const { directory, source, catalog } = await fixture(t)
  const installed = await catalog.installSkill(source)
  assert.equal(installed.id, 'report-helper')
  assert.equal(installed.kind, 'skill')
  assert.match(installed.revision, /^[a-f0-9]{64}$/)
  await writeFile(join(source, 'references', 'checks.md'), 'later source change')
  const restarted = await openAgentCatalog(join(directory, 'catalog'))
  assert.match((await restarted.skill('report-helper')).files.find(file => file.path === 'references/checks.md').content, /Check every requested region/)
  assert.equal(await restarted.readSkill('report-helper', 'references/checks.md'), 'Check every requested region.')
  for (const path of ['../SKILL.md', '/SKILL.md', 'references/../../outside', 'references\\checks.md']) await assert.rejects(restarted.readSkill('report-helper', path))
  assert.equal((await restarted.list()).length, 1)
})

test('updates, rollback, and removal preserve prior revisions and reject a stale expected revision', async t => {
  const { source, catalog } = await fixture(t)
  const first = await catalog.installSkill(source)
  await writeFile(join(source, 'references', 'checks.md'), 'New checks.')
  const second = await catalog.installSkill(source, { expectedRevision: first.revision })
  assert.notEqual(first.revision, second.revision)
  await assert.rejects(catalog.installSkill(source, { expectedRevision: first.revision }), /changed|revision/i)
  await catalog.rollback('report-helper', first.revision)
  assert.equal(await catalog.readSkill('report-helper', 'references/checks.md'), 'Check every requested region.')
  await catalog.remove('report-helper')
  assert.deepEqual(await catalog.list(), [])
  await catalog.rollback('report-helper', second.revision)
  assert.equal(await catalog.readSkill('report-helper', 'references/checks.md'), 'New checks.')
})

test('invalid or linked Skill candidates leave the installed revision unchanged', async t => {
  const { directory, source, catalog } = await fixture(t)
  const first = await catalog.installSkill(source)
  await writeFile(join(source, 'SKILL.md'), '---\nname: ../../bad\ndescription: bad\n---\nInvalid')
  await assert.rejects(catalog.installSkill(source))
  assert.equal((await catalog.list())[0].revision, first.revision)
  await writeFile(join(source, 'SKILL.md'), '---\nname: report-helper\ndescription: helper\n---\nContent')
  await symlink(join(directory, 'catalog'), join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(catalog.installSkill(source), /link|unsafe/i)
  assert.equal((await catalog.list())[0].revision, first.revision)
})

test('MCP manifests support explicit transports and secret references without native Pi plugins', async t => {
  const { catalog } = await fixture(t)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'report-source', name: 'Report source', transport: {
    type: 'stdio', command: process.execPath, args: ['/explicit/server.mjs'], env: { SOURCE_KEY: { fromEnv: 'ODK_MCP_SOURCE_KEY' } },
  } }
  assert.deepEqual(validateMcpManifest(manifest), manifest)
  const privateManifest = { ...manifest, policy: { privateData: true, ownerOnly: true } }
  assert.deepEqual(validateMcpManifest(privateManifest), privateManifest)
  assert.deepEqual(validateMcpManifest({ ...manifest, policy: {} }).policy, {})
  const installed = await catalog.installMcp(manifest)
  assert.equal((await catalog.mcp(installed.id)).transport.command, process.execPath)
  const remote = { ...manifest, transport: { type: 'streamable-http', url: 'https://example.invalid/mcp', headers: { Authorization: { fromEnv: 'ODK_MCP_AUTH' } } } }
  assert.deepEqual(validateMcpManifest(remote), remote)
  for (const bad of [
    ...[null, [], { privateData: 'true' }, { ownerOnly: 1 }, { unexpected: true }].map(policy => ({ ...manifest, policy })),
    { ...manifest, kind: 'pi-extension' }, { ...manifest, extension: '/tmp/plugin.js' },
    { ...manifest, transport: { type: 'stdio', command: 'node', args: [] } },
    { ...manifest, transport: { ...manifest.transport, env: { KEY: 'embedded-credential' } } },
    { ...manifest, transport: { type: 'streamable-http', url: 'https://user:pass@example.invalid/mcp' } },
    { ...manifest, transport: { type: 'streamable-http', url: 'https://example.invalid/mcp?token=fixture' } },
    { ...manifest, transport: { type: 'streamable-http', url: 'http://example.invalid/mcp' } },
  ]) assert.throws(() => validateMcpManifest(bad))
})

test('corrupt or aliased private snapshots are refused before an update changes activation', async t => {
  const { directory, source, catalog } = await fixture(t)
  const first = await catalog.installSkill(source)
  const file = join(directory, 'catalog', 'report-helper', `${first.revision}.json`)
  const active = join(directory, 'catalog', 'report-helper', 'active.json')
  const before = await readFile(active)
  const snapshot = await readFile(file)
  await writeFile(file, '{}', { mode: 0o600 })
  await assert.rejects(catalog.skill('report-helper'))
  await assert.rejects(catalog.rollback('report-helper', first.revision))
  assert.deepEqual(await readFile(active), before)
  await rm(file)
  await t.test('Given a file symlink When the snapshot is read Then the alias is refused', async t => {
    t.after(() => rm(file, { force: true }))
    try { await symlink(active, file, 'file') }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('Windows file symlink creation requires Developer Mode or the symbolic-link privilege.')
        return
      }
      throw error
    }
    await assert.rejects(catalog.skill('report-helper'))
    assert.deepEqual(await readFile(active), before)
  })
  await t.test('Given a valid hard-linked snapshot When it is read Then activation remains unchanged', async () => {
    const copy = join(directory, 'catalog', 'report-helper', 'snapshot-copy.json')
    await writeFile(copy, snapshot, { mode: 0o600 })
    await link(copy, file)
    await assert.rejects(catalog.skill('report-helper'))
    assert.deepEqual(await readFile(active), before)
  })
})

test('missing reads create no package state and package kinds cannot replace each other', async t => {
  const { directory, source, catalog } = await fixture(t)
  await assert.rejects(catalog.skill('unknown-skill'))
  assert.deepEqual(await readdir(join(directory, 'catalog')), [])
  const first = await catalog.installSkill(source)
  await assert.rejects(catalog.installMcp({ schemaVersion: 1, kind: 'mcp', id: first.id, name: 'Conflicting MCP', transport: { type: 'stdio', command: process.execPath, args: [] } }), /kind/i)
  assert.equal((await catalog.list())[0].revision, first.revision)
})

test('binary and excessive empty directories are refused without changing the active Skill', async t => {
  const { source, catalog } = await fixture(t)
  const first = await catalog.installSkill(source)
  await writeFile(join(source, 'binary'), Buffer.from([0xc3, 0x28]))
  await assert.rejects(catalog.installSkill(source), /UTF-8/)
  await rm(join(source, 'binary'))
  for (let i = 0; i < 260; i++) await mkdir(join(source, `dir-${i}`))
  await assert.rejects(catalog.installSkill(source), /limit|large/i)
  assert.equal((await catalog.list())[0].revision, first.revision)
})

test('missing removals do not consume capacity and installation enforces the inventory limit', async t => {
  const { directory, catalog } = await fixture(t)
  for (let index = 0; index < 130; index++) await catalog.remove(`missing-${index}`)
  assert.deepEqual(await readdir(join(directory, 'catalog')), [])
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'source', name: 'Source', transport: { type: 'stdio', command: process.execPath, args: [] } }
  await Promise.all(Array.from({ length: 128 }, (_, index) => catalog.installMcp({ ...manifest, id: `source-${index}` })))
  await assert.rejects(catalog.installMcp({ ...manifest, id: 'source-overflow' }), /limit|capacity/i)
  assert.equal((await catalog.list()).length, 128)
})

test('removed identities retain their package kind and rollback cannot bypass identity metadata', async t => {
  const { directory, source, catalog } = await fixture(t)
  const first = await catalog.installSkill(source)
  await catalog.remove(first.id)
  await assert.rejects(catalog.installMcp({ schemaVersion: 1, kind: 'mcp', id: first.id, name: 'Different kind', transport: { type: 'stdio', command: process.execPath, args: [] } }), /kind/i)
  await catalog.rollback(first.id, first.revision)
  assert.equal((await catalog.list())[0].kind, 'skill')
  await writeFile(join(directory, 'catalog', first.id, 'identity.json'), JSON.stringify({ schemaVersion: 1, kind: 'mcp', id: first.id }), { mode: 0o600 })
  await assert.rejects(catalog.rollback(first.id, first.revision), /kind/i)
})

test('failed first-install preconditions leave no empty identities or consumed capacity', async t => {
  const { directory, catalog } = await fixture(t)
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'source', name: 'Source', transport: { type: 'stdio', command: process.execPath, args: [] } }
  for (let index = 0; index < 129; index++) await assert.rejects(catalog.installMcp({ ...manifest, id: `source-${index}` }, { expectedRevision: 'a'.repeat(64) }), /revision changed/)
  assert.deepEqual(await readdir(join(directory, 'catalog')), [])
  assert.equal((await catalog.installMcp(manifest)).id, 'source')
})
