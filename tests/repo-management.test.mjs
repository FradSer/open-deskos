import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { affectedProjectIds } from '../tools/repo.mjs'

const cli = new URL('../tools/repo.mjs', import.meta.url).pathname
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'odk-repo-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, text) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text) }
  const manifest = { schemaVersion: 1, projects: [
    { id: 'agent', root: 'integrations/agent', kind: 'node', owner: 'link', packageName: '@test/agent', lockfile: 'pnpm-lock.yaml', commands: { test: { argv: [process.execPath, '-e', 'process.exit(7)'], mode: 'check' }, deploy: { argv: ['never-run'], mode: 'manual', reason: 'Requires device authorization' } } },
    { id: 'recommendations', root: 'integrations/agent/src/recommendations', kind: 'subsystem', owner: 'link', installRoot: 'integrations/agent', commands: {} }
  ], boundaries: { recommendations: { root: 'integrations/agent/src/recommendations', entry: 'index.mjs', reviewedPeers: ['../errors.mjs'], allowedPackages: ['zod'] }, rendererRoots: ['runtime/shell/src/renderer'], backendRoots: ['integrations/agent/src'] } }
  await put('.git-agent/config.yml', 'scopes:\n  - name: link\n')
  await put('integrations/agent/package.json', JSON.stringify({ name: '@test/agent' }))
  await put('integrations/agent/pnpm-lock.yaml', 'lockfileVersion: 9')
  await put('integrations/agent/src/recommendations/index.mjs', 'export {}')
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' })
  const save = () => put('monorepo.json', JSON.stringify(manifest))
  await save()
  return { root, put, manifest, save, run }
}

test('checks inventory and rejects package omissions and invalid ownership', async t => {
  const f = await fixture(t)
  assert.equal(f.run('check').status, 0)
  await f.put('integrations/missing/package.json', '{"name":"@test/missing"}')
  assert.match(f.run('check').stderr, /unregistered.*integrations\/missing/)
  await rm(join(f.root, 'integrations/missing'), { recursive: true })
  f.manifest.projects[0].owner = 'unknown'
  await f.save()
  assert.match(f.run('check').stderr, /owner/)
})

test('enforces public entry, reviewed peers, and renderer separation', async t => {
  const f = await fixture(t)
  await f.put('integrations/agent/src/consumer.mjs', "import './recommendations/private.mjs'")
  assert.match(f.run('check').stderr, /public entry/)
  await f.put('integrations/agent/src/consumer.mjs', "import './recommendations/index.mjs'")
  await f.put('integrations/agent/src/recommendations/index.mjs', "import '../secret.mjs'")
  assert.match(f.run('check').stderr, /unreviewed peer/)
  await f.put('integrations/agent/src/recommendations/index.mjs', "import '../errors.mjs'")
  await f.put('integrations/agent/src/errors.mjs', 'export {}')
  await f.put('integrations/agent/src/whitebox.mjs', `const example = "import './recommendations/private.mjs'"; const path = './recommendations/private.mjs'; const template = \`import './recommendations/private.mjs'\`;`)
  assert.equal(f.run('check').status, 0)
  await f.put('runtime/shell/src/renderer/bad.mjs', "import '../../../../integrations/agent/src/errors.mjs'")
  assert.match(f.run('check').stderr, /renderer.*backend/)
})

test('uses argv and propagates command exit, never executes manual commands', async t => {
  const f = await fixture(t)
  assert.equal(f.run('run', 'agent', 'test').status, 7)
  assert.equal(f.run('run', 'agent', 'deploy').status, 2)
  assert.match(f.run('run', 'agent', 'deploy').stderr, /manual/)
})

test('affected selects the subsystem and transitive consumers without executing checks', async t => {
  const { manifest } = await fixture(t)
  manifest.projects[0].dependsOn = ['recommendations']
  manifest.projects.push({ id: 'shell', root: 'runtime/shell', dependsOn: ['agent'] })
  assert.deepEqual(affectedProjectIds(manifest, ['integrations/agent/src/recommendations/index.mjs']), ['agent', 'recommendations', 'shell'])
  assert.deepEqual(affectedProjectIds(manifest, ['research/old/package.json']), [])
  assert.deepEqual(affectedProjectIds(manifest, ['monorepo.json']), ['agent', 'recommendations', 'shell'])
})
