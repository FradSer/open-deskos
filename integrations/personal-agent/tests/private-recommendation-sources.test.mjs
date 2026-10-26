import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPrivateRecommendationConfig, validatePrivateRecommendationConfig, createConfiguredPrivateSources } from '../src/private-recommendation-sources.mjs'

test('private recommendation sources require a private owner configuration and never repair its permissions', async t => {
  assert.deepEqual(loadPrivateRecommendationConfig({}), { version: 1, sources: [] })
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-private-source-config-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'sources.json')
  const selected = { version: 1, sources: [{ id: 'gmail', goal: 'Recommend useful next steps from recent notifications.' }] }
  await writeFile(path, JSON.stringify(selected), { mode: 0o600 })
  const env = { ODK_PRIVATE_RECOMMENDATIONS_FILE: path }
  assert.equal(loadPrivateRecommendationConfig(env).sources[0].id, 'gmail')
  const alias = join(dir, 'alias.json')
  await symlink(path, alias)
  assert.throws(() => loadPrivateRecommendationConfig({ ODK_PRIVATE_RECOMMENDATIONS_FILE: alias }), /Private recommendation configuration/)
  if (process.platform !== 'win32') {
    await chmod(path, 0o644)
    assert.throws(() => loadPrivateRecommendationConfig(env), /Private recommendation configuration/)
  }
})

test('private source configuration cannot load arbitrary modules or install a connector', () => {
  for (const sources of [[{ id: 'unknown', goal: 'Check updates' }], [{ id: 'gmail', goal: 'Check updates', module: '/tmp/source.mjs' }],
    [{ id: 'gmail', goal: 'Check updates', query: '' }], [{ id: 'gmail', goal: 'Check updates', maxMessages: 9 }],
    [{ id: 'gmail', goal: 'Check updates' }, { id: 'gmail', goal: 'Repeat' }]]) {
    assert.throws(() => validatePrivateRecommendationConfig({ version: 1, sources }), /Private recommendation configuration/)
  }
  assert.throws(() => validatePrivateRecommendationConfig({ version: 1, sources: [], enabled: true }))
})

test('selecting a private profile starts no provider and a missing connector leaves the Agent available', async () => {
  let catalogReads = 0, opens = 0
  const config = validatePrivateRecommendationConfig({ version: 1, sources: [{ id: 'gmail', goal: 'Recommend next steps.' }] })
  const sources = createConfiguredPrivateSources({ config, catalog: { async package() { catalogReads++; throw Error('not installed') } },
    openSession: async () => { opens++; throw Error('must not start') } })
  assert.equal(catalogReads, 0)
  await sources.prepare(new AbortController().signal)
  assert.deepEqual(sources.rules(), [])
  assert(catalogReads > 0)
  assert.equal(opens, 0)
  await sources.close()
})
