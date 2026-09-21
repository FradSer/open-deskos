/**
 * Pi Sessions state capture harness.
 *
 * Loads the shell's own renderer with fixture IPC handlers, drives the Pi
 * Sessions page and the Home tile through the states the plugins define, and
 * writes one PNG per state plus a manifest of the predicates each one was held
 * to. Every capture asserts its own state predicate before and after the shot,
 * so a state this harness cannot reach is reported instead of being photographed
 * as something else. Screenshots are for human review: the assertions that gate
 * them are DOM state, not pixels.
 *
 * Run it against this checkout, or against an installed release on the desk:
 *
 *   electron tests/pi-sessions-states.cjs
 *   ODK_SHELL_ROOT=/opt/open-deskos/current ODK_CAPTURE_DIR=/tmp/states \
 *     electron tests/pi-sessions-states.cjs
 *
 * ODK_CAPTURE_WIDTH / ODK_CAPTURE_HEIGHT capture a narrower window (the shell's
 * own 480x854 and 320x480 cases) instead of the 1920x1280 panel.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RELEASE = process.env.ODK_SHELL_ROOT || path.resolve(__dirname, '..')
const OUT_DIR = process.env.ODK_CAPTURE_DIR || path.join(os.tmpdir(), 'odk-pi-sessions-states')
const WIDTH = Number(process.env.ODK_CAPTURE_WIDTH) || 1920
const HEIGHT = Number(process.env.ODK_CAPTURE_HEIGHT) || 1280
const OVERALL_TIMEOUT_MS = 300000

// The kiosk reaches the Mali-G610 only through this switch set (src/main.js,
// resolveGpuBackend -> 'mali'); without it Chromium loses its GPU process on
// this board and the harness dies before it renders anything. A development
// host renders through its own driver and must keep the default switches.
if (process.platform === 'linux') {
  for (const name of ['ignore-gpu-blocklist', 'enable-gpu-rasterization', 'enable-zero-copy']) app.commandLine.appendSwitch(name)
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'gles-egl')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

const log = (...parts) => console.log('[capture]', ...parts)

/* ---------------------------------------------------------------- fixture */

let scanMode = 'loading'
let eventsMode = 'mixed'
let sourceKind = 'local'

const source = () => (sourceKind === 'ssh'
  ? { kind: 'ssh', label: 'Mac / SSH · macbook' }
  : { kind: 'local', label: 'Local' })

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()

const running = (extra = {}) => ({
  sessionId: 'cap-running-4102', pid: 4102, cwd: '/workspace/open-deskos', workspaceName: 'open-deskos',
  startedAt: minutesAgo(7), updatedAt: minutesAgo(0.3), status: 'running',
  latestGoal: 'Refactor the desk UI layout', activity: 'pnpm test', modifiedFiles: ['src/renderer/shell.js'], ...extra,
})
const settled = (extra = {}) => ({
  sessionId: 'cap-settled-4103', pid: 4103, cwd: '/workspace/notes', workspaceName: 'notes',
  startedAt: minutesAgo(120), updatedAt: minutesAgo(10), status: 'settled',
  latestGoal: 'Review the release notes', modifiedFiles: ['README.md', 'CHANGELOG.md'], ...extra,
})
const exited = (extra = {}) => ({
  sessionId: 'cap-exited-4101', pid: 4101, cwd: '/workspace/history', workspaceName: 'history',
  startedAt: minutesAgo(180), updatedAt: minutesAgo(30), status: 'exited',
  latestGoal: 'Archived session', modifiedFiles: [], ...extra,
})

function sessionsFor(mode) {
  if (mode === 'mixed') return [running(), settled(), exited()]
  if (mode === 'idleOnly') return [settled(), exited()]
  if (mode === 'empty') return []
  if (mode === 'driven') return [running({ hostedPi: true, controlAttribution: { machine: 'macbook', sessionId: 'hosted-8f21' } }), settled(), exited()]
  if (mode === 'many') {
    return [
      running({ sessionId: 'cap-many-1', pid: 5101, cwd: '/workspace/atlas', workspaceName: 'atlas', latestGoal: 'Wire the atlas importer', activity: 'rg --files' }),
      running({ sessionId: 'cap-many-2', pid: 5102, cwd: '/workspace/atlas', workspaceName: 'atlas', latestGoal: 'Add the atlas fixture tests', activity: 'node --test' }),
      running({ sessionId: 'cap-many-3', pid: 5103, cwd: '/workspace/beacon', workspaceName: 'beacon', latestGoal: 'Cut the beacon release', activity: 'pnpm build' }),
      settled({ sessionId: 'cap-many-4', pid: 5104, cwd: '/workspace/beacon', workspaceName: 'beacon', latestGoal: 'Check the beacon changelog' }),
      settled({ sessionId: 'cap-many-5', pid: 5105, cwd: '/workspace/cinder', workspaceName: 'cinder', latestGoal: 'Review the cinder schema' }),
      exited({ sessionId: 'cap-many-6', pid: 5106, cwd: '/workspace/cinder', workspaceName: 'cinder', latestGoal: 'Archive the cinder spike' }),
      exited({ sessionId: 'cap-many-7', pid: 5107, cwd: '/workspace/delta', workspaceName: 'delta', latestGoal: 'Close the delta backlog' }),
      exited({ sessionId: 'cap-many-8', pid: 5108, cwd: '/workspace/delta', workspaceName: 'delta', latestGoal: 'Sweep the delta logs' }),
    ]
  }
  return []
}

function scanFixture() {
  // A scan that answers far beyond this run. A handler that never settles at all
  // surfaced as a rejection on the CM5, which photographed the page in its
  // unavailable state instead of its loading state.
  if (scanMode === 'loading') return new Promise((resolve) => setTimeout(() => resolve({ ok: false, source: source(), error: 'fixture scan never answered', scannedAt: null, summary: null, sessions: [], workspaces: [] }), 600000))
  if (scanMode === 'throw') throw new Error('fixture scan failed')
  if (scanMode === 'unavailable') {
    return { ok: false, source: source(), error: 'pi task host unavailable', scannedAt: null, summary: null, sessions: [], workspaces: [] }
  }
  const sessions = sessionsFor(scanMode)
  const statuses = sessions.map((session) => session.status)
  return {
    ok: true,
    scannedAt: Date.now(),
    source: source(),
    summary: {
      total: sessions.length,
      running: statuses.filter((status) => status === 'running').length,
      settled: statuses.filter((status) => status === 'settled').length,
      exited: statuses.filter((status) => status === 'exited').length,
      workspacesCount: new Set(sessions.map((session) => session.workspaceName)).size,
    },
    workspaces: [],
    sessions,
  }
}

const DETAIL_EVENTS = [
  { kind: 'user', text: 'Refactor the desk UI for the CM5 panel' },
  { kind: 'thinking', text: 'Reading the page layout before changing it' },
  { kind: 'tool', toolName: 'bash', text: 'bash: pnpm test' },
  {
    kind: 'result',
    toolName: 'bash',
    text: [
      'diff --git a/src/renderer/shell.css b/src/renderer/shell.css',
      'index 5e3564b..f21fcd9 100644',
      '--- a/src/renderer/shell.css',
      '+++ b/src/renderer/shell.css',
      '@@ -2343,13 +2343,7 @@ body.kiosk {',
      '-  visibility: hidden;',
      '-  font-size: var(--odk-text-body);',
      '+  display: none;',
    ].join('\n'),
  },
  {
    // A table lives in a result event here on purpose: the renderer's table
    // reading is scoped to result events, and a table in any other kind is the
    // defect reported with these captures (see the README note).
    kind: 'result',
    toolName: 'bash',
    text: [
      '| Filter | Count |',
      '| --- | --- |',
      '| Live | 2 |',
      '| Working | 1 |',
      '| Idle | 1 |',
    ].join('\n'),
  },
  {
    kind: 'assistant',
    text: [
      '### What changed',
      '',
      'The overview cell no longer reserves a column for a cursor that only a',
      'local keyboard can move, and the filter buttons state their own counts.',
      '',
      '- The grid is one column of rows.',
      '- The Quota page leads with the auth file.',
      '',
      'Run `pnpm test` before reviewing.',
    ].join('\n'),
  },
  { kind: 'assistant', text: 'See https://example.test/sessions for the log.' },
]

function eventsFixture() {
  if (eventsMode === 'loading') return new Promise(() => {})
  if (eventsMode === 'throw') throw new Error('fixture session log unreadable')
  if (eventsMode === 'unsupported') return { ok: false, reason: 'source-unsupported' }
  if (eventsMode === 'mixed') return { ok: true, truncated: false, events: DETAIL_EVENTS }
  if (eventsMode === 'truncated') {
    return {
      ok: true,
      truncated: true,
      events: [
        DETAIL_EVENTS[0],
        DETAIL_EVENTS[2],
        { kind: 'result', toolName: 'bash', text: 'bash: 4112 passing', truncated: true },
        DETAIL_EVENTS[5],
        DETAIL_EVENTS[6],
      ],
    }
  }
  if (eventsMode === 'empty') return { ok: true, truncated: false, events: [] }
  for (const reason of ['no-reported-events', 'session-log-missing', 'session-log-unreadable', 'session-log-tail-limit']) {
    if (eventsMode === reason) return { ok: false, reason }
  }
  return { ok: false, reason: 'session-log-missing' }
}

/* ------------------------------------------------------------------ driver */

async function waitFor(win, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // Strictly true: the state predicates below are expressions, and an `||`
    // fallback inside one of them makes the whole expression a non-empty string,
    // which would satisfy a truthy check without the state ever being reached.
    if (await win.webContents.executeJavaScript(expression, true) === true) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

const pageIndexExpression = (pageId) => `[...document.querySelectorAll('#pages-track .page')].findIndex(page => page.dataset.pageId === ${JSON.stringify(pageId)})`

async function gotoPage(win, pageId) {
  await win.webContents.executeJavaScript(`(() => {
    const index = ${pageIndexExpression(pageId)}
    const dot = document.querySelectorAll('#dots .dot')[index]
    if (dot) dot.click()
    return index
  })()`, true)
  const settled = await waitFor(win, `(() => {
    const page = document.querySelectorAll('#pages-track .page')[${pageIndexExpression(pageId)}]
    return Boolean(page) && Math.abs(page.getBoundingClientRect().left) < 2
  })()`)
  if (!settled) throw new Error(`page ${pageId} did not settle in the viewport`)
}

async function settleFrame(win) {
  // A hidden window's compositor can lag its DOM, so a capture taken the moment
  // the predicate holds photographs the previous frame. Wait for two presented
  // frames — bounded, because a throttled window may never produce one.
  await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const done = () => resolve(true)
    const timer = setTimeout(done, 500)
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); done() }))
  })`, true)
  await new Promise((resolve) => setTimeout(resolve, 120))
}

const SURFACE = process.env.ODK_CAPTURE_SURFACE !== '0'

async function saveCapture(win, file, clip) {
  await settleFrame(win)
  const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    // fromSurface reads the compositor's last presented frame, and a hidden
    // window may not have presented one since a much earlier state: the capture
    // then photographs the wrong state while the DOM is already correct.
    // Rendering from the renderer's own paint forces this state onto the canvas.
    fromSurface: SURFACE,
    captureBeyondViewport: false,
    clip: { ...clip, scale: 1 },
  })
  const buffer = Buffer.from(shot.data, 'base64')
  if (buffer.length === 0) throw new Error(`empty capture: ${file}`)
  fs.writeFileSync(file, buffer)
}

const results = []

async function capture(win, name, predicate, label, timeoutMs = 15000) {
  const bounds = { x: 0, y: 0, width: WIDTH, height: HEIGHT }
  const reached = await waitFor(win, predicate, timeoutMs)
  const file = path.join(OUT_DIR, `${name}.png`)
  if (reached) await saveCapture(win, file, bounds)
  const held = reached && await win.webContents.executeJavaScript(predicate, true) === true
  results.push({ name, label, reached: held, file: held ? file : null })
  log(`${held ? 'CAPTURED' : 'UNREACHABLE'} ${name} — ${label}`)
  if (!held) log(`  predicate=${reached} still-holding=${held}: ${predicate}\n  observed: ${await win.webContents.executeJavaScript(`JSON.stringify({ subtitle: ${SUBTITLE}, region: document.querySelector("#pages-track .page[data-page-id='pi-sessions'] #pi-overview-list")?.textContent || null, cells: document.querySelectorAll("#pages-track .page[data-page-id='pi-sessions'] .pi-overview-cell").length, tileTag: document.querySelector("[data-widget='odk.tile.pi-sessions'] .pi-widget-tag-label")?.textContent || null })`, true)}`)
}

const widgetBounds = (id) => `(() => {
  const node = document.querySelector('[data-widget=${JSON.stringify(id)}]')
  if (!node) return null
  node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  const rect = node.getBoundingClientRect()
  return { x: Math.ceil(rect.left), y: Math.ceil(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) }
})()`

async function captureTile(win, name, predicate, label) {
  const reached = await waitFor(win, predicate)
  const bounds = reached ? await win.webContents.executeJavaScript(widgetBounds('odk.tile.pi-sessions'), true) : null
  const inside = bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= WIDTH && bounds.y + bounds.height <= HEIGHT
  const file = path.join(OUT_DIR, `${name}.png`)
  if (reached && inside) await saveCapture(win, file, bounds)
  const held = reached && inside && await win.webContents.executeJavaScript(predicate, true) === true
  results.push({ name, label, reached: held, file: held ? file : null })
  log(`${held ? 'CAPTURED' : 'UNREACHABLE'} ${name} — ${label}`)
  if (!held) log(`  predicate=${reached} inside=${inside} bounds=${JSON.stringify(bounds)}`)
}

async function applyScan(win, mode, predicate = `true`) {
  scanMode = mode
  if (!await waitFor(win, predicate, 20000)) throw new Error(`scan mode ${mode} never reached: ${predicate}`)
}

/* The event read is owned by the page, not by the harness: it runs on a
 * selection or filter change, so a new fixture state needs one of those to be
 * picked up. Selecting the other session is the smallest real trigger. */
async function applyEvents(win, mode, predicate = `true`) {
  eventsMode = mode
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('#pages-track .page[data-page-id="pi-sessions"]')
    const cell = page.querySelector('.pi-overview-cell:not(.is-selected)') || page.querySelector('.pi-overview-cell')
    if (!cell) return false
    cell.click()
    return true
  })()`, true)
  if (!clicked) throw new Error('no session cell to select for an event reload')
  if (!await waitFor(win, predicate, 12000)) throw new Error(`events mode ${mode} never reached: ${predicate}`)
}

/** The Overview is a cover over the detail, so both states are driven from the
 *  page's own input rather than from the DOM by hand. */
const DETAIL_OPEN = `(() => {
  const page = document.querySelector('#pages-track .page[data-page-id="pi-sessions"]')
  return page.querySelector('#pi-overview').hidden === true && page.querySelector('#pi-detail').inert === false
})()`

async function openDetail(win) {
  await win.webContents.executeJavaScript(`document.querySelector('#pages-track .page[data-page-id="pi-sessions"] .pi-overview-cell').click()`, true)
  if (!await waitFor(win, DETAIL_OPEN)) throw new Error('the session detail did not open')
}

async function showList(win) {
  await win.webContents.executeJavaScript(`document.querySelector('#pages-track .page[data-page-id="pi-sessions"]').dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))`, true)
  if (!await waitFor(win, `document.querySelector('#pages-track .page[data-page-id="pi-sessions"] #pi-overview').hidden === false`)) throw new Error('the session overview did not reopen')
}

const SUBTITLE = '(document.querySelector("#pages-track .page[data-page-id=\'pi-sessions\'] #pi-view-subtitle")?.textContent || "")'
const CELLS = '(document.querySelectorAll("#pages-track .page[data-page-id=\'pi-sessions\'] .pi-overview-cell").length)'
const EVENT_COUNT = '(document.querySelectorAll("#pages-track .page[data-page-id=\'pi-sessions\'] #pi-events .pi-event").length)'
const EVENT_COUNT_SEVEN = `${EVENT_COUNT} === 7`
const FILTERS_EXPR = '(document.querySelectorAll("#pages-track .page[data-page-id=\'pi-sessions\'] #pi-overview-filters .pi-filter-btn").length)'
const NOTE = '(document.querySelector("#pages-track .page[data-page-id=\'pi-sessions\'] .pi-empty-state")?.textContent || "")'
const EVENT_NOTE = '(document.querySelector("#pages-track .page[data-page-id=\'pi-sessions\'] #pi-events-host .pi-detail-note")?.textContent || "")'
const TILE_COUNT = '(document.querySelector("[data-widget=\'odk.tile.pi-sessions\'] .pi-widget-count")?.textContent || "")'
const TILE_TAG = '(document.querySelector("[data-widget=\'odk.tile.pi-sessions\'] .pi-widget-tag-label")?.textContent || "")'
const TILE_SUMMARY = '(document.querySelector("[data-widget=\'odk.tile.pi-sessions\'] .pi-widget-summary")?.textContent || "")'

async function clickFilter(win, filter) {
  await win.webContents.executeJavaScript(`document.querySelector('#pages-track .page[data-page-id="pi-sessions"] .pi-filter-btn[data-filter="${filter}"]').click()`, true)
  await waitFor(win, `document.querySelector('#pages-track .page[data-page-id="pi-sessions"] .pi-filter-btn.active')?.dataset.filter === ${JSON.stringify(filter)}`)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, useContentSize: true, frame: false, show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(RELEASE, 'src/preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, backgroundThrottling: false,
    },
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`renderer[${sourceId}:${line}] ${message}`)
  })
  await win.loadFile(path.join(RELEASE, 'src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  if (!await waitFor(win, `Boolean(window.__odkGrid) && document.querySelectorAll('#dots .dot').length === 5`, 30000)) {
    throw new Error('the shell did not build its pages')
  }
  await win.webContents.executeJavaScript(`Promise.all([
    document.fonts.load('700 32px "Montserrat"'),
    document.fonts.load('400 16px "Noto Sans SC"'),
    document.fonts.load('400 16px "Zpix"'),
  ]).then(() => document.fonts.ready)`, true)
  await new Promise((resolve) => setTimeout(resolve, 300))

  /* Home tile: loading is the state before the first scan resolves. */
  await gotoPage(win, 'home')
  await captureTile(win, 'tile-01-loading', `${TILE_COUNT} === '--' && ${TILE_TAG} === 'READING' && ${TILE_SUMMARY} === 'Not scanned yet'`, 'Home tile before the first scan resolves')

  /* Pi Sessions page: the page's own first paint, before any scan. */
  await gotoPage(win, 'pi-sessions')
  await capture(win, 'page-01-loading', `${SUBTITLE} === 'Loading Pi sessions...' && ${FILTERS_EXPR} === 5`, 'Session Overview while the first scan is in flight', 40000)

  await applyScan(win, 'mixed', `${SUBTITLE}.includes('session') && ${CELLS} === 2`)
  await capture(win, 'page-02-live', `${CELLS} === 2 && document.querySelector('#pages-track .page[data-page-id="pi-sessions"] .pi-filter-btn.active')?.dataset.filter === 'live'`, 'Live filter: the page landing state with one working and one idle session')

  await openDetail(win)
  await capture(win, 'page-03-detail-open', `${DETAIL_OPEN} && ${EVENT_COUNT_SEVEN}`, 'One session opened: the detail body and the session event stream')
  await showList(win)

  await clickFilter(win, 'working')
  await capture(win, 'page-04-filter-working', `${CELLS} === 1`, 'Working filter: only the running session')
  await clickFilter(win, 'idle')
  await capture(win, 'page-05-filter-idle', `${CELLS} === 1`, 'Idle filter: only the settled session')
  await clickFilter(win, 'exited')
  await capture(win, 'page-06-filter-exited', `${CELLS} === 1`, 'Exited filter: only the historical session')
  await clickFilter(win, 'all')
  await capture(win, 'page-07-filter-all', `${CELLS} === 3`, 'All filter: working, idle and exited together')

  await applyScan(win, 'many', `${CELLS} === 8`)
  await capture(win, 'page-08-many', `${CELLS} === 8`, 'All filter with four workspaces and eight sessions')

  await applyScan(win, 'empty', `${CELLS} === 0 && ${NOTE}.includes('No session matches')`)
  await capture(win, 'page-09-empty', `${NOTE} === 'No session matches All.'`, 'Empty scan: the page states that nothing matches the filter')

  await applyScan(win, 'unavailable', `${SUBTITLE}.includes('unavailable')`)
  await capture(win, 'page-10-unavailable', `${SUBTITLE}.includes('unavailable') && document.querySelector('#pages-track .page[data-page-id="pi-sessions"] .pi-filter-count')?.textContent === '--'`, 'Unavailable source: counts are withheld, not shown as zero')

  await applyScan(win, 'throw', `${SUBTITLE}.includes('unavailable')`)
  await capture(win, 'page-11-scan-throw', `${SUBTITLE}.includes('unavailable')`, 'Rejected scan is reported as unavailable rather than as an empty desk')

  /* Home tile states. */
  await gotoPage(win, 'home')
  await applyScan(win, 'mixed', `${TILE_COUNT} === '1' && ${TILE_TAG} === 'Working...'`)
  await captureTile(win, 'tile-02-working', `${TILE_TAG} === 'Working...'`, 'Home tile with a running session: goal and activity')
  await capture(win, 'home-02-working', `${TILE_TAG} === 'Working...'`, 'Home page while a session is running')
  await applyScan(win, 'idleOnly', `${TILE_TAG} === 'IDLE' && ${TILE_SUMMARY}.includes('live')`)
  await captureTile(win, 'tile-03-idle', `${TILE_TAG} === 'IDLE' && ${TILE_SUMMARY}.includes('1 live')`, 'Home tile with live but idle sessions')
  await applyScan(win, 'empty', `${TILE_SUMMARY}.includes('0 workspaces')`)
  await captureTile(win, 'tile-04-empty', `${TILE_SUMMARY}.includes('0 workspaces')`, 'Home tile with no sessions at all')
  await applyScan(win, 'unavailable', `${TILE_TAG} === 'OFFLINE'`)
  await captureTile(win, 'tile-05-offline', `${TILE_TAG} === 'OFFLINE' && ${TILE_SUMMARY} === 'Local · Retrying automatically'`, 'Home tile when the scanner reports unavailable')
  await applyScan(win, 'throw', `${TILE_TAG} === 'ERROR'`)
  await captureTile(win, 'tile-06-error', `${TILE_TAG} === 'ERROR' && ${TILE_SUMMARY} === 'Retrying automatically'`, 'Home tile when the scan itself rejects')

  /* Session Detail states. The Overview is a cover, so every one of these is
   * shot with the cover open onto the detail. */
  await gotoPage(win, 'pi-sessions')
  await applyScan(win, 'mixed', `${CELLS} === 3`)
  await clickFilter(win, 'live')
  if (!await waitFor(win, `${CELLS} === 2`)) throw new Error('the live filter did not narrow to two sessions')

  await applyEvents(win, 'mixed', `${DETAIL_OPEN} && ${EVENT_COUNT_SEVEN}`)
  await capture(win, 'page-12-events', `${DETAIL_OPEN} && ${EVENT_COUNT_SEVEN}`, 'Session Detail: Pi event kinds, a diff result, a result table and a Markdown reply')

  await applyEvents(win, 'truncated', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('Some session events are not shown')`)
  await capture(win, 'page-13-events-truncated', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('Some session events are not shown')`, 'Session Detail: the retained window does not cover the whole log')

  await applyEvents(win, 'empty', `${DETAIL_OPEN} && ${EVENT_NOTE} === 'No session events recorded yet.'`)
  await capture(win, 'page-14-no-events', `${DETAIL_OPEN} && ${EVENT_NOTE} === 'No session events recorded yet.'`, 'Session Detail: the session reported no events')

  await applyEvents(win, 'no-reported-events', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('has not reported any events')`)
  await capture(win, 'page-15-not-reported', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('has not reported any events')`, 'Session Detail: no events reported for the session')

  await applyEvents(win, 'session-log-missing', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('No session log is available')`)
  await capture(win, 'page-16-log-missing', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('No session log is available')`, 'Session Detail: no session log on the desk')

  await applyEvents(win, 'session-log-tail-limit', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('2 MiB')`)
  await capture(win, 'page-17-tail-limit', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('2 MiB')`, 'Session Detail: recent output exceeds the log-reading limit')

  await applyEvents(win, 'throw', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('could not be read')`)
  await capture(win, 'page-18-log-unreadable', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('could not be read')`, 'Session Detail: the log exists but could not be read')

  await applyEvents(win, 'loading', `${DETAIL_OPEN} && ${EVENT_NOTE} === 'Reading session events...'`)
  await capture(win, 'page-19-events-loading', `${DETAIL_OPEN} && ${EVENT_NOTE} === 'Reading session events...'`, 'Session Detail while the event read is in flight')

  // The source only changes on a scan tick, and the page re-reads the event state
  // on that same tick, so this waits for the scan rather than for a click. The
  // source label lives in the Overview's own subtitle, not in the detail's path.
  sourceKind = 'ssh'
  await applyScan(win, 'mixed', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('unavailable for Mac / SSH')`)
  await capture(win, 'page-20-remote-unsupported', `${DETAIL_OPEN} && ${EVENT_NOTE}.includes('unavailable for Mac / SSH')`, 'Session Detail: a remote source keeps its events elsewhere')

  await showList(win)
  await capture(win, 'page-21-remote-source', `${SUBTITLE}.includes('Mac / SSH · macbook')`, 'Session Overview: the page names the remote source it reads')
  sourceKind = 'local'

  await applyScan(win, 'driven', `${SUBTITLE}.includes('Driven by')`)
  await capture(win, 'page-22-driven', `${SUBTITLE}.includes('Driven by macbook · hosted-8f21')`, 'Session Overview: a Console is driving a Hosted Pi on this desk')

  const missing = results.filter((result) => !result.reached)
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    release: RELEASE,
    capturedAt: new Date().toISOString(),
    viewport: { width: WIDTH, height: HEIGHT },
    states: results,
    unreachable: missing.map((result) => result.name),
  }, null, 2)}\n`)
  for (const result of results) log(`${result.reached ? 'PASS' : 'FAIL'} ${result.name}`)
  log(`CAPTURE_RESULT ${JSON.stringify({ captured: results.length - missing.length, total: results.length, unreachable: missing.map((result) => result.name) })}`)
  return missing.length === 0 ? 0 : 1
}

const timeout = setTimeout(() => { console.error('[capture] timed out'); app.exit(1) }, OVERALL_TIMEOUT_MS)
app.whenReady().then(async () => {
  ipcMain.handle('odk-pi-sessions', () => scanFixture())
  ipcMain.handle('odk-pi-session-events', () => eventsFixture())
  ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured', missing: ['ODK_CLIPROXY_MANAGEMENT_KEY_FILE'] }))
  ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
  ipcMain.handle('odk-camera-frame', () => ({ status: 'unavailable', frame: null, capturedAt: null }))
  ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
  ipcMain.handle('odk-futu-holdings', () => ({ state: 'live', service: 'futu-poller', updatedAt: Date.now(), snapshot: { totals: { marketVal: 313835.5, plVal: 5946.95, plRatio: 0.0193 }, positions: [{ code: 'US.TEM', marketVal: 7311, dayRatio: 0.031 }, { code: 'US.SDGR', marketVal: 5373, dayRatio: -0.012 }, { code: 'US.TSLA', marketVal: 7067, dayRatio: 0.0074 }] } }))
  ipcMain.handle('odk-weather-status', () => ({ status: 'live', place: 'Shenzhen', current: { temperature: 25, unit: '°C', condition: 'Partly cloudy', sky: 'cloud', code: 2 }, daily: { high: 27, low: 21 }, updatedAt: Date.now(), hint: null, error: null }))
  ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
  ipcMain.handle('odk-user-apps-dispatch', () => ({ ok: false, error: 'fixture does not install applications' }))
  ipcMain.handle('odk-app-manager-list', () => [])
  ipcMain.handle('odk-app-manager-state', () => null)
  ipcMain.handle('odk-app-manager-intent', () => ({ ok: false, error: 'fixture does not dispatch intents' }))
  ipcMain.handle('odk-remote-publish-page-state', () => true)
  ipcMain.handle('odk-voice-status', () => ({ state: 'unavailable', message: 'Voice service unavailable' }))
  ipcMain.handle('odk-voice-toggle', () => false)
  try {
    const code = await main()
    clearTimeout(timeout)
    app.exit(code)
  } catch (error) {
    clearTimeout(timeout)
    console.error('[capture] failed:', error)
    app.exit(1)
  }
})