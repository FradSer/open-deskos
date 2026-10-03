const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function mount(file, id) {
  const plugins = []
  const nodes = new Map()
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', className: '', attrs: {}, classList: { add() {}, remove() {} }, setAttribute(k, v) { this.attrs[k] = v }, listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn }, getBoundingClientRect() { return { top: 0, bottom: 0 } }, closest() { return { scrollTop: 0, getBoundingClientRect() { return { top: 0, bottom: 0 } } } }, querySelectorAll() { return [] } })
    return nodes.get(selector)
  }
  let response
  let tick
  const contributions = []
  const cleanups = []
  const root = { odkPlugins: { register(p) { plugins.push(p) } }, odkPlatform: { getPiSessions: async () => response } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins', file), 'utf8'), { window: root })
  // A tile is a DOM element, and a Widget that adapts to its Cell measures the
  // one it was given: the double answers with a width the cell would have.
  const classes = new Set()
  const el = { innerHTML: '', classList: { add(name) { classes.add(name) }, remove(name) { classes.delete(name) } }, querySelector: node, querySelectorAll: () => [], addEventListener() {}, getBoundingClientRect: () => ({ width: 400, height: 400, top: 0, bottom: 400 }) }
  const statementText = () => contributions.at(-1)?.parts.map((part) => part.text).join('')
  return { node, classes, contributions, statementText, dispose() { for (const cleanup of cleanups) cleanup() }, async show(value) {
    response = value
    if (!tick) {
      const plugin = plugins.find((p) => p.id === id)
      const ctx = { onTick(fn) { tick = fn }, trackCleanup(fn) { cleanups.push(fn) }, briefing: { contribute(statement) { contributions.push(statement); return true } } }
      if (plugin.mount) plugin.mount(el, ctx)
      else plugin.lifecycle.mount(el, ctx)
    } else { for (let i = 0; i < 15; i++) tick() }
    await new Promise((resolve) => setImmediate(resolve))
  } }
}
const source = { kind: 'ssh', label: 'Mac / SSH · test-mac' }
const live = { ok: true, source, summary: { running: 2, total: 2, workspacesCount: 1 }, sessions: [], workspaces: [] }
const failed = { ok: false, source, summary: null, sessions: [], workspaces: [], error: 'SSH unavailable' }

test('widget identifies Mac source and cannot turn disconnected Mac into idle', async () => {
  const view = mount('pi-sessions.js', 'odk.tile.pi-sessions')
  await view.show(live)
  assert.match(view.node('.pi-widget-summary').textContent, /Mac \/ SSH/)
  await view.show(failed)
  assert.equal(view.node('.pi-widget-count').textContent, '--')
  assert.equal(view.node('.pi-widget-tag-label').textContent, 'OFFLINE')
  assert.match(view.node('.pi-widget-summary').textContent, /Mac \/ SSH/)
})

test('tile summary reads source, workspace count, and live count while idle states stay truthful', async () => {
  const view = mount('pi-sessions.js', 'odk.tile.pi-sessions')
  const settled = (sessionId) => ({ sessionId, status: 'settled', cwd: '/workspace/desk', workspaceName: 'desk', startedAt: 0, updatedAt: 1 })
  const idle = { ok: true, source, summary: { running: 0, total: 2, workspacesCount: 1 }, sessions: [settled('a'), settled('b')], workspaces: [] }
  await view.show(idle)
  assert.equal(view.node('.pi-widget-summary').textContent, 'Mac / SSH · test-mac · 1 workspace · 2 live')
  assert.equal(view.node('.w-state').textContent, '2 idle')
  assert.equal(view.node('.pi-widget-tag-label').textContent, 'IDLE')
  assert.equal(view.classes.has('pi-widget-detailed'), false)

  await view.show({ ...idle, sessions: [{ ...settled('a'), updatedAt: '2026-10-03T00:00:00Z', latestGoal: 'Review the desktop' }] })
  assert.equal(view.classes.has('pi-widget-detailed'), true)

  const empty = { ok: true, source, summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [], workspaces: [] }
  await view.show({ ...empty, summary: { running: 123, total: 123, workspacesCount: 1 } })
  assert.equal(view.classes.has('pi-widget-wide-count'), true)
  await view.show(empty)
  assert.equal(view.node('.pi-widget-summary').textContent, 'Mac / SSH · test-mac · 0 workspaces · 0 live')
  assert.equal(view.node('.w-state').textContent, 'Idle')
  assert.equal(view.classes.has('pi-widget-detailed'), false)
  assert.equal(view.classes.has('pi-widget-wide-count'), false)
})

test('status bar identifies Mac and reports unavailable after a successful scan', async () => {
  const view = mount('status-pi-sessions.js', 'odk.status.pi-sessions')
  await view.show(live)
  assert.match(view.node('#sb-pi-status').attrs['aria-label'], /Mac \/ SSH/)
  assert.equal(view.contributions.at(-1).id, 'odk.briefing.pi-sessions')
  assert.match(view.statementText(), /You have 2 Pi sessions working across 1 workspace, today\./)
  await view.show(failed)
  assert.equal(view.node('#sb-pi-count').textContent, '--')
  assert.match(view.node('#sb-pi-status').attrs['aria-label'], /unavailable/i)
  assert.match(view.node('#sb-pi-status').attrs['aria-label'], /Mac \/ SSH/)
  assert.deepEqual(view.statementText(), 'Pi session status is unavailable.')
})

test('a late scan success or error cannot overwrite the newer idle Widget reading', async t => {
  for (const outcome of ['success', 'error']) {
    await t.test(outcome, async () => {
      const view = mount('pi-sessions.js', 'odk.tile.pi-sessions')
      const oldScan = Promise.withResolvers()
      const newScan = Promise.withResolvers()
      await view.show(oldScan.promise)
      await view.show(newScan.promise)
      newScan.resolve({ ...live, summary: { running: 0, total: 0, workspacesCount: 0 } })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(view.node('.pi-widget-count').textContent, '0')
      if (outcome === 'success') oldScan.resolve({ ...live, summary: { running: 123, total: 123, workspacesCount: 1 } })
      else oldScan.reject(new Error('Old scan failed'))
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(view.node('.pi-widget-count').textContent, '0')
      assert.equal(view.node('.pi-widget-tag-label').textContent, 'IDLE')
      assert.equal(view.classes.has('pi-widget-wide-count'), false)
    })
  }
})

test('a scan finishing after Widget disposal cannot repaint it', async () => {
  const view = mount('pi-sessions.js', 'odk.tile.pi-sessions')
  const scan = Promise.withResolvers()
  await view.show(scan.promise)
  const before = view.node('.pi-widget-count').textContent
  view.dispose()
  scan.resolve(live)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.node('.pi-widget-count').textContent, before)
})

test('a slow completed scan is usable while the next poll is still pending', async () => {
  const view = mount('pi-sessions.js', 'odk.tile.pi-sessions')
  const oldScan = Promise.withResolvers()
  const nextScan = Promise.withResolvers()
  await view.show(oldScan.promise)
  await view.show(nextScan.promise)
  oldScan.resolve(live)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.node('.pi-widget-count').textContent, '2')
  nextScan.resolve({ ...live, summary: { running: 0, total: 0, workspacesCount: 0 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.node('.pi-widget-count').textContent, '0')
})
