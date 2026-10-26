import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectPrivateFeedback, privateFeedbackSignalsSafe } from '../src/private-feedback-projection.mjs'
import { queueFeedback, scheduleFeedback, resumePrivateFeedback, feedbackFor, feedbackRuleKey } from '../src/proactive-feedback-memory.mjs'

function fixture() {
  const event = 'a'.repeat(64)
  const rule = { id: 'event-rule', privateSourceId: 'gmail', privateEventKey: event, goal: 'Review notifications.',
    actions: [{ id: 'review', tool: 'private_source_review', params: { sourceId: 'gmail', handle: event } }] }
  const proposal = { ruleId: rule.id, ruleVersion: JSON.stringify(rule), privateData: true, privateSourceId: 'gmail', privateEventKey: event,
    sourceSnapshot: { sourceId: 'gmail', eventKey: event }, action: { tool: 'private_source_review', params: { sourceId: 'gmail', handle: event } },
    advice: 'PRIVATE_MAIL_SUBJECT owner@example.test https://private.test/id', nextStep: 'PRIVATE_DERIVED_ADVICE', evidence: [{ value: 'PRIVATE_MAIL_BODY' }] }
  const watch = { rules: () => [rule], privateSources: { valid: () => true }, canRefineFeedbackMemory: () => true }
  watch.privateSources.snapshot = () => proposal.sourceSnapshot
  return { watch, proposal, rule }
}

test('private feedback projects only a fixed review stage and never mail or derived advice', () => {
  const { watch, proposal } = fixture()
  const projected = projectPrivateFeedback(watch, proposal)
  assert.equal(projected.scopeId, 'private-feedback-gmail')
  assert.match(projected.scopeKey, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_|example\.test|https:|a{64}/)
  assert.equal(privateFeedbackSignalsSafe([{ subject: 'private notification' }], projected), true)
  assert.equal(privateFeedbackSignalsSafe([{ subject: proposal.advice }], projected), false)
})

function learningFixture() {
  const f = fixture(), inputs = []
  f.proposal.id = '10000000-0000-4000-8000-000000000001'
  Object.assign(f.watch, { proposals: [f.proposal], feedbackMemory: { version: 1, entries: [], jobs: [] }, feedbackMemoryEnabled: true,
    now: () => Date.parse('2026-10-25T10:00:00Z'), closed: false, storageFailure: false, controller: new AbortController(), interactionRevision: 0,
    canRefineFeedbackMemory: () => true, persist() {}, emit() {},
    async refineFeedbackMemory(input) { inputs.push(input); return { subject: 'private notification', dimension: 'utility' } } })
  return { ...f, inputs }
}
async function settle(watch) {
  for (let i = 0; i < 100 && ['queued', 'running'].includes(watch.proposals[0].feedbackLearning.status); i++) await new Promise(resolve => setTimeout(resolve, 2))
  await watch.feedbackInflight
}

test('the existing asynchronous outbox sends only a fixed private projection and later events receive that preference', async () => {
  const f = learningFixture()
  queueFeedback(f.watch, f.proposal, 'useful')
  assert.equal(f.proposal.feedbackLearning.status, 'queued')
  assert.doesNotMatch(JSON.stringify(f.watch.feedbackMemory.jobs), /PRIVATE_|example\.test|https:/)
  scheduleFeedback(f.watch); await settle(f.watch)
  assert.equal(f.inputs.length, 1)
  assert.doesNotMatch(JSON.stringify(f.inputs), /PRIVATE_|example\.test|https:|a{64}/)
  assert.equal(f.proposal.feedbackLearning.status, 'applied')
  assert.equal(f.watch.feedbackMemory.entries[0].ruleId, 'private-feedback-gmail')
  const next = fixture()
  next.rule.privateEventKey = 'b'.repeat(64); next.rule.actions[0].params.handle = next.rule.privateEventKey
  next.proposal.privateEventKey = next.rule.privateEventKey; next.proposal.sourceSnapshot.eventKey = next.rule.privateEventKey
  next.proposal.action.params.handle = next.rule.privateEventKey; next.proposal.ruleVersion = JSON.stringify(next.rule)
  next.watch.feedbackMemory = structuredClone(f.watch.feedbackMemory)
  next.watch.proposals = []
  assert.equal(feedbackFor(next.watch, next.rule).signals[0].subject, 'private notification')
})

test('a recovered private job cannot smuggle raw advice into the refinement worker', async () => {
  const f = learningFixture()
  queueFeedback(f.watch, f.proposal, 'useful')
  f.watch.feedbackMemory.jobs[0].advice = f.proposal.advice
  scheduleFeedback(f.watch); await settle(f.watch)
  assert.equal(f.inputs.length, 0)
  assert.equal(f.proposal.feedbackLearning.status, 'unavailable')
  assert.equal(f.watch.feedbackMemory.jobs.length, 0)
})

test('a private feedback job survives source hydration without running before its source becomes available', async () => {
  const f = learningFixture()
  queueFeedback(f.watch, f.proposal, 'useful')
  f.watch.rules = () => []
  scheduleFeedback(f.watch); await settle(f.watch)
  assert.equal(f.inputs.length, 0)
  assert.equal(f.watch.feedbackMemory.jobs.length, 1)
  assert.equal(f.watch.feedbackMemory.jobs[0].status, 'unavailable')
  assert.equal(f.proposal.feedbackLearning.status, 'unavailable')
  f.watch.rules = () => [f.rule]
  resumePrivateFeedback(f.watch); await settle(f.watch)
  assert.equal(f.inputs.length, 1)
  assert.equal(f.proposal.feedbackLearning.status, 'applied')
})

test('an unavailable private projection never falls back to restored generic raw preference subjects', () => {
  const f = learningFixture()
  f.watch.privateSources.valid = () => false
  f.watch.proposals = []
  f.watch.feedbackMemory.entries = [{ ruleId: f.rule.id, ruleVersionKey: feedbackRuleKey(f.rule), revision: 1, signals: [{ subject: 'PRIVATE_MAIL_BODY' }] }]
  assert.equal(feedbackFor(f.watch, f.rule), undefined)
})

test('host denial blocks private refinement and derived preference reuse even with a valid safe projection', async () => {
  for (const deny of [() => false, () => { throw Error('host policy unavailable') }]) {
    const f = learningFixture(), projection = projectPrivateFeedback(f.watch, f.proposal)
    f.watch.canRefineFeedbackMemory = deny
    queueFeedback(f.watch, f.proposal, 'useful')
    assert.equal(f.watch.feedbackMemory.jobs.length, 0)
    scheduleFeedback(f.watch); await settle(f.watch)
    assert.equal(f.inputs.length, 0)
    f.watch.feedbackMemory.entries = [{ ruleId: projection.scopeId, ruleVersionKey: projection.scopeKey, revision: 1,
      signals: [{ subject: 'private notification', decision: 'useful', dimension: 'utility', at: new Date(f.watch.now()).toISOString() }] }]
    assert.equal(feedbackFor(f.watch, f.rule), undefined)
    f.watch.proposals = []
    assert.equal(feedbackFor(f.watch, f.rule), undefined)
  }
})

test('private feedback needs the current host-bound source, event, action, and rule', () => {
  for (const mutation of [
    f => { f.watch.privateSources.valid = () => false },
    f => { f.proposal.privateData = false },
    f => { f.proposal.ruleVersion = '{}' },
    f => { f.proposal.action.params.handle = 'b'.repeat(64) },
    f => { f.proposal.sourceSnapshot.eventKey = 'b'.repeat(64) },
    f => { f.proposal.action.tool = 'gmail_send' },
  ]) {
    const f = fixture(); mutation(f)
    assert.equal(projectPrivateFeedback(f.watch, f.proposal), undefined)
  }
})

test('private feedback scope survives a new event and changes with the owner goal', () => {
  const first = fixture(), next = fixture()
  next.rule.privateEventKey = 'b'.repeat(64)
  next.rule.actions[0].params.handle = next.rule.privateEventKey
  next.proposal.privateEventKey = next.rule.privateEventKey
  next.proposal.sourceSnapshot.eventKey = next.rule.privateEventKey
  next.proposal.action.params.handle = next.rule.privateEventKey
  next.proposal.ruleVersion = JSON.stringify(next.rule)
  assert.equal(projectPrivateFeedback(first.watch, first.proposal).scopeKey, projectPrivateFeedback(next.watch, next.proposal).scopeKey)
  next.rule.goal = 'Another owner goal.'; next.proposal.ruleVersion = JSON.stringify(next.rule)
  assert.notEqual(projectPrivateFeedback(first.watch, first.proposal).scopeKey, projectPrivateFeedback(next.watch, next.proposal).scopeKey)
})
