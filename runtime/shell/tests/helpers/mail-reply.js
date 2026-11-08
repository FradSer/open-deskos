'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { integrationPath } = require('./repo-root')
const { createPersonalAgentClient } = require('../../src/personal-agent-client')
const { createSystemChannelPlugins } = require('../../src/plugins/system-channels')
const { projectPersonalAgentFrame } = require('../../src/personal-agent-frame')
const { capturePaintedPage } = require('./native-page-capture')

async function verifyMailReply(ipc, win, evaluate) {
  const child = spawn(process.env.npm_node_execpath || process.env.ODK_TEST_NODE || 'node',
    [integrationPath('personal-agent/tests/fixtures/mail-reply-resident.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: child.stdout })
  const replies = new Map(), cleanups = []
  let ready, failure, client, primaryFailure, requestId = 0
  const startedAt = Date.now(), latencyMs = {}
  const exit = new Promise(resolve => child.once('close', code => {
    failure ??= Error('Mail reply resident exited with code ' + code)
    resolve()
  }))
  child.on('error', error => { failure = error })
  child.stdin.on('error', error => { failure = error })
  lines.on('line', line => {
    try {
      const item = JSON.parse(line)
      if (item.type === 'ready') ready = item
      else if (item.requestId !== undefined) replies.set(item.requestId, item)
    } catch { failure = Error('Mail reply resident emitted an invalid test response') }
  })
  async function wait(check, label, timeoutMs = 190000) {
    const deadline = Date.now() + timeoutMs
    do {
      if (failure) throw failure
      const value = await check()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 25))
    } while (Date.now() < deadline)
    throw Error('Timed out waiting for ' + label)
  }
  async function request(type) {
    const id = ++requestId
    child.stdin.write(JSON.stringify({ requestId: id, type }) + '\n')
    const result = await wait(() => replies.get(id), type)
    replies.delete(id)
    assert.equal(result.ok, true, JSON.stringify(result))
    return result
  }
  async function clickVisible(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', behavior: 'instant' })`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const point = await wait(() => evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)}), box = button?.getBoundingClientRect();
      if (!box || button.disabled || !button.checkVisibility() || box.width <= 0 || box.height <= 0) return null;
      const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
      const hit = document.elementFromPoint(x, y);
      return x > 0 && y > 0 && x < innerWidth && y < innerHeight && (hit === button || button.contains(hit)) ? {x, y} : null;
    })()`), 'visible unobstructed control: ' + selector, 10000)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  try {
    const startup = await wait(() => ready, 'real model initialization')
    client = createPersonalAgentClient({ socketPath: startup.socketPath, token: startup.token, reconnectDelayMs: 25 })
    const definition = createSystemChannelPlugins().find(plugin => plugin.manifest.id === 'odk.system.personal-agent')
    const capabilities = { ipc,
      broadcast: (name, frame) => { if (!win.isDestroyed()) win.webContents.send(name, frame) },
      'system.personal-agent': { options: {}, create: () => client, smokeMode: false,
        isConsumerFrame: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame,
        openExternal: async () => assert.fail('Preparing a local reply cannot open an external destination') },
    }
    for (const name of ['status', 'consumer-ready', 'toggle', 'cancel', 'text', 'proposal', 'gmail-open']) ipc.removeHandler('odk-personal-agent-' + name)
    const runtime = definition.create({ capability: name => capabilities[name], onCleanup: cleanup => cleanups.push(cleanup), signal: new AbortController().signal })
    runtime.start()
    await wait(() => client.snapshot().proposalCapabilities?.read, 'resident connection', 10000)
    win.showInactive()
    // The resident Agent is already visible on Home. Compact page dots sit
    // below the fold; scrolling to them would move the Agent out of view.
    await wait(() => evaluate(`['.agent-conversation', '.agent-composer'].every(selector => {
      const element = document.querySelector(selector), box = element?.getBoundingClientRect();
      return element?.checkVisibility() && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
    })`), 'visible resident Personal Agent conversation and composer', 10000)
    const generationStartedAt = Date.now()
    const triggered = await request('tick')
    latencyMs.recommendation = Date.now() - generationStartedAt
    assert.equal(triggered.proposal.length, 1, 'The model must produce exactly one useful invitation recommendation')
    const proposal = await wait(() => client.snapshot().proposals?.find(p => p.status === 'pending'), 'invitation proposal', 10000)
    assert.equal(proposal.action.tool, 'private_source_prepare_reply', 'The real model must choose the useful reply action')
    assert.equal(proposal.actionId, 'prepare_reply')
    assert.equal(proposal.privateData, true)
    await wait(async () => evaluate(`(() => {
      const card = document.querySelector('[data-proposal-id="${proposal.id}"].personal-agent-proposal');
      return card && card.querySelector('[data-proposal-action="execute"]')?.textContent === '准备面试回复';
    })()`), 'one reply action in the actual Shell', 10000)
    assert.equal(await evaluate(`document.querySelectorAll('[data-proposal-id="${proposal.id}"] .personal-agent-proposal-primary').length`), 1)
    if (process.env.ODK_TEST_SCREENSHOT) {
      await evaluate(`document.querySelector('[data-proposal-id="${proposal.id}"] .personal-agent-proposal-advice').scrollIntoView({block:'center',behavior:'instant'})`)
      const layout = await evaluate(`(() => {
        const card = document.querySelector('[data-proposal-id="${proposal.id}"].personal-agent-proposal');
        const box = card.querySelector('.personal-agent-proposal-primary').getBoundingClientRect();
        const conversation = card.closest('.agent-conversation'), view = conversation.getBoundingClientRect();
        return { primaryVisible: box.top >= view.top && box.bottom <= view.bottom,
          overflow: conversation.scrollWidth - conversation.clientWidth };
      })()`)
      assert.equal(layout.primaryVisible, true, 'The simple reply action must be visible with its advice')
      assert(layout.overflow <= 1, 'The recommendation cannot widen the conversation: ' + JSON.stringify(layout))
      const screenshot = await capturePaintedPage(win)
      await fs.writeFile(process.env.ODK_TEST_SCREENSHOT.replace(/\.png$/, '-recommendation.png'), screenshot.toPNG())
    }
    await clickVisible(`[data-proposal-id="${proposal.id}"] [data-proposal-action="execute"]`)
    await wait(async () => evaluate(`Boolean(document.querySelector('[data-proposal-id="${proposal.id}"] [data-proposal-action="confirm"]'))`), 'host confirmation', 10000)
    const draftStartedAt = Date.now()
    await clickVisible(`[data-proposal-id="${proposal.id}"] [data-proposal-action="confirm"]`)
    const completed = await wait(() => {
      const status = client.snapshot()
      if (status.proposalError || status.state === 'error') throw Error('Mail reply was refused: ' + (status.proposalError || status.message))
      return status.ownerOnly === true && status.state === 'idle' && status.message && status
    }, 'real model unsent reply')
    latencyMs.reply = Date.now() - draftStartedAt
    assert(completed.proposals.some(p => p.id === proposal.id && p.status === 'completed' && p.execution?.receipt?.unsent === true))
    await wait(async () => evaluate(`([...document.querySelectorAll('.agent-message-assistant:not(.agent-recommendation) .agent-message-body')]
      .filter(body => body.textContent.replace(/\\s/g, "") === ${JSON.stringify(completed.message.replace(/\s/g, ''))}).length === 1)`), 'one ordinary conversation draft', 10000)
    const projected = projectPersonalAgentFrame(completed)
    assert(!JSON.stringify(projected).includes(completed.message), 'Android projection cannot contain the private draft')
    const before = await request('status')
    assert.equal(before.drafts, 1)
    assert.equal(before.mutations, 0)
    assert.equal(before.ownerConfigWrites, 0)
    assert.equal(before.publicTurns, 0)
    assert(before.reads >= 3, 'The Gmail source must be read initially and before/after drafting')
    const repeated = await request('tick')
    assert.equal(repeated.drafts, 1)
    assert.equal(repeated.generations, before.generations)
    const duplicate = await request('status')
    assert.equal(duplicate.drafts, 1)
    assert.equal(duplicate.generationModel, startup.selectedModel, 'Both stages must use the configured model')
    if (process.env.ODK_TEST_SCREENSHOT) {
      await evaluate(`(() => {
        const bodies = [...document.querySelectorAll('.agent-message-assistant:not(.agent-recommendation) .agent-message-body')];
        bodies.at(-1)?.scrollIntoView({ block: 'end', behavior: 'instant' });
      })()`)
      if (await evaluate(`document.querySelector('.agent-latest')?.hidden === false`)) await clickVisible('.agent-latest')
      await wait(() => evaluate(`document.querySelector('.agent-latest')?.hidden !== false`), 'latest control clear of draft', 10000)
      await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
      const screenshot = await capturePaintedPage(win)
      await fs.writeFile(process.env.ODK_TEST_SCREENSHOT, screenshot.toPNG())
    }
    console.log('MAIL_REPLY_E2E_PASS ' + JSON.stringify({ sourceMode: startup.sourceMode, selectedModel: duplicate.selectedModel,
      generationModel: duplicate.generationModel, generations: duplicate.generations, drafts: duplicate.drafts,
      latencyMs: { ...latencyMs, total: Date.now() - startedAt }, sourceReads: duplicate.reads, mutations: 0, ownerConfigWrites: 0, ownerOnly: true, publicTurns: 0,
      ...(process.env.ODK_TEST_SCREENSHOT ? { screenshot: process.env.ODK_TEST_SCREENSHOT } : {}) }))
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    const cleanupErrors = []
    for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(error => cleanupErrors.push(error.message))
    if (cleanupErrors.length) console.error('MAIL_REPLY_CLEANUP_ERRORS ' + JSON.stringify({ primaryFailure: primaryFailure?.message, errors: cleanupErrors }))
    if (!failure) await request('shutdown').catch(() => {})
    lines.close()
    if (child.exitCode === null) child.kill()
    await exit
    if (!primaryFailure && cleanupErrors.length) throw Error('Mail reply fixture cleanup failed')
  }
}

module.exports = { verifyMailReply }
