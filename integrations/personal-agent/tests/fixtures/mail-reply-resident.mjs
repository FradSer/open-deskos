// Real selected model and resident with one synthetic invitation at the Gmail read boundary.
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createPersonalAgent } from '../../src/agent.mjs'
import { createGmailRecommendationSource } from '../../src/recommendations/index.mjs'
import { createPrivateProposalSources } from '../../src/recommendations/index.mjs'
import { createConversationProjection } from '../../src/conversation-projection.mjs'
import { ProactiveWatch } from '../../src/recommendations/index.mjs'
import { defaultProactiveConfig } from '../../src/recommendations/index.mjs'
import { proposalStateStore } from '../../src/recommendations/index.mjs'
import { PersonalAgentService } from '../../src/service.mjs'
import { listen } from '../../src/socket.mjs'

const selectedModel = process.env.ODK_PERSONAL_AGENT_MODEL
if (!selectedModel?.includes('/')) throw Error('An explicitly selected real model is required')
const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-mail-reply-')))
const token = 'synthetic-mail-reply-' + randomUUID()
const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\odk-mail-reply-' + randomUUID() : join(directory, 'agent.sock')
const accountKey = createHash('sha256').update(JSON.stringify(['gmail-account', 'owner@example.test'])).digest('hex')
const revision = 'e'.repeat(64)
const sourceMode = 'synthetic invitation through Gmail adapter'
const receivedAt = String(Date.now())
const calls = []
let enabled = true, drafts = 0, generations = 0, watch, agent, service, server, conversation
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const forbidden = async () => assert.fail('The mail fixture cannot record, run owner tools, or write external state')
const observer = {
  get enabled() { return enabled }, epoch: 1,
  async isCurrent(snapshot) { return enabled && snapshot.connectorRevision === revision && snapshot.epoch === 1 },
  async run(operation, { signal } = {}) {
    signal?.throwIfAborted()
    assert(enabled)
    const context = { connectorRevision: revision, epoch: 1,
      schema: name => ['gmail_search', 'gmail_read'].includes(name) ? { properties: { expectedAccountKey: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } : {},
      async call(name, params = {}) {
        signal?.throwIfAborted()
        calls.push(name)
        if (name === 'gmail_status') return { structuredContent: { state: 'connected', emailAddress: 'owner@example.test' } }
        assert.equal(params.expectedAccountKey, accountKey)
        if (name === 'gmail_search') return { structuredContent: { untrusted: true, messages: [{ id: 'synthetic-interview' }] } }
        assert.equal(name, 'gmail_read', 'Only status/search/read are permitted')
        assert.equal(params.id, 'synthetic-interview')
        return { structuredContent: { id: params.id, untrusted: true, truncated: false, internalDate: receivedAt,
          subject: 'Interview invitation awaiting your reply',
          body: 'Hello, we would like to invite you to interview for a product design position. Please reply to confirm your interest and share your availability for a video interview. We have not received a reply. Thank you, the recruiting team.' } }
      },
    }
    const value = await operation(context)
    signal?.throwIfAborted()
    return { value, connectorRevision: revision, epoch: 1 }
  },
  async setEnabled(value) { enabled = value }, async invalidate() { enabled = false }, async close() { enabled = false },
}
function snapshot() {
  assert(calls.every(name => ['gmail_status', 'gmail_search', 'gmail_read'].includes(name)))
  assert.equal(conversation.snapshot().conversation.turns.length, 0, 'The unsent private draft entered public history')
  return { sourceMode, selectedModel, generationModel: agent.generationModel, generations, drafts,
    reads: calls.filter(name => name === 'gmail_read').length, mutations: 0, ownerConfigWrites: 0,
    ownerOnly: service.status.ownerOnly === true,
    draft: service.status.ownerOnly === true && service.status.state === 'idle' ? service.status.message : '',
    proposal: watch.list().map(({ id, status, action }) => ({ id, status, action })),
    publicTurns: conversation.snapshot().conversation.turns.length }
}
try {
  agent = await createPersonalAgent({ stateDir: join(directory, 'state'), model: selectedModel, env: process.env,
    personal: { profile: 'personal', skillPaths: [], memoryFile: join(directory, 'memory.json'), agentPlugins: { enabled: [], autoLearn: false } },
    getWatch: () => watch,
  })
  const source = createGmailRecommendationSource({ observer })
  const privateSources = createPrivateProposalSources([{ id: 'gmail', source,
    goal: 'The owner wants a useful next step for an unanswered interview invitation. If the observed mail invites the owner to interview and asks for a response, suggest preparing an unsent reply and select prepare_reply. Keep it concise and grounded. Do not claim a reply was sent or invent availability.',
    label: '查看邮件', replyLabel: '准备面试回复' }])
  service = new PersonalAgentService({ record: forbidden, transcribe: forbidden, prompt: forbidden,
    getJudgmentStatus: () => agent.judgmentStatus })
  const store = proposalStateStore(join(directory, 'proactive', 'state.json'))
  watch = new ProactiveWatch({ config: { ...defaultProactiveConfig(), maxCandidates: 1, maxPush: 1 }, privateSources,
    loadState: store.load, saveState: store.save, read: forbidden, save: forbidden, execute: forbidden,
    generate: async input => { generations++; return agent.generateProposals(input) },
    prepareReply: async input => { drafts++; return agent.prepareReply(input) }, publish: frame => service.propose(frame),
  })
  service.attachWatch(watch)
  service.setState('idle')
  conversation = await createConversationProjection({ file: join(directory, 'conversation.json') })
  service.subscribe(status => {
    conversation.observe(status)
    const busy = service.starting || !['idle', 'error'].includes(status.state)
    if (watch.busy !== busy) watch.setBusy(busy)
  })
  server = await listen(socketPath, service, { token, conversation })
  send({ type: 'ready', socketPath, token, selectedModel, sourceMode })
  for await (const line of createInterface({ input: process.stdin })) {
    const { requestId, type } = JSON.parse(line)
    try {
      if (type === 'tick') await watch.tick()
      else assert(['status', 'shutdown'].includes(type))
      send({ requestId, ok: true, ...snapshot() })
      if (type === 'shutdown') break
    } catch (error) { send({ requestId, ok: false, error: error.message }) }
  }
} finally {
  await server?.close()
  await service?.close()
  await watch?.close()
  await conversation?.close()
  await agent?.close()
  await rm(directory, { recursive: true, force: true })
}
