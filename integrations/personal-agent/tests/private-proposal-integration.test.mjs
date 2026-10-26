import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch, loadProactiveConfig, ownerConfigWriter, validateOwnerConfig } from '../src/proactive.mjs'
const now = Date.parse('2026-10-25T01:00:00Z'),
  stamp = new Date(now).toISOString(),
  event = 'a'.repeat(64)
const config = () => ({
  version: 2,
  pollMs: 60000,
  maxAgeMs: 300000,
  cooldownMs: 60000,
  maxCandidates: 8,
  maxPush: 3,
  rules: [],
  suppressed: [],
  snoozed: {},
  generationIntervalMs: 0,
  attentionCooldownMs: 0,
})
function fixture({ restored, generateHook, ownerConfig = config(), injectedSource, saveOwnerConfig = async () => {} } = {}) {
  let active = true,
    valid = true,
    epoch = 1,
    generations = 0,
    reads = 0,
    writes = []
  const r = {
    id: 'private-source-' + event,
    privateSourceId: 'mailbox',
    privateEventKey: event,
    goal: 'Review software release messages and propose the next owner step.',
    delivery: 'immediate',
    urgent: false,
    observations: [
      {
        readingId: 'private.mailbox.' + event,
        fields: ['subject'],
        measuredAtField: 'asOf',
      },
    ],
    actions: [
      {
        id: 'review',
        label: '查看通知并确认下一步',
        tool: 'private_source_review',
        params: { sourceId: 'mailbox', handle: event },
      },
    ],
  }
  const snapshot = () => ({
    sourceId: 'mailbox',
    connectorId: 'mailbox',
    connectorRevision: 'b'.repeat(64),
    epoch,
    accountKey: 'c'.repeat(64),
    bindingKey: 'd'.repeat(64),
    eventKey: event,
    handle: event,
    observedAt: stamp,
  })
  const source = injectedSource ?? {
    prepare: async () => {},
    rules: () => (active ? [structuredClone(r)] : []),
    evidence: async () =>
      valid
        ? [
            {
              readingId: r.observations[0].readingId,
              field: 'subject',
              value: 'Release notice',
              measuredAt: stamp,
              state: 'live',
              ruleId: r.id,
            },
          ]
        : null,
    snapshot: () => snapshot(),
    valid: (s) => active && valid && s.epoch === epoch,
    validate: async (s) => active && valid && s.epoch === epoch,
    canExecuteReview: () => active && valid,
    executeReview: async (_a, c) => {
      reads++
      assert.equal(c.isCurrent(), true)
      return {
        outcome: 'completed',
        text: 'Read-only review completed',
        receipt: { readOnly: true },
      }
    },
    close: async () => {},
  }
  const watch = new ProactiveWatch({
    config: ownerConfig,
    privateSources: source,
    now: () => now,
    read: async () => {
      throw Error('Private source must not enter DeskData')
    },
    save: saveOwnerConfig,
    publish: () => {},
    phrase: async ({ advice }) => advice,
    execute: async () => {
      throw Error('Private review must not use an interactive runtime')
    },
    canExecute: () => false,
    saveState: (s) => writes.push(structuredClone(s)),
    loadState: () => restored ?? { version: 1, proposals: [] },
    generate: async ({ topics }) => {
      generations++
      assert(topics.every(topic => !Object.hasOwn(topic, 'sourceSnapshot')))
      await generateHook?.()
      return {
        suggestions: topics.map((t) => ({
          topicId: t.id,
          key: 'model-key-' + generations,
          advice: '先确认这次发布是否由本人操作，确认后再准备宣传材料。',
          actionId: 'review',
          evidenceIds: t.evidence.map((e) => e.id),
        })),
      }
    },
    judge: async ({ candidates }) => ({
      model: 'jev-fixture',
      answers: Object.fromEntries(
        candidates.map((c) => [
          c.id,
          { probability: 0.99, groundingProbability: 0.99, threshold: 0.8 },
        ]),
      ),
    }),
  })
  return {
    watch,
    source,
    active: (x) => {
      active = x
    },
    valid: (x) => {
      valid = x
    },
    rotate: () => {
      epoch++
    },
    writes: () => writes,
    reads: () => reads,
    generations: () => generations,
  }
}
test('private source review completes without writing dynamic cooldowns to owner configuration', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'private-review-owner-')))
  await chmod(directory, 0o700)
  const file = join(directory, 'owner.json')
  await writeFile(file, JSON.stringify(config()), { mode: 0o600 })
  const before = await readFile(file, 'utf8')
  const ownerConfig = loadProactiveConfig(file)
  const save = ownerConfigWriter(file, ownerConfig)
  let ownerSaves = 0
  const f = fixture({ ownerConfig, saveOwnerConfig: async value => { ownerSaves++; await save(value) } })
  try {
    await f.watch.tick()
    assert.equal(f.watch.list().length, 1)
    const p = f.watch.list()[0]
    assert.equal(p.privateData, true)
    assert.equal(p.sourceSnapshot.eventKey, event)
    assert.equal(p.action.tool, 'private_source_review')
    assert.equal(f.reads(), 0)
    await f.watch.presented([p.id])
    const completed = await f.watch.respond(p.id, 'accept', p.confirmation)
    assert.equal(f.reads(), 1)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.result, 'Read-only review completed')
    assert.equal(ownerSaves, 0)
    assert.equal(await readFile(file, 'utf8'), before)
    const checkpoint = f.writes().at(-1)
    assert.equal(checkpoint.privateHandledEvents.length, 1)
    const restarted = fixture({ restored: checkpoint, ownerConfig })
    try {
      await restarted.watch.tick()
      assert.equal(restarted.watch.list().filter(item => item.status === 'pending').length, 0)
      assert.equal(restarted.reads(), 0)
    } finally { await restarted.watch.close() }
  } finally {
    await f.watch.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('owner cooldown validation still permits declared rules and rejects unknown or private dynamic rules', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'private-review-cooldown-')))
  await chmod(directory, 0o700)
  try {
    const initial = { ...config(), rules: [{ id: 'owner-rule', goal: 'Review fixture readings.', delivery: 'immediate', urgent: false,
      observations: [{ readingId: 'fixture.reading', fields: ['value'] }] }] }
    const file = join(directory, 'owner.json')
    await writeFile(file, JSON.stringify(initial), { mode: 0o600 })
    const selected = loadProactiveConfig(file)
    await ownerConfigWriter(file, selected)({ ...selected, snoozed: { 'owner-rule': now + 60000 } })
    assert.equal(loadProactiveConfig(file).snoozed['owner-rule'], now + 60000)
    for (const id of ['foreign-rule', 'private-source-' + event]) {
      assert.throws(() => validateOwnerConfig({ ...selected, snoozed: { [id]: now + 60000 } }), /Invalid proactive owner configuration/)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('handled private event survives revision rotation, temporary removal and model paraphrase', async () => {
  const f = fixture()
  try {
    await f.watch.tick()
    const p = f.watch.list()[0]
    assert.ok(p)
    await f.watch.presented([p.id])
    await f.watch.respond(p.id, 'irrelevant')
    assert.equal(f.watch.privateHandledEvents.size, 1)
    f.active(false)
    await f.watch.tick()
    f.watch.persist()
    f.active(true)
    f.rotate()
    await f.watch.tick()
    assert.equal(f.watch.list().filter((p) => p.status === 'pending').length, 0)
    assert.equal(f.reads(), 0)
    const restored = structuredClone(f.writes().at(-1))
    const g = fixture({ restored })
    try {
      await g.watch.tick()
      assert.equal(
        g.watch.list().filter((p) => p.status === 'pending').length,
        0,
      )
    } finally {
      await g.watch.close()
    }
  } finally {
    await f.watch.close()
  }
})
test('withdrawal while generation awaits prevents private publication', async () => {
  let f
  f = fixture({
    generateHook: async () => {
      f.valid(false)
    },
  })
  try {
    await f.watch.tick()
    assert.equal(f.watch.list().length, 0)
  } finally {
    await f.watch.close()
  }
})
test('revision withdrawal before review expires the action without dispatch', async () => {
  const f = fixture()
  try {
    await f.watch.tick()
    const p = f.watch.list()[0]
    assert.ok(p)
    await f.watch.presented([p.id])
    f.valid(false)
    await assert.rejects(f.watch.respond(p.id, 'accept', p.confirmation))
    assert.equal(f.reads(), 0)
  } finally {
    await f.watch.close()
  }
})
import { createPrivateProposalSources } from '../src/private-proposal-sources.mjs'
import { createProposalTools } from '../src/proactive-tools.mjs'
import { proposalStateStore } from '../src/proactive-state.mjs'
import { mkdtemp, chmod, rm, realpath, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('proposal queries and failed responses taint before private data or errors return', async () => {
  let tainted = 0
  const watch = {
    privateSources: {},
    list: () => [{ id: 'p', privateData: true }],
    readProposals: async () => {
      throw Error('Source unavailable')
    },
  }
  const tools = createProposalTools(
    () => watch,
    () => '',
    {
      onPrivateData: () => {
        tainted++
      },
    },
  )
  await assert.rejects(
    tools.find((t) => t.name === 'personal_agent_proposals').execute('test', {}),
  )
  assert.equal(tainted, 1)
  await assert.rejects(
    tools
      .find((t) => t.name === 'personal_agent_proposal_respond')
      .execute('test', { id: 'p', decision: 'useful' }),
  )
  assert.equal(tainted, 2)
})
test('private checkpoint persists bounded hash receipts and rejects missing provenance', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'private-proposal-checkpoint-')),
  )
  await chmod(dir, 0o700)
  try {
    const state = proposalStateStore(join(dir, 'state.json'))
    state.save({
      version: 1,
      proposals: [],
      privateHandledEvents: ['a'.repeat(64)],
    })
    assert.deepEqual(state.load().privateHandledEvents, ['a'.repeat(64)])
    assert.throws(() =>
      state.save({
        version: 1,
        proposals: [],
        privateHandledEvents: ['mail address'],
      }),
    )
    assert.throws(() =>
      state.save({
        version: 1,
        proposals: [],
        privateHandledEvents: Array.from({ length: 1025 }, (_, i) =>
          i.toString(16).padStart(64, '0'),
        ),
      }),
    )
  } finally {
    await rm(dir, { recursive: true })
  }
})
test('source adapter binds revision only as provenance and dispatches actual readonly source review', async () => {
  let valid = true,
    reviews = 0
  const snap = {
    sourceId: 'mailbox',
    connectorId: 'mailbox',
    connectorRevision: 'b'.repeat(64),
    epoch: 1,
    accountKey: 'c'.repeat(64),
    bindingKey: 'd'.repeat(64),
    eventKey: event,
    handle: event,
    observedAt: stamp,
  }
  const provenance = {
    ownerOnly: true,
    privateData: true,
    untrusted: true,
    learningEligible: false,
  }
  const eventValue = {
    provenance,
    eventKey: event,
    sourceSnapshot: snap,
    reviewAction: {
      kind: 'private-source-review',
      sourceId: 'mailbox',
      handle: event,
    },
    reading: {
      id: 'private.mailbox.' + event,
      state: 'live',
      value: {
        subject: 'Release notice',
        body0: 'Untrusted mail text',
        bodyTruncated: false,
        receivedAt: stamp,
        asOf: stamp,
      },
    },
  }
  const source = {
    observe: async () => ({ state: 'live', events: [eventValue], provenance }),
    knowsReview: () => true,
    validateSnapshot: async () => valid,
    canExecuteReview: async () => valid,
    executeReview: async () => {
      reviews++
      return {
        state: 'live',
        readonly: true,
        reviewed: true,
        eventKey: event,
        value: { subject: 'Release notice', body: 'Untrusted mail text' },
        sourceSnapshot: snap,
        provenance: {
          ownerOnly: true,
          privateData: true,
          untrusted: true,
          learningEligible: false,
        },
      }
    },
    close: async () => {},
  }
  const port = createPrivateProposalSources([
    {
      id: 'mailbox',
      goal: 'Recommend the next step for owner mail.',
      label: '查看通知并确认下一步',
      source,
    },
  ])
  try {
    await port.prepare()
    const [rule] = port.rules()
    assert.ok(rule)
    assert(!JSON.stringify(rule).includes(snap.connectorRevision))
    assert(!JSON.stringify(rule).includes('epoch'))
    assert(!rule.observations[0].fields.includes('asOf'))
    assert.equal(port.canExecuteReview(rule.actions[0].params), true)
    const result = await port.executeReview(rule.actions[0].params, {
      sourceSnapshot: snap,
      isCurrent: () => true,
    })
    assert.equal(reviews, 1)
    assert.equal(result.outcome, 'completed')
    valid = false
    assert.equal(await port.validate(snap), false)
    assert.equal(port.rules().length, 0)
    assert.equal(port.valid(snap), false)
    assert.equal(port.canExecuteReview(rule.actions[0].params), false)
  } finally {
    await port.close()
  }
})

test('private review remains usable with an existing version-one owner configuration', async () => {
  const f = fixture({
    ownerConfig: {
      version: 1,
      pollMs: 60000,
      maxAgeMs: 300000,
      cooldownMs: 60000,
      rules: [],
      suppressed: [],
      snoozed: {},
    },
  })
  try {
    await f.watch.tick()
    const [p] = f.watch.list()
    assert.ok(p)
    await f.watch.presented([p.id])
    await f.watch.respond(p.id, 'accept', p.confirmation)
    assert.equal(f.reads(), 1)
  } finally {
    await f.watch.close()
  }
})

// Offline provider double exercises the real Gmail source and application-owned port.
import { createGmailRecommendationSource } from '../src/gmail-recommendation-source.mjs'
import { createPrivateProposalSources as createPrivatePort } from '../src/private-proposal-sources.mjs'
test('same Gmail event refresh keeps one presented recommendation executable', async () => {
  let measuredAt = now - 1000, revision = 'b'.repeat(64), epoch = 1, body = 'A software release was reported.'
  const observer = {
    enabled: true,
    get epoch() { return epoch },
    isCurrent: async s => s.connectorRevision === revision && s.epoch === epoch,
    run: async fn => ({ value: await fn({
      connectorRevision: revision, epoch,
      schema: () => ({ properties: { expectedAccountKey: { type: 'string', pattern: '^[a-f0-9]{64}$' } } }),
      call: async (name, args) => ({ structuredContent: name === 'gmail_status'
        ? { state: 'connected', emailAddress: 'owner@example.invalid' }
        : name === 'gmail_search'
          ? { messages: [{ id: 'synthetic-release-1' }], untrusted: true }
          : { id: args.id, subject: 'Release notice', body, truncated: false, untrusted: true, internalDate: String(now - 2000) } })
    }), connectorRevision: revision, epoch }),
    close: async () => {},
  }
  const source = createGmailRecommendationSource({ observer, now: () => measuredAt })
  const port = createPrivatePort([{ id: 'gmail', label: 'Review notice', goal: 'Review software release notices and suggest the next owner step.', source }])
  const f = fixture({ injectedSource: port, ownerConfig: { ...config(), generationIntervalMs: 60000 } })
  try {
    await f.watch.tick()
    const first = f.watch.list()[0]
    assert.ok(first)
    await f.watch.presented([first.id])
    const generationCount = f.generations()
    measuredAt += 1000
    await f.watch.tick()
    const same = f.watch.list()[0]
    assert.equal(f.watch.list().length, 1)
    assert.equal(same.id, first.id)
    assert.equal(same.status, 'pending')
    assert.equal(same.presented, true)
    assert.equal(f.generations(), generationCount)
    assert.deepEqual(same.sourceSnapshot, first.sourceSnapshot)
    assert.equal(same.evidence.every(e => e.measuredAt === new Date(measuredAt).toISOString()), true)
    body = 'The release notice was corrected.'
    await f.watch.tick()
    const replacement = f.watch.list().find(p => p.status === 'pending')
    assert.ok(replacement)
    assert.notEqual(replacement.id, first.id)
    assert.equal(f.watch.list().find(p => p.id === first.id).status, 'expired')
    await assert.rejects(f.watch.respond(first.id, 'accept', same.confirmation))
    await f.watch.presented([replacement.id])
    await f.watch.respond(replacement.id, 'accept', replacement.confirmation)
    assert.equal(f.watch.list().find(p => p.id === replacement.id).status, 'completed')
  } finally { await f.watch.close() }
})

test('private snapshot identifiers require strings rather than regular-expression coercion', async () => {
  const { validPrivateSourceSnapshot } = await import('../src/private-proposal-sources.mjs')
  const snapshot = { sourceId: 'gmail', connectorId: 'gmail', connectorRevision: 'a'.repeat(64), epoch: 1,
    accountKey: 'b'.repeat(64), bindingKey: 'c'.repeat(64), eventKey: event, handle: event, observedAt: stamp }
  assert.equal(validPrivateSourceSnapshot(snapshot), true)
  for (const field of ['sourceId', 'connectorId']) {
    for (const invalid of [12, null, undefined]) assert.equal(validPrivateSourceSnapshot({ ...snapshot, [field]: invalid }), false)
  }
})
