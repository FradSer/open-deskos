#!/usr/bin/env node
'use strict'

// Private acceptance candidate. No service or model starts in this process.
const argv = process.argv.slice(2)
if (!argv.includes('--live')) {
  process.stderr.write('LIVE_UI phase=authorization_required\n')
  process.exit(2)
}
process.on('uncaughtException', () => { process.stderr.write('LIVE_UI phase=initialization_failed\n'); process.exit(1) })
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
// Installed only under runtime/shell/tests/acceptance in a reviewed checkout.
const SHELL = path.resolve(__dirname, '../..')
const shellRequire = createRequire(path.join(SHELL, 'package.json'))
let phase = 'arguments', finished = false
const step = value => process.stdout.write(`LIVE_UI step=${value} pass=true\n`)
const fail = value => { const error = Error(value); error.phase = value; throw error }
function option(name, fallback) {
  const at = argv.indexOf(name)
  if (at < 0) return fallback
  if (at === argv.length - 1 || argv[at + 1].startsWith('--') || argv.lastIndexOf(name) !== at) fail('invalid_arguments')
  return argv[at + 1]
}
const allowed = new Set(['--live', '--endpoint', '--token-file', '--out', '--timeout-ms', '--theme'])
for (let i = 0; i < argv.length; i++) {
  if (!allowed.has(argv[i])) fail('invalid_arguments')
  if (argv[i] !== '--live') i++
}
const endpoint = option('--endpoint'), tokenFile = option('--token-file'), out = option('--out')
const timeoutMs = Number(option('--timeout-ms', '180000'))
const theme = option('--theme', 'instrument')
if (![endpoint, tokenFile, out].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 600000 || !['instrument', 'pixel', 'border-beam', 'liquid-glass'].includes(theme)) fail('invalid_arguments')
if (!fs.lstatSync(endpoint).isSocket()) fail('endpoint_not_socket')
const tokenFd = fs.openSync(tokenFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
let token
try {
  const info = fs.fstatSync(tokenFd)
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 8192) fail('unsafe_token_file')
  token = fs.readFileSync(tokenFd, 'utf8').trim()
  if (!token || /\s/.test(token)) fail('invalid_token_file')
} finally { fs.closeSync(tokenFd) }
fs.mkdirSync(out, { recursive: true, mode: 0o700 })
const outInfo = fs.lstatSync(out)
if (!outInfo.isDirectory() || outInfo.uid !== process.getuid() || (outInfo.mode & 0o077) !== 0 || fs.readdirSync(out).length) fail('unsafe_output_directory')
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
const { app, BrowserWindow, ipcMain, session } = shellRequire('electron')
const { createPersonalBotClient } = require(path.join(SHELL, 'src/personal-bot-client.js'))
const { createSystemChannelPlugins } = require(path.join(SHELL, 'src/plugins/system-channels.js'))
const { capturePaintedPage } = require(path.join(SHELL, 'tests/helpers/native-page-capture.js'))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-live-ride-ui-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.dock?.hide()
let win, client, unsubscribe, channel
const cleanups = [], ownerTurns = [], feedbackCommands = []
let frameSequence = 0, observedReply, clickSequence = -1, expectedOwnerText, ownerThinkingObserved = false
let selectedProposalId, feedbackAllowed = false, feedbackSequence = -1, observedFeedback
const deadline = Date.now() + timeoutMs
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, name) {
  phase = name
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(50)
  }
  fail(name + '_timeout')
}
async function evaluate(script) {
  const result = await win.webContents.executeJavaScript(`(() => { try { return { ok: true, value: (${script}) } } catch { return { ok: false } } })()`)
  if (!result?.ok) fail(phase + '_renderer_failed')
  return result.value
}
function replyVisibility(message) {
  const expectedNode = document.createElement('div')
  window.odkPersonalBotReply.render(expectedNode, message)
  const normalize = value => String(value).replace(/\s+/gu, '')
  const expected = normalize(expectedNode.textContent)
  return Boolean(expected) && [...document.querySelectorAll('.personal-bot-status-title, .agent-message')]
    .some(node => node.checkVisibility() && normalize(node.textContent).includes(expected))
}
async function screenshot(name) {
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
  const png = (await capturePaintedPage(win)).toPNG()
  if (!png.length) fail('empty_capture')
  fs.writeFileSync(path.join(out, name), png, { mode: 0o600 })
}
async function close(code) {
  if (finished) return
  finished = true
  clearTimeout(watchdog)
  unsubscribe?.()
  for (const cleanup of cleanups.reverse()) { try { await cleanup() } catch {} }
  client?.stop()
  if (win && !win.isDestroyed()) win.destroy()
  // Remove only this process's newly created profile, never endpoint/remote state.
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
const watchdog = setTimeout(() => { process.stderr.write('LIVE_UI phase=overall_timeout\n'); void close(1) }, timeoutMs)
app.whenReady().then(async () => {
  phase = 'window'
  for (const name of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list', 'odk-remote-publish-page-state']) ipcMain.handle(name, () => ({ ok: false, sessions: [], workspaces: [], apps: [] }))
  ipcMain.handle('odk-renderer-development-plugins', () => [])
  ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
  const isolated = session.fromPartition('live-ride-ui-' + crypto.randomUUID(), { cache: false })
  isolated.setPermissionCheckHandler(() => false)
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(?:file:|about:|devtools:)/.test(details.url) }))
  win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: { session: isolated, preload: path.join(SHELL, 'src/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  client = createPersonalBotClient({ socketPath: endpoint, token, reconnectDelayMs: 100 })
  const sendText = client.sendText.bind(client)
  // The acceptance surface can request this one read-only quote. It cannot send
  // order confirmation, voice toggles, proposal execution or arbitrary text.
  client.sendText = (text, replyTo) => {
    if (replyTo !== undefined || text !== expectedOwnerText || ownerTurns.length) return Promise.resolve(false)
    ownerTurns.push(text)
    clickSequence = frameSequence
    write('owner-turn.json', { text, submittedAt: new Date().toISOString() })
    return sendText(text)
  }
  client.toggle = () => false
  const proposalCommand = client.proposalCommand.bind(client)
  client.proposalCommand = command => {
    if (command.type === 'proposal_presented') return proposalCommand(command)
    const current = client.snapshot()
    const selected = current.proposals?.find(proposal => proposal.id === selectedProposalId)
    if (!feedbackAllowed || ownerTurns.length || feedbackCommands.length || command.type !== 'proposal_respond'
      || Object.keys(command).some(key => !['type', 'id', 'decision'].includes(key))
      || command.id !== selectedProposalId || command.decision !== 'useful' || current.state !== 'idle'
      || current.proposalCapabilities?.respond !== true || selected?.status !== 'pending' || selected.action !== null || selected.feedback === 'useful') return false
    feedbackSequence = frameSequence
    feedbackCommands.push({ type: command.type, id: command.id, decision: command.decision })
    write('feedback-command.json', { command: feedbackCommands[0], submittedAt: new Date().toISOString() })
    return proposalCommand(command)
  }
  unsubscribe = client.subscribe(frame => {
    frameSequence++
    if (feedbackCommands.length === 1 && frameSequence > feedbackSequence) {
      const actual = frame.proposals?.find(item => item.id === selectedProposalId)
      if (actual?.status === 'pending' && actual.feedback === 'useful') observedFeedback = { id: actual.id, status: actual.status, feedback: actual.feedback, frameSequence }
    }
    if (ownerTurns.length && frameSequence > clickSequence && frame.state === 'thinking' && frame.transcript === expectedOwnerText) ownerThinkingObserved = true
    if (ownerThinkingObserved && frameSequence > clickSequence && frame.state === 'idle' && typeof frame.message === 'string' && frame.message.trim()) observedReply = { message: frame.message, observedAt: new Date().toISOString(), state: frame.state }
  })
  const definition = createSystemChannelPlugins().find(item => item.manifest.id === 'odk.system.personal-bot')
  const capabilities = { ipc: ipcMain, broadcast: (name, frame) => { if (!win.isDestroyed()) win.webContents.send(name, frame) }, 'system.personal-bot': { options: {}, create: () => client, smokeMode: false, isConsumerFrame: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame } }
  channel = definition.create({ capability: name => capabilities[name], onCleanup: callback => cleanups.push(callback), signal: new AbortController().signal })
  await win.loadFile(path.join(SHELL, 'src/renderer/index.html'))
  win.showInactive()
  await win.webContents.executeJavaScript(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready`)
  channel.start()
  await until(() => client.snapshot().state === 'idle', 'connected')
  step('connected')
  let proposal
  await until(async () => {
    const candidates = client.snapshot().proposals?.filter(p => p.status === 'pending' && p.ridePreview) || []
    if (candidates.length > 1) fail('ambiguous_ride_proposals')
    proposal = candidates[0]
    if (!proposal) return false
    return evaluate(`(() => { const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)}); const advice = card?.querySelector('.personal-bot-proposal-advice'); return !!advice?.checkVisibility() && advice.textContent === ${JSON.stringify(proposal.advice)} })()`)
  }, 'proposal_visible')
  selectedProposalId = proposal.id
  step('proposal_visible')
  write('proposal.json', { id: proposal.id, advice: proposal.advice, nextStep: proposal.nextStep, ridePreview: proposal.ridePreview })
  await screenshot('ride-recommendation.png')
  feedbackAllowed = true
  await until(() => evaluate(`(() => {
    const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)})
    const details = card?.querySelector('.personal-bot-proposal-feedback-options')
    if (!details?.checkVisibility()) return false
    if (!details.open) details.querySelector('summary').click()
    return [...card.querySelectorAll('button')].some(node => node.textContent === 'Useful' && !node.disabled && node.checkVisibility())
  })()`), 'feedback_visible')
  phase = 'feedback_click'
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)})
    const button = [...(card?.querySelectorAll('button') || [])].find(node => node.textContent === 'Useful' && !node.disabled && node.checkVisibility())
    if (!button) throw Error()
    button.scrollIntoView({ block: 'center' }); button.click(); return true
  })()`)
  await until(() => {
    const actual = client.snapshot().proposals?.find(item => item.id === proposal.id)
    return feedbackCommands.length === 1 && observedFeedback?.frameSequence > feedbackSequence && actual?.status === 'pending' && actual.feedback === 'useful'
  }, 'feedback_observed')
  await until(() => evaluate(`(() => {
    const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)})
    return [...(card?.querySelectorAll('.personal-bot-proposal-feedback') || [])].some(node => node.textContent === 'Marked useful' && node.checkVisibility())
  })()`), 'feedback_result_visible')
  const feedbackResult = client.snapshot().proposals.find(item => item.id === proposal.id)
  write('feedback.json', { id: feedbackResult.id, status: feedbackResult.status, feedback: feedbackResult.feedback, commandCount: feedbackCommands.length, submittedFrameSequence: feedbackSequence, observedFrameSequence: observedFeedback.frameSequence, observedAt: new Date().toISOString() })
  await screenshot('ride-feedback.png')
  step('feedback_observed')
  await evaluate(`(() => { const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)}); const details = card?.querySelector('.personal-bot-proposal-feedback-options'); if (details?.open) details.querySelector('summary').click(); return true })()`)
  phase = 'details_open'
  await until(() => evaluate(`(() => { const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)}); const button = [...(card?.querySelectorAll('button') || [])].find(node => node.textContent === 'View ride details'); if (!button) return false; if (button.getAttribute('aria-expanded') === 'false') button.click(); return card.querySelector('.personal-bot-ride-details')?.checkVisibility() === true })()`), 'details_visible')
  await screenshot('ride-details.png')
  const preview = proposal.ridePreview
  if (preview.from?.length !== 1 || preview.to?.length !== 1) {
    write('result.json', { phase: 'needs_selection', passed: false, endpointChoiceRequired: true })
    process.stderr.write('LIVE_UI phase=needs_selection\n')
    return close(3)
  }
  expectedOwnerText = `查看报价 ${preview.handle} ${preview.from[0].handle} ${preview.to[0].handle}`
  phase = 'quote_click'
  await evaluate(`(() => { const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)}); const panel = card?.querySelector('.personal-bot-ride-details'); const details = [...card.querySelectorAll('button')].find(node => node.textContent === 'View ride details'); if (!panel || !details) throw Error(); if (!panel.hidden) details.click(); const button = card.querySelector('.personal-bot-ride-actions [data-proposal-action="ride-quote"]'); if (!panel.hidden || !button || button.disabled || !button.checkVisibility()) throw Error(); button.scrollIntoView({ block: 'center' }); return true })()`)
  await screenshot('ride-action.png')
  await evaluate(`(() => { const card = [...document.querySelectorAll('.personal-bot-proposal')].find(node => node.dataset.proposalId === ${JSON.stringify(proposal.id)}); const button = card?.querySelector('.personal-bot-ride-actions [data-proposal-action="ride-quote"]'); if (!button || button.disabled || !button.checkVisibility()) throw Error(); button.click(); return true })()`)
  await until(() => ownerTurns.length === 1, 'owner_quote_turn')
  step('owner_quote_turn')
  await until(() => Boolean(observedReply), 'reply_observed')
  write('reply.json', observedReply)
  await until(() => evaluate('(' + replyVisibility.toString() + ')(' + JSON.stringify(observedReply.message) + ')'), 'reply_visible')
  await screenshot('ride-reply.png')
  step('reply_observed')
  write('result.json', { phase: 'reply_observed', passed: true, providerReceiptVerified: false, noOrderConfirmationSent: true, ownerTurnCount: ownerTurns.length, feedbackCommandCount: feedbackCommands.length, proposalId: proposal.id, theme, screenshotFiles: ['ride-recommendation.png', 'ride-feedback.png', 'ride-details.png', 'ride-action.png', 'ride-reply.png'], note: 'UI evidence only. Verify actual MCP calls, quote receipt, phase, route, price and persisted useful feedback independently in the remote helper.' })
  await close(0)
}).catch(async () => {
  write('failure.json', { phase, ownerTurnCount: ownerTurns.length, feedbackCommandCount: feedbackCommands.length, providerReceiptVerified: false })
  process.stderr.write(`LIVE_UI phase=${/^[a-z_]+$/.test(phase) ? phase : 'failed'}\n`)
  await close(1)
})
