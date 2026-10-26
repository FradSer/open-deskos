import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProactiveWatch } from '../src/proactive.mjs'
import { proposalStateStore } from '../src/proactive-state.mjs'
import { createGmailRecommendationSource } from '../src/gmail-recommendation-source.mjs'
import { createPrivateProposalSources } from '../src/private-proposal-sources.mjs'

const timestamp = Date.parse('2026-10-25T01:00:00Z')
const ownerConfig = () => ({ version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000,
  maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {}, generationIntervalMs: 0, attentionCooldownMs: 0 })
function port({ account = 'owner@example.invalid', revision = 'b'.repeat(64), body = 'A release notification.', epoch = 1, time = timestamp } = {}) {
  const observer = { enabled: true, epoch, isCurrent: async s => s.connectorRevision === revision && s.epoch === epoch,
    run: async fn => ({ value: await fn({ connectorRevision: revision, epoch,
      schema: () => ({ properties: { expectedAccountKey: { type: 'string', pattern: '^[a-f0-9]{64}$' } } }),
      call: async (name, args) => ({ structuredContent: name === 'gmail_status' ? { state: 'connected', emailAddress: account }
        : name === 'gmail_search' ? { messages: [{ id: 'fixture-event' }], untrusted: true }
        : { id: args.id, subject: 'Release notice', body, truncated: false, untrusted: true, internalDate: String(timestamp - 1000) } }),
    }), connectorRevision: revision, epoch }), close: async () => {} }
  const source = createGmailRecommendationSource({ observer, now: () => time })
  return createPrivateProposalSources([{ id: 'gmail', goal: 'Review release notifications.', label: 'Review notice', source }])
}
function watch(store, privateSources, inputs, now = timestamp) {
  return new ProactiveWatch({ config: ownerConfig(), privateSources, now: () => now, read: async () => { throw Error('No public reads') },
    publish() {}, save: async () => {}, phrase: async ({ advice }) => advice, execute: async () => { throw Error('No action replay') },
    canExecute: () => false, loadState: store.load, saveState: store.save, feedbackMemoryEnabled: true,
    refineFeedbackMemory: async input => { inputs.push(input); return { subject: 'private notification', dimension: 'utility' } },
    generate: async ({ topics }) => ({ suggestions: topics.map(topic => ({ topicId: topic.id, key: 'notification',
      advice: '先确认这次发布是否由本人操作。', actionId: 'review', evidenceIds: topic.evidence.map(e => e.id) })) }),
    judge: async ({ candidates }) => ({ model: 'jev-fixture', answers: Object.fromEntries(candidates.map(c => [c.id,
      { probability: 0.99, groundingProbability: 0.99, threshold: 0.8 }])) }),
  })
}
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert(predicate(), 'The expected local worker boundary did not settle')
}
for (const change of ['process-only', 'account', 'binding', 'revision']) {
  test(`real private checkpoint restart preserves feedback authority (${change})`, async t => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-private-feedback-restart-')))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const store = proposalStateStore(join(dir, 'state.json')), firstInputs = []
    const first = watch(store, port(), firstInputs)
    await first.tick()
    const proposal = first.list()[0]
    assert(proposal)
    await first.presented([proposal.id])
    await first.respond(proposal.id, 'useful')
    await first.close()
    assert.equal(firstInputs.length, 0)
    assert.equal(store.load().feedbackMemory.jobs.length, 1)
    const selection = { epoch: 7, time: timestamp + 1000,
      ...(change === 'account' ? { account: 'different@example.invalid' } : {}),
      ...(change === 'binding' ? { body: 'A changed notification requires a different next step.' } : {}),
      ...(change === 'revision' ? { revision: 'c'.repeat(64) } : {}) }
    const source = port(selection), prepare = source.prepare.bind(source)
    let release
    const hydration = new Promise(resolve => { release = resolve })
    source.prepare = async signal => { await hydration; return prepare(signal) }
    const inputs = [], restarted = watch(store, source, inputs, timestamp + 1000)
    t.after(() => restarted.close())
    restarted.start()
    await until(() => restarted.feedbackMemory.jobs[0]?.status === 'unavailable')
    assert.equal(inputs.length, 0, 'Startup worker cannot send before source hydration')
    release()
    await until(() => !restarted.running)
    await restarted.tick()
    await new Promise(resolve => setTimeout(resolve, 20))
    await restarted.feedbackInflight
    const retained = restarted.proposals.find(item => item.id === proposal.id)
    assert(retained)
    assert.equal(retained.status, 'expired', 'Original action must retain its revoked full snapshot')
    assert.deepEqual(retained.sourceSnapshot, proposal.sourceSnapshot)
    const replacement = restarted.list().find(item => item.status === 'pending')
    assert(replacement, 'Fresh observation can create a separately authorized recommendation')
    assert.notEqual(replacement.id, proposal.id)
    if (change === 'process-only') {
      assert.equal(inputs.length, 1)
      assert.doesNotMatch(JSON.stringify(inputs), /owner@example|Release notice|fixture-event|A release notification/)
    } else assert.equal(inputs.length, 0, 'A changed semantic binding must not revive old owner feedback')
  })
}
