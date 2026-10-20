'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')

test('normal Home preview has complete, consistent readings without provider access', () => {
  const handlers = new Map()
  const ipc = { handle(name, callback) { assert.equal(handlers.has(name), false); handlers.set(name, callback) },
    removeHandler(name) { handlers.delete(name) } }
  const now = 1791864000000
  const preview = installHomePreviewFixtures(ipc, { now })
  const read = name => handlers.get(name)()
  const pi = read('odk-pi-sessions')
  assert.equal(pi.summary.running, pi.sessions.filter(item => item.status === 'running').length)
  assert.equal(pi.summary.total, pi.sessions.length)
  assert.equal(pi.summary.workspacesCount, new Set(pi.sessions.map(item => item.cwd)).size)
  assert.ok(read('odk-pi-session-events').events.length)
  assert.equal(read('odk-weather-status').current.temperature, 26)
  assert.equal(read('odk-weather-status').place, 'Taipei')
  assert.ok(read('odk-futu-holdings').snapshot.positions.every(item => Number.isFinite(item.price)))
  assert.deepEqual(read('odk-camera-frame'), { ok: false }, 'the preview keeps the Camera source unavailable')
  assert.ok(read('odk-hydra-status').nodes.every(item => item.online && Number.isFinite(item.soilPercent)))
  assert.ok(read('odk-weread-highlight').highlight.markText)
  assert.ok(read('odk-opencode-go-status').snapshot.accounts[0].groups[0].quotas.length)
  assert.equal(read('odk-remote-link-state').state, 'usb')
  const text = preview.briefing.items.map(item => item.text).join(' ')
  assert.match(text, new RegExp(pi.summary.running + ' active sessions'))
  assert.match(text, /Taipei.*26°C/)
  assert.match(text, new RegExp(read('odk-hydra-status').nodes[0].soilPercent + '%'))
  assert.equal(preview.pomodoro.remaining, '18:42')
  assert.equal(preview.briefing.generatedAt, now)
  assert.equal(read('odk-personal-bot-status').message, preview.reply)
  assert.equal(preview.synthetic, true)
  assert.equal(preview.updates.length,2)
  assert.deepEqual([...read('odk-personal-bot-status').remote.messages].reverse().filter(m=>m.presentation==='assistant_update').map(m=>m.text),preview.updates)
  assert(read('odk-personal-bot-status').remote.messages.some(m=>m.presentation===undefined),'legacy reports remain in the synthetic preview')
})

test('optional time preview uses its own page without overlapping the Desk instrument', async () => {
  const { installTimeWidgetLayout } = require('./helpers/time-widget-layout')
  let source
  const win = { webContents: { debugger: { isAttached: () => true, async sendCommand(name, params) { if (name === 'Page.addScriptToEvaluateOnNewDocument') source = params.source } } } }
  await installTimeWidgetLayout(win, { pageId: 'time-preview', separatePage: true })
  const window = {}
  require('node:vm').runInNewContext(source, { window })
  window.DESKTOP_LAYOUT = { pages: [{ id: 'desk', widgets: [{ id: 'odk.tile.hydra', col: '1 / 4', row: '1 / 3' }] }] }
  assert.equal(window.DESKTOP_LAYOUT.pages[0].widgets.length, 1)
  const page = window.DESKTOP_LAYOUT.pages.find(page => page.id === 'time-preview')
  assert.equal(page.widgets.length, 2)
  assert.deepEqual(Array.from(page.widgets, widget => widget.id), ['odk.tile.clock', 'odk.tile.almanac'])
})
