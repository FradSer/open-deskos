'use strict'

const { installGeometryFixtures } = require('./live-fixtures')

// Representative success data belongs to this preview, not to the runtime or
// the shared geometry/failure fixtures. All times and facts share one snapshot.
function installHomePreviewFixtures(ipcMain, { now = Date.now(), cameraFrame }) {
  if (!cameraFrame?.startsWith('data:image/png;base64,')) throw Error('Synthetic Camera PNG required')
  installGeometryFixtures(ipcMain, { state: 'live' })
  const replace = (name, value) => {
    ipcMain.removeHandler(name)
    ipcMain.handle(name, () => value)
  }
  const sessions = [
    ['desk', 'running', 'Polish the Home layout', 'Checking responsive bounds'],
    ['garden', 'running', 'Review moisture readings', 'Validating sensor updates'],
    ['notes', 'running', 'Organize reading highlights', 'Preparing a concise summary'],
    ['desk', 'settled', 'Verify theme compatibility', 'All three themes passed'],
    ['notes', 'settled', 'Save the daily note', 'Note saved'],
  ].map(([workspace, status, latestGoal, activity], index) => ({
    sessionId: `preview-${index + 1}`, status, cwd: `/workspace/${workspace}`,
    startedAt: now - (index + 1) * 600000, updatedAt: now, latestGoal, activity, modifiedFiles: [],
  }))
  replace('odk-pi-sessions', { source: { kind: 'local', label: 'Desk' },
    summary: { running: 3, total: sessions.length, workspacesCount: 3 }, sessions })
  replace('odk-pi-session-events', { ok: true, events: [
    { kind: 'user', text: 'Check the three-theme Home layout.' },
    { kind: 'tool', text: 'Running responsive checks', toolCallId: 'preview-check' },
    { kind: 'result', toolName: 'check', toolCallId: 'preview-check', text: 'All layout checks passed.' },
  ] })
  replace('odk-remote-link-state', { state: 'usb' })
  replace('odk-camera-frame', { status: 'live', frame: cameraFrame, capturedAt: now, width: 640, height: 360 })
  replace('odk-weather-status', { status: 'live', place: 'Taipei',
    current: { temperature: 26, unit: '°C', condition: 'Overcast', sky: 'cloud', code: 3 },
    daily: { high: 28, low: 22 }, updatedAt: now, hint: null, error: null })
  replace('odk-hydra-status', { configured: true, connected: true,
    env: { tempC: 24.5, humidity: 61, pressureHpa: 1002, lux: 800, updatedAt: now, stale: false },
    nodes: [{ id: 1, online: true, pump: false, soilPercent: 63 }, { id: 2, online: true, pump: false, soilPercent: 63 }] })
  replace('odk-futu-holdings', { state: 'live', service: 'futu-poller', updatedAt: now,
    snapshot: { totals: { marketVal: 313835.5, plVal: 5946.95, plRatio: 0.0193 }, positions: [
      { code: 'US.TEM', price: 62.15, marketVal: 7311, dayRatio: 0.031 },
      { code: 'US.SDGR', price: 21.49, marketVal: 5373, dayRatio: -0.012 },
      { code: 'US.TSLA', price: 369.48, marketVal: 7067, dayRatio: 0.0074 },
    ] } })
  replace('odk-opencode-go-status', { state: 'available', snapshot: { accounts: [{
    id: 'preview-codex', fileName: 'demo-account.json', provider: 'codex', account: 'Demo workspace', plan: 'Demo',
    groups: [{ title: 'Usage', quotas: [
      { label: 'Five-hour window', remainingPct: 76, resetAt: new Date(now + 7200000).toISOString() },
      { label: 'Weekly window', remainingPct: 64, resetAt: new Date(now + 172800000).toISOString() },
    ] }],
  }] } })
  const segments = [{ text: 'You have ' }, { text: '3 active sessions', icon: 'sessions' },
    { text: ' and ' }, { text: '2 plants at 63% moisture', icon: 'plants' },
    { text: ' today. Taipei is ' }, { text: '26°C and overcast', icon: 'weather' }, { text: '.' }]
  const briefing = { state: 'live', generatedAt: now, omittedSources: 0, items: [{
    text: segments.map(segment => segment.text).join(''), segments,
    sources: ['pi', 'hydra', 'weather'].map(id => ({ id, label: id, state: 'live', updatedAt: now })),
  }] }
  const prompt = 'What is happening on my desk?'
  const reply = 'Three Pi sessions are working across three workspaces. Your focus timer has 18:42 remaining. Taipei is 26°C with overcast skies, and both plants have current moisture readings.'
  replace('odk-personal-bot-status', { state: 'idle', transcript: prompt, message: reply, briefing })
  ipcMain.handle('odk-personal-bot-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-bot-toggle', () => ({ accepted: true }))
  return { synthetic: true, briefing, prompt, reply, pomodoro: { remaining: '18:42', progress: 0.252, state: 'Focusing · simulated' } }
}

module.exports = { installHomePreviewFixtures }
