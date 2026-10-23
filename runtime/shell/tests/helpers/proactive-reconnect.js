'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { integrationURL } = require('./repo-root')

async function until(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

/** Actual channel/client/Watch; only the observation and inference responses are fixtures. */
async function createProactiveReconnectFixture(options = {}) {
  const [{ PersonalBotService }, { ProactiveWatch }, { proposalStateStore }, { listen }] = await Promise.all([
    import(integrationURL('personal-bot/src/service.mjs')),
    import(integrationURL('personal-bot/src/proactive.mjs')),
    import(integrationURL('personal-bot/src/proactive-state.mjs')),
    import(integrationURL('personal-bot/src/socket.mjs')),
  ])
  const { createPersonalBotClient } = require('../../src/personal-bot-client')
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'odk-reconnect-channel-')))
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\odk-reconnect-fixture-${process.pid}` : path.join(directory, 'personal-bot.sock')
  const token = 'synthetic-reconnect-fixture-token-not-a-credential'
  const checkpoint = options.checkpoint ?? proposalStateStore(path.join(directory, 'checkpoint', 'proposals.json'))
  const measuredAt = new Date().toISOString()
  const forbidden = async () => { throw Error('Reconnect fixture forbids owner turns, recording, models and execution') }
  const service = new PersonalBotService({ record: forbidden, transcribe: forbidden, prompt: forbidden })
  const received = []
  const proposalCommand = service.proposalCommand.bind(service)
  service.proposalCommand = async command => { received.push(structuredClone(command)); return proposalCommand(command) }
  let generations = 0, judgments = 0
  const watch = options.createWatch ? await options.createWatch({ service, checkpoint }) : new ProactiveWatch({
    config: { version: 2, pollMs: 3600000, maxAgeMs: 300000, cooldownMs: 60000,
      maxCandidates: 1, maxPush: 1, maxGenerationCalls: 1, generationIntervalMs: 3600000, attentionCooldownMs: 60000,
      suppressed: [], snoozed: {}, rules: [{ id: 'reconnect-fixture', delivery: 'immediate', urgent: false,
        goal: 'Inspect the synthetic reconnect fixture.', observations: [{ readingId: 'fixture.reconnect', fields: ['status'] }] }] },
    loadState: checkpoint.load, saveState: checkpoint.save,
    read: async () => ({ id: 'fixture.reconnect', label: 'Synthetic reconnect fixture', state: 'live', value: { status: 'Unread fixture note', measured_at: measuredAt } }),
    generate: async ({ topics }) => {
      return { suggestions: topics.map(topic => ({ topicId: topic.id, key: 'inspect-reconnect-fixture',
        advice: 'Synthetic fixture: inspect the reconnect test note.', nextStep: 'Read the recovered fixture note, then mark this suggestion done.', evidenceIds: [topic.evidence[0].id] })) }
    },
    judge: async ({ candidates }) => {
      return { model: 'jev-reconnect-fixture', answers: Object.fromEntries(candidates.map(candidate => [candidate.id, { probability: 1, groundingProbability: 1, threshold: 0.8 }])) }
    },
    phrase: forbidden, execute: forbidden, save: async () => {}, publish: frame => service.propose(frame),
  })
  for (const [name, count] of [['generate', () => generations++], ['judge', () => judgments++]]) {
    const original = watch[name]
    assert.equal(typeof original, 'function', `Watch must expose ${name}`)
    watch[name] = function (...args) { count(); return original.apply(this, args) }
  }
  service.attachWatch(watch)
  service.setState('idle')
  let listener = await listen(endpoint, service, { token })
  const client = createPersonalBotClient({ socketPath: endpoint, token, reconnectDelayMs: 25 })
  const cleanups = []
  let channel
  async function disconnect() {
    await listener.close(); listener = undefined
    await until(() => client.snapshot().state === 'unavailable', 'The real client must observe transport loss')
  }
  async function reconnect() {
    listener = await listen(endpoint, service, { token })
    await until(() => client.snapshot().state === 'idle', 'The real client must reconnect to the restored listener')
  }
  return {
    client,
    bindMain(ipcMain, win) {
      const { createSystemChannelPlugins } = require('../../src/plugins/system-channels')
      const plugin = createSystemChannelPlugins().find(definition => definition.manifest.id === 'odk.system.personal-bot')
      const capabilities = {
        ipc: ipcMain,
        broadcast: (name, frame) => { if (!win.isDestroyed()) win.webContents.send(name, frame) },
        'system.personal-bot': { options: {}, create: () => client, smokeMode: false,
          isConsumerFrame: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame },
      }
      channel = plugin.create({ capability: name => capabilities[name], onCleanup: callback => cleanups.push(callback), signal: new AbortController().signal })
    },
    async verify(win, evaluate) {
      channel.start()
      await until(() => client.snapshot().state === 'idle', 'Initial resident channel must be connected')
      await disconnect()
      await until(() => evaluate(`document.querySelectorAll('.personal-bot-proposal').length === 0`), 'Disconnected renderer must clear suggestions')
      // No listener exists: the initial popup cannot reach the renderer.
      await watch.tick()
      const qualified = watch.list()
      assert.equal(qualified.length, 1, 'Offline generation must qualify exactly one suggestion')
      const proposal = qualified[0]
      await options.onQualified?.(proposal, qualified)
      assert.ok(proposal, 'Offline generation must produce one supported fixture suggestion')
      assert.equal(proposal.offered, true); assert.equal(proposal.presented, false)
      const id = proposal.id
      assert.equal(received.filter(command => command.type === 'proposal_presented').length, 0)
      await reconnect()
      await until(() => evaluate(`(() => { const surface = document.getElementById('personal-bot-status'); const advice = document.querySelector('.personal-bot-proposal-advice'); return !surface.hidden && !!advice?.checkVisibility() && advice.textContent === ${JSON.stringify(proposal.advice)} && advice.closest('[data-proposal-id]')?.dataset.proposalId === ${JSON.stringify(id)} })()`),
        'Reconnected unread advice must become naturally visible without an explicit list request')
      await until(() => watch.list()[0].presented, 'Only renderer viewport visibility may acknowledge the recovered advice')
      assert.ok(received.some(command => command.type === 'proposal_presented' && command.ids.includes(id)))
      assert.equal(checkpoint.load().proposals[0].presented, true)
      const click = async label => {
        await evaluate(`(() => { const details = document.querySelector('.personal-bot-proposal-feedback-options'); if (details) details.open = true; const button = [...document.querySelectorAll('.personal-bot-proposals button')].find(node => node.textContent === ${JSON.stringify(label)}); if (!button) throw Error('Missing feedback control'); button.scrollIntoView({block:'center'}); button.click() })()`)
      }
      await click('Useful')
      await until(() => checkpoint.load().proposals[0].feedback === 'useful', 'Useful must reach the original durable proposal')
      await click('Later')
      await until(() => checkpoint.load().proposals[0].feedback === 'snooze', 'Later must persist on the same proposal')
      const due = watch.list()[0].snoozedUntil
      assert.ok(due > Date.now() + 59000, 'Later retains the full production minute')
      assert.equal(watch.list()[0].id, id); assert.equal(watch.list()[0].presented, false)
      // Real elapsed time, no fixture clock change, timer emit, list or synthetic acknowledgement.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, due - Date.now()) + 50))
      await disconnect(); await reconnect()
      await until(() => watch.list()[0].presented, 'An expired snooze must recover through the actual renderer after reconnect')
      await click('Done')
      await until(() => checkpoint.load().proposals[0].status === 'completed', 'Done must persist owner feedback without executing any action')
      assert.equal(checkpoint.load().proposals[0].id, id)
      assert.equal(checkpoint.load().proposals[0].feedback, 'done')
      assert.equal(generations, 1); assert.equal(judgments, 1)
      assert.equal(received.some(command => command.type === 'proposal_list'), false, 'The test must not mask recovery with an explicit list request')
      assert.deepEqual(received.filter(command => command.type === 'proposal_respond').map(command => [command.id, command.decision]), [[id, 'useful'], [id, 'snooze'], [id, 'done']])
      console.log(`PROACTIVE_RECONNECT_E2E_PASS: real renderer/client/socket/service/Watch, offline generation, natural visible receipt, same UUID Useful/Later/Done; ${options.createWatch ? 'injected inference adapter' : 'synthetic inference, zero models'}`)
    },
    async close() {
      for (const cleanup of cleanups.reverse()) await cleanup()
      client.stop()
      if (listener) await listener.close()
      await watch.close(); await service.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

module.exports = { createProactiveReconnectFixture }
