'use strict'

// The content every geometry gate measures against.
//
// Two geometry gates exist: the density gate asks how much ink a Widget lays
// down, and the responsive matrix gate asks whether everything the Widget has to
// say can be drawn at all. Both must look at the same desk, or they can disagree
// about what "the Widget" contains, so the fixture content lives here once.
//
// `wide` selects between the two payloads. The narrow payload is what the density
// gate's thresholds were measured against and is kept byte-for-byte, because a
// fixture change would move those numbers. The wide payload is the most a feed
// can actually carry — four-figure prices, four-character symbols, long CJK
// titles, long prompts, a long source label — because a responsive property proven
// on thin content proves nothing.
const NARROW_POSITIONS = [
  { code: 'US.TEM', marketVal: 7311, dayRatio: 0.031 },
  { code: 'US.SDGR', marketVal: 5373, dayRatio: -0.012 },
  { code: 'US.TSLA', marketVal: 7067, dayRatio: 0.0074 },
  { code: 'US.PATH', marketVal: 1377, dayRatio: 0.08 },
  { code: 'US.QS', marketVal: 1032, dayRatio: -0.05 },
]

const WIDE_POSITIONS = [
  { code: 'US.TQQQ', price: 1234.56, marketVal: 73110, dayRatio: 0.1236 },
  { code: 'US.TSLA', price: 369.48, marketVal: 53730, dayRatio: -0.0122 },
  { code: 'US.TM', price: 26.75, marketVal: 70670, dayRatio: 0.0074 },
  { code: 'US.PATH', price: 13.77, marketVal: 13770, dayRatio: 0.08 },
]

const WIDE_SESSIONS = [
  { status: 'running', sessionId: 'example-a', cwd: '/Users/FradSer/Developer/FradSer/open-deskos', startedAt: 1756460000000, updatedAt: 1756463600000, latestGoal: '反思所有的设计，然后争取在任何屏幕都是响应式的', activity: 'bash: pnpm test', modifiedFiles: [] },
  { status: 'running', sessionId: 'example-b', cwd: '/Users/FradSer/Developer/FradSer/pi-packages/packages/open-deskos', startedAt: 1756461800000, updatedAt: 1756463600000, latestGoal: 'fix all needed', activity: 'bash: pnpm build', modifiedFiles: [] },
  { status: 'settled', sessionId: 'example-c', cwd: '/Users/FradSer/Developer/FradSer/carbon-atlas', startedAt: 1756462700000, updatedAt: 1756463600000, latestGoal: '', activity: '', modifiedFiles: [] },
  { status: 'settled', sessionId: 'example-d', cwd: '/Users/FradSer/Developer/FradSer/icon-maker', startedAt: 1756463000000, updatedAt: 1756463600000, latestGoal: 'Add the pixel icon set to the status bar', modifiedFiles: [] },
  { status: 'exited', sessionId: 'example-e', cwd: '/Users/FradSer/Developer/FradSer/is-yi', startedAt: 1756463480000, updatedAt: 1756463600000, latestGoal: 'Ship the island grid', modifiedFiles: [] },
]

const WIDE_EVENTS = [
  { kind: 'user', text: 'Explain the runtime channel token handshake in detail, and why ownership cannot authenticate a named pipe.' },
  { kind: 'tool', text: 'bash: node --test tests/local-channel.test.js', toolCallId: 'call-ok' },
  { kind: 'result', toolName: 'bash', toolCallId: 'call-ok', text: 'pass 12 fail 0' },
]

function installGeometryFixtures(ipcMain, { state = 'unavailable', wide = false } = {}) {
  const live = state === 'live'
  ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
  ipcMain.handle('odk-remote-publish-page-state', () => true)
  ipcMain.handle('odk-remote-navigation', () => true)
  ipcMain.handle('odk-remote-input', () => true)
  ipcMain.handle('odk-remote-link-state', () => ({ state: 'unavailable' }))
  ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
  ipcMain.handle('odk-user-apps-changed', () => ({ ok: true }))
  ipcMain.handle('odk-app-manager-list', () => ({ ok: true, apps: [] }))
  ipcMain.handle('odk-app-manager-state', () => ({ ok: true }))
  ipcMain.handle('odk-voice-status', () => ({ state: 'idle' }))
  ipcMain.handle('odk-camera-frame', () => ({ ok: false }))
  ipcMain.handle('odk-weather-status', () => (live
    ? wide
      // A long place and condition are the stress case for the label that carries them.
      ? { status: 'live', place: 'Würzburg am Main', current: { temperature: 25, unit: '°C', condition: 'Light rain showers', sky: 'rain', code: 8 }, daily: { high: 27, low: 21 }, updatedAt: Date.now(), hint: null, error: null }
      : { status: 'live', place: 'Shenzhen', current: { temperature: 25, unit: '°C', condition: 'Partly cloudy', sky: 'cloud', code: 2 }, daily: { high: 27, low: 21 }, updatedAt: Date.now(), hint: null, error: null }
    : { status: 'unavailable', place: 'Shenzhen', current: null, daily: null, updatedAt: null, hint: null, error: 'provider timed out after 8000 ms' }))
  ipcMain.handle('odk-weread-highlight', () => (live
    ? { status: 'live', highlight: { title: '习惯的力量：微习惯的复利', markText: '把每一次微小的改变累积起来，最终会带来意想不到的结果。' } }
    : { status: 'unconfigured', highlight: null }))
  ipcMain.handle('odk-pi-sessions', () => (wide
    ? { source: { kind: 'ssh', label: 'frad-macbook-pro.tail27726.ts.net' }, summary: { running: 2, total: 5, workspacesCount: 4 }, sessions: WIDE_SESSIONS }
    : { summary: { running: live ? 3 : 0, total: live ? 5 : 0, workspacesCount: live ? 2 : 0 }, sessions: [] }))
  ipcMain.handle('odk-pi-session-events', () => (wide ? { ok: true, events: WIDE_EVENTS } : { ok: true, events: [] }))
  ipcMain.handle('odk-hydra-status', () => (live
    ? { configured: true, connected: true, env: { tempC: 31.3, humidity: 79.8, pressureHpa: 998.9, lux: 1234, updatedAt: Date.now(), stale: false }, nodes: [{ id: 1, online: true, pump: false, soilPercent: 62 }, { id: 2, online: true, pump: false, soilPercent: 48 }] }
    : { configured: true, connected: true, env: { tempC: 24.5, humidity: 61, pressureHpa: 1002, lux: 800, updatedAt: Date.now(), stale: true }, nodes: [{ id: 1, online: true, pump: false, soilPercent: 55 }, { id: 2, online: false, pump: false, soilPercent: null }] }))
  ipcMain.handle('odk-futu-holdings', () => (live
    ? {
      state: 'live', service: 'futu-poller', updatedAt: Date.now(),
      snapshot: {
        totals: { marketVal: 313835.5, plVal: 5946.95, plRatio: 0.0193 },
        positions: wide ? WIDE_POSITIONS : NARROW_POSITIONS.map((position) => ({ ...position })),
      },
    }
    : {
      state: 'unavailable', service: 'futu-poller', error: 'stale snapshot', updatedAt: Date.now() - 240000,
      snapshot: {
        totals: { marketVal: 313835.5, plVal: 5946.95, plRatio: 0.0193 },
        positions: NARROW_POSITIONS.slice(0, 3).map((position) => ({ ...position })),
      },
    }))
}

module.exports = { installGeometryFixtures, NARROW_POSITIONS, WIDE_POSITIONS, WIDE_SESSIONS }
