'use strict'

const { installGeometryFixtures } = require('./live-fixtures')

// Representative success data belongs to this preview, not to the runtime or
// the shared geometry/failure fixtures. All times and facts share one snapshot.
function installHomePreviewFixtures(ipcMain, { now = Date.now() } = {}) {
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
  const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400" role="img" aria-label="Synthetic reading cover">
    <rect width="300" height="400" fill="#e8e3d5"/>
    <rect x="0" y="0" width="16" height="400" fill="#52624f"/>
    <text x="40" y="68" font-family="sans-serif" font-size="18" fill="#52624f">PREVIEW EDITION</text>
    <text x="38" y="125" font-family="sans-serif" font-size="42" fill="#25372d">READING</text>
    <text x="38" y="173" font-family="sans-serif" font-size="42" fill="#25372d">NOTES</text>
    <path d="M40 230h220M40 244h180M40 258h200" stroke="#8e9a82" stroke-width="4"/>
    <text x="40" y="360" font-family="sans-serif" font-size="16" fill="#52624f">SYNTHETIC SAMPLE</text>
  </svg>`
  const highlight = { title: '阅读笔记（合成示例）', author: '示例作者',
    markText: '把每一次微小的改变累积起来，最终会带来意想不到的结果。',
    createTime: now, cover: 'data:image/svg+xml;base64,' + Buffer.from(cover).toString('base64') }
  replace('odk-weread-highlight', { status: 'live', highlight })
  const segments = [{ text: 'You have ' }, { text: '3 active sessions', icon: 'sessions' },
    { text: ' and ' }, { text: '2 plants at 63% moisture', icon: 'plants' },
    { text: ' today. Taipei is ' }, { text: '26°C and overcast', icon: 'weather' }, { text: '.' }]
  const briefing = { state: 'live', generatedAt: now, omittedSources: 0, items: [{
    text: segments.map(segment => segment.text).join(''), segments,
    sources: ['pi', 'hydra', 'weather'].map(id => ({ id, label: id, state: 'live', updatedAt: now })),
  }] }
  // Synthetic training and v8 progress illustrate assistant updates, never live reports.
  const prompt = ''
  const reply = ''
  const source = { key: 'a'.repeat(64), revision: 'b'.repeat(64), machine: 'Synthetic Mac', sessionId: 'synthetic-training', project: '/synthetic/training', control: 'report_only', availability: 'live' }
  const updates = ['中文识别训练有新进展：验证集 CER 降到 37.35%，最佳和最后检查点已保存到 Drive。控制器仍依赖 Mac 在线，请暂时保留原终端；独立测试还没做。', 'v8 模型完成：前留白缩到 10 mm，前两角改为 R12，可编辑模型包已生成。原键盘和触控板位置未改；实体下盖与触控板仍需试装。']
  const remote = { state: 'live', total: 3, messages: [
    ...updates.map((text, index) => ({ id: `synthetic-update-${index}`, text, presentation: 'assistant_update', sources: [{ ...source, ...(index === 1 ? { key: 'c'.repeat(64), sessionId: 'synthetic-v8', project: '/synthetic/v8' } : {}) }], verification: 'reported_unverified', synthesisVerification: 'passed' })).reverse(),
    { id: 'synthetic-earlier-report', text: 'Synthetic earlier report: source revision and execution audit remain available here.', sources: [source], verification: 'reported_unverified', synthesisVerification: 'passed' },
  ] }
  replace('odk-personal-bot-status', { state: 'idle', jev: {status:'verified'}, transcript: prompt, message: reply, briefing, remote })
  ipcMain.handle('odk-personal-bot-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-bot-toggle', () => ({ accepted: true }))
  return { synthetic: true, briefing, prompt, reply, updates, remote, highlight }
}

module.exports = { installHomePreviewFixtures }
