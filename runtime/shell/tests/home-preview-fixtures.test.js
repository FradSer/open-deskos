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
  const highlight = read('odk-weread-highlight').highlight
  assert.ok(highlight.markText)
  assert.ok(highlight.author, 'Reading preview retains the author below the title')
  assert.match(highlight.cover, /^data:image\/svg\+xml;base64,/, 'Reading preview has a local synthetic cover')
  assert.equal(highlight.createTime, now)
  assert.match(Buffer.from(highlight.cover.split(',')[1], 'base64').toString(), /Synthetic reading cover/)
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

test('Widget harness retains declared spans and the original Home with Overview', async () => {
  const { installWidgetGridLayout } = require('./helpers/time-widget-layout')
  let source
  const win = { webContents: { debugger: { isAttached: () => true, async sendCommand(name, params) {
    if (name === 'Page.addScriptToEvaluateOnNewDocument') source = params.source
  } } } }
  await installWidgetGridLayout(win)
  const ids = ['odk.tile.hydra', 'odk.tile.weread', ...Array.from({ length: 15 }, (_, index) => `odk.tile.fixture-${index}`)]
  const window = { odkPlugins: { byKind: kind => { assert.equal(kind, 'tile'); return ids.map(id => ({ id, opensApp: id.slice(9) })) } } }
  require('node:vm').runInNewContext(source, { window })
  const original = [
    { id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: ids[2], col: '1', row: '1' }, { id: ids[3], col: '2 / 4', row: '1' }] },
    { id: 'desk', name: 'Desk', kind: 'grid', widgets: [{ id: ids[0], col: '1 / 4', row: '1' }] },
    { id: 'reading', name: 'Reading', kind: 'grid', widgets: [{ id: ids[1], col: '1', row: '1' }] },
    { id: 'large', name: 'Large', kind: 'grid', widgets: [{ id: ids[4], col: '1 / 4', row: '1 / 3' }] },
  ]
  const before = JSON.stringify(original)
  window.DESKTOP_LAYOUT = { pages: original.slice() }
  assert.equal(JSON.stringify(original), before)
  const pages = window.DESKTOP_LAYOUT.pages.filter(page => window.__odkWidgetGridPages.includes(page.id))
  assert.equal(pages.length, 6)
  assert.deepEqual(pages.slice(0, 4).map(page => page.id), ['home', 'desk', 'reading', 'large'])
  assert.deepEqual(pages.slice(4).map(page => page.widgets.length), [9, 3])
  assert.deepEqual(pages.flatMap(page => page.widgets.map(widget => widget.id)).sort(), ids.slice().sort())
  assert.equal(pages[1].widgets[0].col, '1 / 4')
  assert.equal(pages[1].widgets[0].row, '1')
  assert.equal(pages[2].widgets[0].col, '1')
  assert.equal(pages[2].widgets[0].row, '1')
  assert.equal(pages[3].widgets[0].row, '1 / 3')
})
