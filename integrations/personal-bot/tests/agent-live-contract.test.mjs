import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { agentLivePlan, createLivePlan, capLiveModelOutput, recordLiveGenerationUsage, selectLiveChildAdmission, assertLiveChildTurn, createLiveRequestBudget, createBudgetedFetch, learningComparison, finalizeAgentAcceptance, finalizeAgentAcceptanceFile } from './helpers/agent-live-contract.mjs'
import { reportData, reportScore, reportProcedure } from './fixtures/agent-learning-reports.mjs'

test('synthetic report grading is independent of assistant claims and keeps holdout procedures hidden', () => {
  assert.equal(reportScore('training', 'RESULT=6').passed, true)
  assert.equal(reportScore('training', 'All checks passed').passed, false)
  assert.equal(reportScore('training', 'RESULT=6 RESULT=7').passed, false)
  assert.equal(reportScore('training', 'RESULT=6.5').passed, false)
  assert.equal(reportData('holdout-1').procedure, undefined)
  assert.equal(reportData('restart').procedure, undefined)
  assert.equal(reportScore('holdout-1', 'RESULT=4').passed, true)
  assert.equal(reportScore('holdout-2', 'RESULT=13').passed, true)
  assert.equal(reportScore('holdout-3', 'RESULT=3').passed, true)
  for (const answer of ['RESULT=4e-3', 'RESULT=4/2', 'RESULT=4n', 'RESULT=4 RESULT=']) assert.equal(reportScore('holdout-1', answer).passed, false, answer)
  assert.equal(reportScore('holdout-1', 'RESULT=4e0').passed, true)
  assert.equal(reportScore('training', 'Private unrelated answer').markerStatus, 'missing')
  assert.equal(reportScore('training', 'RESULT=6 RESULT=6').markerStatus, 'multiple')
  assert.equal(reportScore('training', 'RESULT=6**').markerStatus, 'invalid')
  assert.equal(reportScore('training', 'RESULT=7').markerStatus, 'valid')
})

test('shared live request budget refuses dispatch after its exact limit', () => {
  const budget = createLiveRequestBudget(2)
  budget.reserve('generation', 'training')
  budget.reserve('jev', 'training')
  assert.equal(budget.exhausted, false)
  assert.throws(() => budget.reserve('generation', 'correction'), /budget exhausted/)
  assert.equal(budget.exhausted, true)
  assert.equal(budget.calls.length, 2)
  assert.equal(createLivePlan().maxRequests, 80)
  assert.equal(createLivePlan({ maxRequests: 160 }).maxRequests, 160)
  const maximum = createLiveRequestBudget(256)
  for (let index = 0; index < 256; index++) maximum.reserve(index % 2 ? 'jev' : 'generation', 'explicit-budget')
  assert.throws(() => maximum.reserve('generation', 'correction'), /budget exhausted/)
  assert.equal(maximum.calls.length, 256)
  for (const limit of [0, -1, 257, 1.5, NaN, Infinity, '160']) assert.throws(() => createLivePlan({ maxRequests: limit }), /limit/)
  assert.equal(createLivePlan({ maxRequests: 256 }).deadlineMs, 900000)
  assert.equal(agentLivePlan.maxOutputTokens, 2048)
})

test('explicit output resources retain independent request and execution bounds', async () => {
  assert.equal(createLivePlan().maxOutputTokens, 2048)
  const plan = createLivePlan({ maxOutputTokens: 16384 })
  assert.equal(plan.maxOutputTokens, 16384)
  assert.equal(plan.maxRequests, 80); assert.equal(plan.deadlineMs, 900000)
  assert.equal(capLiveModelOutput({ maxTokens: 8192 }, plan.maxOutputTokens).maxTokens, 8192)
  for (const maxOutputTokens of [0, -1, 16385, 1.5, NaN, Infinity, '16384']) {
    assert.throws(() => createLivePlan({ maxOutputTokens }), /output limit/)
  }
  let dispatched = 0
  const budget = createLiveRequestBudget(2)
  const request = createBudgetedFetch({ budget, kind: 'generation', phase: () => 'explicit-output', maxOutputTokens: 16384,
    fetchImpl: async () => { dispatched++; return new Response('{}') } })
  await request('https://example.invalid', { body: JSON.stringify({ max_tokens: 16384 }) })
  await assert.rejects(request('https://example.invalid', { body: JSON.stringify({ max_tokens: 16385 }) }), /output limit/)
  assert.equal(dispatched, 1); assert.equal(budget.calls.length, 1)

})

test('actual HTTP dispatch shares the limit, refuses redirects and preserves failed attempts', async () => {
  const budget = createLiveRequestBudget(2)
  let dispatched = 0
  const request = createBudgetedFetch({ budget, kind: 'generation', phase: () => 'fixture', fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error')
    dispatched++
    if (dispatched === 1) throw Error('Controlled transport failure')
    return new Response('{}')
  } })
  await assert.rejects(request('https://example.invalid'), /Controlled/)
  await request('https://example.invalid')
  await assert.rejects(request('https://example.invalid'), /budget exhausted/)
  assert.equal(dispatched, 2)
  assert.equal(budget.calls[0].failed, true)
})

test('generation transport refuses unbounded or overridden output limits before HTTP dispatch', async () => {
  const budget = createLiveRequestBudget(2)
  let dispatched = 0
  const request = createBudgetedFetch({ budget, kind: 'generation', phase: () => 'fixture', maxOutputTokens: 2048,
    fetchImpl: async () => { dispatched++; return new Response('{}') } })
  for (const payload of [{ max_tokens: 4096 }, { max_tokens: 2048, max_output_tokens: 4096 }, {}, { max_tokens: 0 },
    { max_tokens: '2048' }, { max_tokens: 2048, n: 2 }]) {
    await assert.rejects(request('https://example.invalid', { body: JSON.stringify(payload) }), /output limit/)
  }
  assert.equal(dispatched, 0)
  assert.equal(budget.calls.length, 0)
  await request('https://example.invalid', { body: JSON.stringify({ max_tokens: 2048 }) })
  assert.equal(dispatched, 1)
})

test('generation usage records reported reasoning only and excludes message content', () => {
  for (const reasoning of [undefined, null, '4', -1, NaN, Infinity, 0, 4]) {
    const call = { kind: 'generation' }
    recordLiveGenerationUsage(call, { stopReason: 'length', usage: { input: 5, output: 7, reasoning }, content: 'private fixture text' })
    assert.deepEqual(call, { kind: 'generation', stopReason: 'length', inputTokens: 5, outputTokens: 7,
      ...(typeof reasoning === 'number' && Number.isFinite(reasoning) && reasoning >= 0 ? { reasoningTokens: reasoning } : {}) })
  }
})

test('child acceptance binds one fresh admission to its exact turn and identity revision', () => {
  const identity = { id: 'reporter', revision: 'a'.repeat(64) }
  const before = new Map([['existing', 1]])
  const prior = { taskId: 'existing', turn: 1, identity }
  const next = { ...prior, turn: 2 }
  const admitted = selectLiveChildAdmission(before, [next], identity)
  assert.equal(admitted.taskId, 'existing'); assert.equal(admitted.turn, 2); assert.equal(admitted.continued, true)
  assertLiveChildTurn(admitted, next)
  const temporary = { taskId: 'new', turn: 1, identity: null }
  assert.equal(selectLiveChildAdmission(before, [prior, temporary], null).continued, false)
  assert.equal(selectLiveChildAdmission(before, [{ ...temporary, identity }], identity).turn, 1)
  for (const tasks of [[prior], [{ ...next, turn: 3 }], [{ ...next, turn: 0 }], [{ ...temporary, turn: 2 }],
    [next, { ...temporary, identity }], [{ ...next, identity: { ...identity, id: 'different' } }],
    [{ ...next, identity: { ...identity, revision: 'b'.repeat(64) } }], [{ ...next, identity: null }]]) {
    assert.throws(() => selectLiveChildAdmission(before, tasks, identity), /child|Child/)
  }
  assert.throws(() => selectLiveChildAdmission(before, [{ ...temporary, identity }], null), /Child/)
  for (const changed of [{ ...next, taskId: 'different' }, { ...next, turn: 1 }, { ...next, turn: 3 },
    { ...next, identity: { ...identity, revision: 'b'.repeat(64) } }, { ...next, identity: null }]) {
    assert.throws(() => assertLiveChildTurn(admitted, changed), /Child/)
  }
})

test('learning comparison does not turn persistence, a tie or three examples into general benefit', () => {
  const passed = { passed: true }, failed = { passed: false }
  assert.match(learningComparison([{ baseline: passed, candidate: passed }]).conclusion, /No improvement/)
  assert.equal(learningComparison([{ baseline: failed, candidate: passed }]).difference, 1)
  assert.equal(learningComparison([{ baseline: failed, candidate: passed }]).generalLearningBenefit, 'not_established')
})

test('host finalization withdraws a provisional pass when fingerprinting fails or source changes', () => {
  const provisional = { passed: true, functionalPassed: true, cleanupPassed: true, hostValidationRequired: true }
  const failed = finalizeAgentAcceptance(provisional, { exitCode: 0, sourceUnchanged: false, sourceFailure: true })
  assert.equal(failed.passed, false)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.hostFailure, 'source_fingerprint_unavailable')
  assert.equal(finalizeAgentAcceptance(provisional, { exitCode: 0, sourceUnchanged: false }).passed, false)
  assert.equal(finalizeAgentAcceptance(provisional, { exitCode: 0, sourceUnchanged: true }).passed, true)
  assert.equal(finalizeAgentAcceptance(provisional, { exitCode: 0, sourceUnchanged: true, forcedCleanup: true }).passed, false)
})

test('a real evidence file is rewritten as failed when the final source scan throws', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-agent-host-finalize-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'report.json')
  await writeFile(file, JSON.stringify({ passed: true, functionalPassed: true, cleanupPassed: true, hostValidationRequired: true }))
  const result = await finalizeAgentAcceptanceFile(file, { exitCode: 0, fingerprints: {}, fingerprint: async () => { throw Error('Unavailable source') } })
  assert.equal(result.passed, false)
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(persisted.passed, false)
  assert.equal(persisted.hostFailure, 'source_fingerprint_unavailable')
})

test('plan inspection needs no credentials, provider, Docker or external request', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/test-agent-runtime-live.mjs', '--plan'], {
    cwd: new URL('../', import.meta.url), env: {}, timeout: 10000,
  })
  assert.deepEqual(JSON.parse(stdout), agentLivePlan)
})

async function offlineReport(t, plan = agentLivePlan, extra = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-live-contract-')))
  const child = spawn(process.execPath, ['tests/acceptance/agent-runtime-live.mjs'], { cwd: new URL('../', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: root, TEMP: root, TMP: root,
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}) } })
  const exited = once(child, 'exit')
  t.after(async () => { try { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited } } finally { await rm(root, { recursive: true, force: true }) } })
  let diagnostics = ''
  child.stdout.on('data', chunk => { diagnostics += chunk })
  child.stderr.on('data', chunk => { diagnostics += chunk })
  child.stdin.end(JSON.stringify({ offlineFixture: true, fixtureDirectory: root, hostValidationRequired: true, plan, provider: 'offline-fixture', model: { id: 'fixture' }, providerConfig: {}, jevKey: 'offline-only', candidate: 'fixture', fingerprints: {}, ...extra }))
  const [code] = await exited
  const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'))
  const acceptedExperience = report.acceptedExperience ? await readFile(join(root, 'accepted-experience.json'), 'utf8') : undefined
  return { report, code, diagnostics, acceptedExperience }
}

for (const [resources, plan] of [['default', agentLivePlan], ['explicit', createLivePlan({ maxOutputTokens: 16384 })]]) test(`the complete acceptance runner proves its own contract with zero external calls (${resources})`, { timeout: 60000 }, async t => {
  const { report, code, diagnostics, acceptedExperience } = await offlineReport(t, plan)
  assert.equal(code, 0, JSON.stringify({ report, diagnostics }))
  assert.equal(report.passed, false, 'a container cannot approve its own source validation')
  assert.equal(report.functionalPassed, true)
  const restart = report.taskChecks.find(check => check.phase === 'saved-restart')
  assert.equal(restart.turn, 2); assert.equal(restart.continued, true)
  assert.equal(report.status, 'pending_host_validation')
  assert.equal(finalizeAgentAcceptance(report, { exitCode: code, sourceUnchanged: true }).passed, true)
  assert.equal(report.truncatedGenerationCalls, report.calls.filter(call => call.kind === 'generation' && call.stopReason === 'length').length)
  assert.equal(report.model.pricingKnown, false)
  assert.equal(report.model.actualCharge, 'not_established')
  assert.equal(report.realModel, false)
  assert.equal(report.realJev, false)
  assert.equal(report.externalRequests, 0)
  assert.equal(report.pairs.length, 3)
  assert(report.pairs.every(pair => pair.candidate.experienceReads > 0))
  assert.equal(report.learning.generalLearningBenefit, 'not_established')
  assert.equal(report.acceptedExperience.entries, 1)
  assert.equal(report.acceptedExperience.sha256, createHash('sha256').update(acceptedExperience).digest('hex'))
  const saved = JSON.parse(acceptedExperience)
  assert.equal(saved.entries.length, 1)
  assert.deepEqual(Object.keys(saved).sort(), ['entries', 'version'])
})

test('budget exhaustion stops the real runner before dependent stages without replay', { timeout: 15000 }, async t => {
  const { report, code } = await offlineReport(t, { ...agentLivePlan, maxRequests: 2 })
  assert.equal(code, 1)
  assert.equal(report.passed, false)
  assert.equal(report.failure.reason, 'request_limit')
  assert.equal(report.calls.length, 2)
  assert(report.calls.every(call => call.phase === 'install-skill'))
  assert.equal(report.scenarios.length, 0)
  assert.equal(report.cleanupPassed, true)
  assert.equal(report.externalRequests, 0)
})

test('task evaluation labels seeded setup and keeps actual execution and paired learning checks', { timeout: 60000 }, async t => {
  const { report, code, diagnostics } = await offlineReport(t, agentLivePlan, { taskEvaluation: true })
  assert.equal(code, 0, JSON.stringify({ report, diagnostics }))
  assert.deepEqual(report.setup, { method: 'host_fixture', naturalLanguageVerified: false })
  assert.equal(report.scenarios.some(scenario => ['install-skill', 'install-mcp', 'save-identity'].includes(scenario.name)), false)
  assert.deepEqual(report.scenarios.map(scenario => scenario.name), ['saved-training', 'saved-restart', 'temporary-child', 'paired-heldout'])
  assert.equal(report.pairs.length, 3)
  assert(report.calls.every(call => !['install-skill', 'install-mcp', 'save-identity'].includes(call.phase)))
})

test('continuation separates supplied-data pairs, fixture admission, and original live training proof', { timeout: 60000 }, async t => {
  const experience = { version: 1, entries: [{ id: createHash('sha256').update(reportProcedure).digest('hex').slice(0, 32),
    title: 'Desk report conversion', body: reportProcedure, sources: [{ tool: 'agent_mcp_call', digest: 'a'.repeat(64) }], createdAt: '2026-10-16T00:00:00.000Z' }] }
  const { report, code, diagnostics } = await offlineReport(t, agentLivePlan, { continuation: { experience, source: { reportSha256: 'a'.repeat(64), experienceSha256: createHash('sha256').update(JSON.stringify(experience)).digest('hex'), candidate: 'a'.repeat(40) } } })
  assert.equal(code, 0, JSON.stringify({ report, diagnostics }))
  assert.equal(report.coverage, 'isolated_continuation')
  assert.deepEqual(report.scenarios.map(scenario => scenario.name), ['paired-heldout', 'saved-restart', 'temporary-child'])
  assert.equal(report.pairProtocol.mcpEnabled, false)
  assert.equal(report.pairProtocol.input, 'supplied_synthetic_data')
  assert(report.pairs.every(pair => pair.candidate.passed && pair.candidate.experienceReads > 0 && !pair.baseline.passed))
  assert(report.taskChecks.every(check => check.fixtureAdmission && check.coordinatorInference === false))
  assert.equal(report.calls.filter(call => call.kind === 'jev').length, 0)
  assert.deepEqual(report.routes, [])
  assert(report.routes.every(route => route.mcpCapabilities === 0))
  assert.equal(report.restartFixture.sameIdentityRevision, true)
  assert.equal(report.externalRequests, 0)
})
