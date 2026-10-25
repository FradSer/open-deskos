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
  const memoryFile = path.join(directory, 'memory', 'notes.json')
  const [{ createMemoryStore }, { createPersonalTools }] = await Promise.all([import(integrationURL('personal-bot/src/memory.mjs')), import(integrationURL('personal-bot/src/personal-tools.mjs'))])
  const memory = createMemoryStore(memoryFile)
  const memoryTool = createPersonalTools({ memory, skillPaths: [] }).find(tool => tool.name === 'memory_update')
  const action = { id: 'save-reconnect-note', label: 'Save reconnect test note', tool: 'memory_update', params: { category: 'reconnect', value: 'The recovered suggestion was confirmed.' } }
  let executions = 0
  const forbidden = async () => { throw Error('Reconnect fixture forbids owner turns, recording, models and execution') }
  const service = new PersonalBotService({ record: forbidden, transcribe: forbidden, prompt: forbidden })
  const received = [], completedFeedback = [], committedUseful = []
  let releaseLearning, learningReleased = false, learningCalls = 0
  const learningGate = new Promise(resolve => { releaseLearning = () => { learningReleased = true; resolve() } })
  const proposalCommand = service.proposalCommand.bind(service)
  service.proposalCommand = async command => {
    received.push(structuredClone(command))
    const result = await proposalCommand(command)
    if (command.type === 'proposal_respond') completedFeedback.push(structuredClone(command))
    return result
  }
  let generations = 0, judgments = 0
  const watch = options.createWatch ? await options.createWatch({ service, checkpoint }) : new ProactiveWatch({
    config: { version: 2, pollMs: 3600000, maxAgeMs: 300000, cooldownMs: 60000,
      maxCandidates: 1, maxPush: 1, maxGenerationCalls: 1, generationIntervalMs: 3600000, attentionCooldownMs: 60000,
      suppressed: [], snoozed: {}, rules: [{ id: 'reconnect-fixture', delivery: 'immediate', urgent: false,
        goal: 'Save the synthetic reconnect fixture note.', actions: [action], observations: [{ readingId: 'fixture.reconnect', fields: ['status'] }] }] },
    loadState: checkpoint.load,
    saveState: state => {
      checkpoint.save(state)
      if (state.feedbackMemory?.jobs.some(job => job.decision === 'useful' && job.status === 'queued')) committedUseful.push(checkpoint.load())
    },
    feedbackMemoryEnabled: true,
    refineFeedbackMemory: async input => {
      learningCalls++
      assert.equal(input.signal.aborted, false)
      if (input.feedback.decision === 'useful') await learningGate
      const dimension = { useful: 'utility', snooze: 'timing', done: 'completion' }[input.feedback.decision]
      assert.ok(dimension, 'The deterministic learning port accepts only the actual fixture decisions')
      return { subject: 'recovered suggestion', dimension }
    },
    read: async () => ({ id: 'fixture.reconnect', label: 'Synthetic reconnect fixture', state: 'live', value: { status: 'Unread fixture note', measured_at: measuredAt } }),
    generate: async ({ topics }) => {
      return { suggestions: topics.map(topic => ({ topicId: topic.id, key: 'inspect-reconnect-fixture',
        advice: 'Synthetic fixture: save a note confirming this recovered suggestion.', actionId: action.id, evidenceIds: [topic.evidence[0].id] })) }
    },
    judge: async ({ candidates }) => {
      return { model: 'jev-reconnect-fixture', answers: Object.fromEntries(candidates.map(candidate => [candidate.id, { probability: 1, groundingProbability: 1, threshold: 0.8 }])) }
    },
    phrase: forbidden, canExecute: candidate => candidate.tool === memoryTool.name,
    execute: async (name, params, confirmation) => {
      assert.equal(name, memoryTool.name)
      assert.equal(confirmation, `记住 ${params.category}：${params.value}`)
      executions++
      memory.beginTurn(confirmation)
      try {
        const result = await memoryTool.execute('reconnect-fixture-execution', params)
        assert.equal(JSON.parse(await memory.read())[params.category], params.value)
        return { outcome: 'completed', text: result.content[0].text, receipt: { category: params.category } }
      } finally { memory.beginTurn('') }
    }, save: async () => {}, publish: frame => service.propose(frame),
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
      await evaluate(`(() => { const composer = document.querySelector('.agent-composer'); if (composer.dataset.mode !== 'keyboard') composer.querySelector('.agent-keys').click(); const input = composer.querySelector('textarea'); input.value = 'Keep reconnect draft.'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus() })()`)
      await disconnect()
      await until(() => evaluate(`document.querySelectorAll('.personal-bot-proposal').length === 0`), 'Disconnected renderer must clear suggestions')
      // No listener exists: the generated recommendation cannot reach the renderer.
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
      await until(() => evaluate(`(() => { const surface = document.querySelector('.agent-suggestions'); const advice = document.querySelector('.personal-bot-proposal-advice'); return !!surface && !surface.hidden && !!surface.closest('.agent-composer') && document.getElementById('personal-bot-status').hidden && !document.querySelector('.personal-bot-proposal-sources, .personal-bot-ride-details') && !!advice?.checkVisibility() && advice.textContent === ${JSON.stringify(proposal.advice)} && advice.closest('[data-proposal-id]')?.dataset.proposalId === ${JSON.stringify(id)} })()`),
        'Reconnected unread advice must become naturally visible without an explicit list request')
      assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), 'Keep reconnect draft.')
      assert.equal(await evaluate(`document.activeElement === document.querySelector('.agent-composer textarea')`), true, 'Reconnect cannot steal the existing draft focus')
      await until(() => watch.list()[0].presented, 'Only renderer viewport visibility may acknowledge the recovered advice')
      assert.ok(received.some(command => command.type === 'proposal_presented' && command.ids.includes(id)))
      assert.equal(checkpoint.load().proposals[0].presented, true)
      const click = async label => {
        await evaluate(`(() => { const details = document.querySelector('.personal-bot-proposal-feedback-options'); if (details) details.open = true; const button = [...document.querySelectorAll('.personal-bot-proposals button')].find(node => node.textContent === ${JSON.stringify(label)}); if (!button) throw Error('Missing feedback control'); button.scrollIntoView({block:'center'}); button.click() })()`)
      }
      if (!options.createWatch) {
        await click('Useful')
        await until(() => completedFeedback.some(command => command.id === id && command.decision === 'useful'), 'Useful must complete through the actual resident socket before learning resolves')
        await until(() => learningCalls === 1, 'Committed feedback must start its asynchronous learning port')
        assert.equal(learningReleased, false, 'The learner remains gated after the durable feedback receipt')
        assert.equal(executions, 0, 'Useful must never execute the recommendation action')
        assert.ok(committedUseful.some(state => state.proposals[0].id === id && state.proposals[0].feedback === 'useful' && state.proposals[0].feedbackLearning.status === 'queued'), 'The actual checkpoint must contain queued feedback before refinement')
        const running = checkpoint.load()
        assert.equal(running.proposals[0].feedback, 'useful')
        assert.equal(running.feedbackMemory.jobs[0].proposalId, id)
        assert.equal(running.feedbackMemory.jobs[0].status, 'running')
        assert.deepEqual(running.feedbackMemory.entries, [])
        await until(() => evaluate(`document.querySelector('.personal-bot-proposal-memory')?.textContent === 'Feedback saved. Updating related memory…'`), 'The renderer must show saved feedback while related memory is pending')
        assert.equal(await evaluate(`(() => { const input = document.querySelector('.agent-composer textarea'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); return input.checkVisibility() && !input.disabled })()`), true)
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' })
        await until(() => evaluate(`document.querySelector('.agent-composer textarea').value === 'Keep reconnect draft.x'`), 'The ordinary composer must accept actual keyboard input while learning is pending')
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
        await until(() => evaluate(`document.querySelector('.agent-composer textarea').value === 'Keep reconnect draft.'`), 'Pending learning must retain editable draft controls')
        releaseLearning()
        await until(() => checkpoint.load().proposals[0].feedbackLearning.status === 'applied', 'Related memory must apply through the actual persisted learning outbox')
        const applied = checkpoint.load()
        assert.deepEqual(applied.feedbackMemory.jobs, [])
        assert.equal(applied.feedbackMemory.entries[0].ruleId, proposal.ruleId)
        assert.deepEqual(applied.feedbackMemory.entries[0].signals.map(({ decision, dimension, subject }) => ({ decision, dimension, subject })), [{ decision: 'useful', dimension: 'utility', subject: 'recovered suggestion' }])
        if (!options.checkpoint) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'checkpoint', 'proposals.json'), 'utf8')).feedbackMemory, applied.feedbackMemory)
        await until(() => evaluate(`document.querySelector('.personal-bot-proposal-memory')?.textContent === 'Feedback saved. Related memory updated.'`), 'Applied derived memory must be visible on the original inline card')
        assert.equal(learningCalls, 1)
      } else if (!proposal.action) {
        await click('Useful')
        await until(() => checkpoint.load().proposals[0].feedback === 'useful', 'Useful must reach the original durable proposal')
      }
      await click('Later')
      await until(() => checkpoint.load().proposals[0].feedback === 'snooze', 'Later must persist on the same proposal')
      const due = watch.list()[0].snoozedUntil
      assert.ok(due > Date.now() + 59000, 'Later retains the full production minute')
      assert.equal(watch.list()[0].id, id); assert.equal(watch.list()[0].presented, false)
      // Real elapsed time, no fixture clock change, timer emit, list or synthetic acknowledgement.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, due - Date.now()) + 50))
      await disconnect(); await reconnect()
      await until(() => watch.list()[0].presented, 'An expired snooze must recover through the actual renderer after reconnect')
      if (proposal.action) {
        assert.equal(executions, 0, 'Snooze and recovery must not execute the authorized action')
        await click(proposal.nextStep)
        assert.equal(executions, 0, 'The concrete action button only opens exact confirmation')
        await evaluate(`(() => { const button = [...document.querySelectorAll('.personal-bot-proposals button')].find(node => node.textContent === ${JSON.stringify(proposal.confirmation)}); if (!button) throw Error('Missing exact confirmation'); button.click(); button.click() })()`)
        await until(() => checkpoint.load().proposals[0].status === 'completed', 'Confirmed action must complete through the real plugin')
        assert.equal(executions, options.createWatch ? 0 : 1, 'Repeated confirmation executes the default memory plugin only once')
        if (!options.createWatch) {
          assert.equal(JSON.parse(fs.readFileSync(memoryFile, 'utf8')).reconnect, action.params.value)
          assert.equal(JSON.parse(await memory.read()).reconnect, action.params.value)
        }
        await until(() => evaluate(`![...document.querySelectorAll('.personal-bot-proposals button')].some(node => [${JSON.stringify(proposal.nextStep)}, ${JSON.stringify(proposal.confirmation)}].includes(node.textContent))`), 'Authoritative completion removes execution controls')
      } else {
        await click('Done')
        await until(() => checkpoint.load().proposals[0].status === 'completed', 'Done must persist historical feedback without executing any action')
        assert.equal(checkpoint.load().proposals[0].feedback, 'done')
      }
      assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), 'Keep reconnect draft.')
      assert.equal(await evaluate(`document.getElementById('personal-bot-status').hidden`), true, 'Reminder and execution remain inside the composer')
      assert.equal(checkpoint.load().proposals[0].id, id)
      assert.equal(generations, 1); assert.equal(judgments, 1)
      assert.equal(received.some(command => command.type === 'proposal_list'), false, 'The test must not mask recovery with an explicit list request')
      assert.deepEqual(received.filter(command => command.type === 'proposal_respond').map(command => [command.id, command.decision]), proposal.action ? [...(!options.createWatch ? [[id, 'useful']] : []), [id, 'snooze'], [id, 'accept']] : [[id, 'useful'], [id, 'snooze'], [id, 'done']])
      console.log(`PROACTIVE_RECONNECT_E2E_PASS: real renderer/client/socket/service/Watch, offline generation, natural visible receipt, same UUID ${proposal.action ? 'Later/exact confirmation/plugin execution/readback' : 'legacy Useful/Later/Done'}; ${options.createWatch ? 'injected inference adapter' : 'synthetic inference and deterministic gated feedback-memory port, zero models'}`)
    },
    async close() {
      releaseLearning()
      for (const cleanup of cleanups.reverse()) await cleanup()
      client.stop()
      if (listener) await listener.close()
      await watch.close(); await service.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

module.exports = { createProactiveReconnectFixture }
