'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { integrationPath } = require('./repo-root')
const { createPersonalAgentClient } = require('../../src/personal-agent-client')
const { createSystemChannelPlugins } = require('../../src/plugins/system-channels')

async function until(check, message) {
  const deadline = Date.now() + 7000
  do {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  assert.fail(message)
}

async function verifyScheduleConflict(ipcMain, win, evaluate) {
  const child = spawn(process.env.npm_node_execpath || 'node', [integrationPath('personal-agent/tests/fixtures/schedule-conflict-resident.mjs')],
    { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: child.stdout })
  const replies = new Map()
  const opened = []
  const cleanups = []
  let startup, failure, requestId = 0, channel
  const exit = new Promise(resolve => child.once('close', code => {
    failure ??= Error('Schedule conflict resident exited with code ' + code)
    resolve()
  }))
  child.on('error', error => { failure = error })
  child.stdin.on('error', error => { failure = error })
  lines.on('line', line => {
    try {
      const row = JSON.parse(line)
      if (row.type === 'ready') startup = row
      else replies.set(row.requestId, row)
    } catch (error) { failure = error }
  })
  const wait = (check, message) => until(() => {
    if (failure) throw failure
    return check()
  }, message)
  async function request(type, fields = {}) {
    const id = ++requestId
    child.stdin.write(JSON.stringify({ requestId: id, type, ...fields }) + '\n')
    const reply = await wait(() => replies.get(id), 'Resident did not complete ' + type)
    replies.delete(id)
    assert.equal(reply.ok, true, JSON.stringify(reply))
    return reply
  }
  try {
    const { socketPath, token } = await wait(() => startup, 'Schedule conflict resident did not start')
    const client = createPersonalAgentClient({ socketPath, token, reconnectDelayMs: 25 })
    const plugin = createSystemChannelPlugins().find(definition => definition.manifest.id === 'odk.system.personal-agent')
    const capabilities = {
      ipc: ipcMain,
      broadcast: (name, frame) => { if (!win.isDestroyed()) win.webContents.send(name, frame) },
      'system.personal-agent': { options: {}, create: () => client, smokeMode: false,
        isConsumerFrame: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame,
        openExternal: async url => { opened.push(url) } },
    }
    channel = plugin.create({ capability: name => capabilities[name], onCleanup: callback => cleanups.push(callback), signal: new AbortController().signal })
    channel.start()
    const readCards = () => evaluate(`[...document.querySelectorAll('.agent-conversation .agent-message-assistant .personal-agent-proposal')].map(card => ({
      id: card.dataset.proposalId,
      hasSourceDisclosure: Boolean(card.querySelector('.personal-agent-proposal-sources')),
      primaryCount: card.querySelectorAll('.personal-agent-proposal-primary').length,
      buttons: [...card.querySelectorAll('button')].map(button => button.dataset.proposalAction),
    }))`)
    async function visibleProposal(expected) {
      const card = await wait(async () => {
        const pending = client.snapshot().proposals?.filter(p => p.status === 'pending')
        const cards = (await readCards()).filter(p => p.buttons.includes('open-gmail'))
        return pending?.length === 1 && cards.length === 1 && pending[0].id === cards[0].id
          && (!expected || pending[0].id === expected) && cards[0]
      }, 'Shell did not display one current source card')
      assert.equal(card.hasSourceDisclosure, false)
      assert.equal(card.primaryCount, 1)
      assert.deepEqual(card.buttons, ['open-gmail', 'snooze', 'ignore'])
      return card.id
    }
    const assertNoOpen = async (id, messageId) => {
      await wait(async () => !(await readCards()).some(card => card.buttons.includes('open-gmail')),
        'Shell retained an obsolete Gmail source control')
      assert.equal(await evaluate(`odkPersonalAgent.openProposalGmail(${JSON.stringify(id)}, ${JSON.stringify(messageId)})`), false)
    }
    const assertWithdrawn = async (id, messageId) => {
      await wait(async () => !(await readCards()).some(card => card.id === id),
        'Shell retained a card for an unavailable account')
      await assertNoOpen(id, messageId)
    }
    async function openCurrent(id) {
      const messageId = client.snapshot().proposals.find(p => p.id === id).sources[0].messageId
      const count = opened.length
      await evaluate(`document.querySelector('button[data-proposal-action="open-gmail"]').click()`)
      await wait(() => opened.length > count, 'Trusted Gmail opener did not receive the source')
      assert.deepEqual(opened.slice(count), [`https://mail.google.com/mail/#all/${messageId}`])
      return messageId
    }

    const original = await visibleProposal()
    assert.equal(await openCurrent(original), 'aa1122')
    await request('tick')
    assert.equal(await visibleProposal(original), original)
    await request('restart')
    assert.equal(await visibleProposal(original), original)

    await evaluate(`(() => {
      const menu = document.querySelector('.personal-agent-proposal-more')
      if (!menu.open) menu.querySelector('summary').click()
      document.querySelector('button[data-proposal-action="snooze"]').scrollIntoView({ block: 'center', behavior: 'instant' })
    })()`)
    await wait(() => evaluate(`(() => {
      const control = document.querySelector('button[data-proposal-action="snooze"]')
      if (!control?.checkVisibility()) return false
      const bounds = control.getBoundingClientRect()
      const viewport = control.closest('.agent-conversation').getBoundingClientRect()
      return bounds.height > 0 && bounds.top >= Math.max(0, viewport.top) && bounds.bottom <= Math.min(innerHeight, viewport.bottom)
    })()`), 'Later did not become visible inside More')
    await evaluate(`document.querySelector('button[data-proposal-action="snooze"]').click()`)
    await wait(async () => client.snapshot().proposals?.some(p => p.id === original && !p.offered)
      && !(await readCards()).some(card => card.id === original), 'Later did not remove the current card')
    await assertNoOpen(original, 'aa1122')
    await request('advance', { ms: 60000 })
    assert.equal(await visibleProposal(original), original)

    const wrongAccount = await request('restart', { account: 'wrong' })
    assert.deepEqual(wrongAccount.proposals, [])
    await wait(() => {
      const status = client.snapshot()
      return status.state === 'idle' && status.proposals?.length === 0
    }, 'Reconnected Shell did not clear suggestions for the wrong Gmail account')
    await assertWithdrawn(original, 'aa1122')
    await request('restart')
    assert.equal(await visibleProposal(original), original)

    await request('tick', { phase: 'revised' })
    const revised = await visibleProposal()
    assert.notEqual(revised, original, 'A revised time has a new response identity')
    const revisedMessage = await openCurrent(revised)
    assert.equal(revisedMessage, 'bb2233')
    await request('tick', { phase: 'cancelled' })
    await assertNoOpen(revised, revisedMessage)

    await request('tick', { phase: 'expiring' })
    const beforeRevoke = await visibleProposal()
    const expiringMessage = await openCurrent(beforeRevoke)
    assert.equal(expiringMessage, 'dd4455')
    await request('restart', { grant: false })
    await assertWithdrawn(beforeRevoke, expiringMessage)
    await request('restart')
    const expiring = await visibleProposal()
    assert.equal(await openCurrent(expiring), expiringMessage)
    const before = await request('status')
    const after = await request('advance', { ms: 120000 })
    await assertNoOpen(expiring, expiringMessage)
    assert.ok(after.proposals.some(p => p.id === expiring && p.status === 'expired'))
    assert.equal(after.gmailReads, before.gmailReads, 'Expiry should not require a Gmail poll')
    console.log('SCHEDULE_CONFLICT_E2E_PASS: Gmail MCP and calendar fixtures, authenticated resident socket, disk restart, Electron source card, replay, Later, account pinning, revision, cancellation, revocation, and expiry')
  } finally {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup()
      if (!failure) await request('shutdown').catch(() => {})
    } finally {
      lines.close()
      if (child.exitCode === null) child.kill()
      await exit
    }
  }
}

module.exports = { verifyScheduleConflict }
