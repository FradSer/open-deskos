import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createExperienceStore } from '../src/agent-plugins/experience.mjs'
import { reportProcedure, reportSkill } from './fixtures/agent-learning-reports.mjs'
import { loadLiveContinuation } from './helpers/agent-live-continuation.mjs'

async function evidence(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-live-resume-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'accepted-experience.json')
  await createExperienceStore(file).append([{ title: 'Desk report method', body: reportProcedure, sources: [{ tool: 'agent_mcp_call', digest: 'a'.repeat(64) }] }])
  const content = await readFile(file, 'utf8')
  const report = { realModel: true, realJev: true, offlineFixture: false, syntheticData: true, sourceUnchanged: true, cleanupPassed: true,
    candidate: 'a'.repeat(40), hostValidationRequired: true,
    taskChecks: [{ phase: 'saved-training', state: 'finished', verification: 'passed', learning: 'applied', score: { expected: 6, actual: 6, passed: true } }],
    acceptedExperience: { file: 'accepted-experience.json', entries: 1, sha256: createHash('sha256').update(content).digest('hex') } }
  const save = () => writeFile(join(root, 'report.json'), JSON.stringify(report), { mode: 0o600 })
  await save()
  return { root, file, report, save }
}

test('continuation restores a validated immutable snapshot without transcript or task state', async t => {
  const f = await evidence(t)
  const result = await loadLiveContinuation(f.root)
  assert.equal(result.experience.entries.length, 1)
  assert.deepEqual(Object.keys(result.experience).sort(), ['entries', 'version'])
  assert.equal(result.source.experienceSha256, f.report.acceptedExperience.sha256)
  await writeFile(f.file, '{}', { mode: 0o600 })
  assert.equal(result.experience.entries.length, 1)
  await assert.rejects(loadLiveContinuation(f.root))
})

test('continuation refuses offline, changed-source, incomplete, or unverified training evidence', async t => {
  for (const update of [{ realModel: false }, { realJev: false }, { offlineFixture: true }, { sourceUnchanged: false }, { cleanupPassed: false }, { taskChecks: [] }]) {
    const f = await evidence(t)
    Object.assign(f.report, update); await f.save()
    await assert.rejects(loadLiveContinuation(f.root))
  }
})

test('continuation refuses digest substitution and linked artifacts', async t => {
  const f = await evidence(t)
  f.report.acceptedExperience.sha256 = 'b'.repeat(64); await f.save()
  await assert.rejects(loadLiveContinuation(f.root))
  const original = await readFile(f.file, 'utf8')
  await rm(f.file); await writeFile(join(f.root, 'other.json'), original, { mode: 0o600 }); await symlink(join(f.root, 'other.json'), f.file)
  await assert.rejects(loadLiveContinuation(f.root))
})

test('shared synthetic task contract permits experience without disclosing the learned procedure', () => {
  assert.match(reportSkill, /same.*training.*procedure/i)
  assert.match(reportSkill, /accepted experience/i)
  assert.equal(reportSkill.includes(reportProcedure), false)
  assert.doesNotMatch(reportSkill, /subtract 7|divide by 5/)
})
