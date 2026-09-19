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
  const root = { odkPlugins: { register(p) { plugins.push(p) } }, odkPlatform: { getPiSessions: async () => response } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins', file), 'utf8'), { window: root })
  const el = { innerHTML: '', querySelector: node, querySelectorAll: () => [], addEventListener() {} }
  const statementText = () => contributions.at(-1)?.parts.map((part) => part.text).join('')
  return { node, contributions, statementText, async show(value) {
    response = value
    if (!tick) {
      const plugin = plugins.find((p) => p.id === id)
      const ctx = { onTick(fn) { tick = fn }, briefing: { contribute(statement) { contributions.push(statement); return true } } }
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

  const empty = { ok: true, source, summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [], workspaces: [] }
  await view.show(empty)
  assert.equal(view.node('.pi-widget-summary').textContent, 'Mac / SSH · test-mac · 0 workspaces · 0 live')
  assert.equal(view.node('.w-state').textContent, 'Idle')
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
