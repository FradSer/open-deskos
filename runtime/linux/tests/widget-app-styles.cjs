const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const { resolvePages } = require('./helpers/pages')

const root = path.resolve(__dirname, '..')
const longPath = `/workspace/${'long-workspace-segment/'.repeat(8)}project`
let quota = { state: 'unconfigured' }
// Layout ids resolve to page positions once the renderer is loaded.
let PAGES = { dot: () => { throw new Error('pages not resolved') }, surface: () => { throw new Error('pages not resolved') } }
let completeQuotaRefresh = null
let scanFails = false
let sessions = {
  source: { kind: 'local', label: 'Local' },
  summary: { running: 2, settled: 0, total: 2, workspacesCount: 2 },
  sessions: [{
    status: 'running', pid: 4102, uuid: 'session-identifier-'.repeat(6),
    workspaceName: 'Desk runtime', cwd: longPath, startedAt: Date.now() - 60000,
    latestGoal: 'Keep complete process details readable at every supported window size.',
    command: `pi --session ${longPath}/session.jsonl`,
    modifiedFiles: [`${longPath}/renderer/surface.js`],
    activity: 'bash: pnpm test',
  }, {
    status: 'running', pid: 4207, uuid: 'second-session-identifier-'.repeat(4),
    workspaceName: 'Second desk', cwd: '/workspace/second', startedAt: Date.now() - 120000,
    latestGoal: '<skill name="marketing" location="/test/SKILL.md">\nInstructions\n</skill>\n\nLaunch the beta campaign.',
    command: 'pi --resume',
    modifiedFiles: [],
    activity: 'thinking: reviewing the switcher',
  }],
}
const sessionEventKinds = ['user', 'thinking', 'tool', 'result', 'assistant']
let sessionEvents = {
  ok: true,
  truncated: true,
  events: Array.from({ length: 40 }, (_, index) => ({
    kind: sessionEventKinds[index % sessionEventKinds.length],
    text: `session event line ${index + 1} of a bounded operating stream`,
  })),
}
const endpoint = createAppManagerEndpoint()
ipcMain.handle('odk-opencode-go-status', () => completeQuotaRefresh
  ? new Promise(resolve => { completeQuotaRefresh = () => resolve(quota) })
  : quota)
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
// A 1x1 PNG keeps the camera tile's frame live without a camera peripheral, so
// the framing marks can be checked against real painted content.
const CAMERA_FRAME_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAAH/q842iQAAAABJRU5ErkJggg=='
let cameraFrame = { status: 'live', frame: CAMERA_FRAME_DATA_URL, capturedAt: Date.now() }
ipcMain.handle('odk-camera-frame', () => cameraFrame)

ipcMain.handle('odk-pi-sessions', () => {
  if (scanFails) throw new Error('Scanner test failure')
  return sessions
})
ipcMain.handle('odk-pi-session-events', () => {
  if (scanFails) throw new Error('Scanner test failure')
  return sessionEvents
})
ipcMain.handle('odk-app-manager-list', () => endpoint.list())
ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
ipcMain.handle('odk-app-manager-state', (_event, id) => endpoint.get(id))
let publishedRemoteState = null
ipcMain.handle('odk-remote-publish-page-state', (_event, state) => { publishedRemoteState = state; return true })
ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
ipcMain.handle('odk-futu-holdings', () => ({ state: 'live', service: 'futu-poller', snapshot: { totals: { marketVal: 313835.5, plVal: 5946.95, plRatio: 0.0193 }, positions: [ { code: 'US.TEM', marketVal: 7311, dayRatio: 0.031 }, { code: 'US.SDGR', marketVal: 5373, dayRatio: -0.012 }, { code: 'US.TSLA', marketVal: 7067, dayRatio: 0.0074 } ] }, updatedAt: Date.now() }))
ipcMain.handle('odk-weather-status', () => ({ status: 'live', place: 'Shenzhen', current: { temperature: 25, unit: '°C', condition: 'Partly cloudy', sky: 'cloud', code: 2 }, daily: { high: 27, low: 21 }, updatedAt: Date.now(), hint: null, error: null }))
ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function check(name, value, detail) {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`)
  if (!value) {
    failures += 1
    if (detail) console.log(JSON.stringify(detail))
  }
}

async function resize(win, width, height) {
  win.setContentSize(width, height)
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
  for (let i = 0; i < 100; i += 1) {
    // Both axes must settle: waiting on width alone measures a stale row height,
    // which reports spurious text overflow against not-yet-resized tiles.
    if (await win.webContents.executeJavaScript(`window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)) break
    await delay(20)
  }
  await delay(300)
}

async function page(win, index) {
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${index}].click()`)
  await delay(300)
}

async function widgets(win, label) {
  await page(win, PAGES.dot('home'))
  const result = await win.webContents.executeJavaScript(`(() => {
    const failures = []
    const tiles = [...document.querySelectorAll('.widget')]
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect()
      if (Math.abs(rect.width - rect.height) > 2 && innerWidth < 1000) failures.push(tile.dataset.app + ': not square')
      for (const el of tile.querySelectorAll('span, strong')) {
        if (!el.textContent.trim() || !el.getClientRects().length) continue
        const r = el.getBoundingClientRect()
        if (r.left < rect.left - 1 || r.right > rect.right + 1 || r.top < rect.top - 1 || r.bottom > rect.bottom + 1 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)) failures.push(tile.dataset.app + ': ' + el.className)
        if (parseFloat(getComputedStyle(el).fontSize) < 12) failures.push(tile.dataset.app + ': small text ' + el.className)
      }
    }
    const page = tiles[0].closest('.page')
    const indicators = [...document.querySelectorAll('.dot')].every(dot => {
      const r = dot.getBoundingClientRect()
      return [r.top + r.height / 2, r.top + 4].every(y => document.elementFromPoint(r.left + r.width / 2, y) === dot)
    })
    // Every grid page contributes tiles; the shell renders them all, so the
    // declared set is the union across grid pages, not just the first one.
    const expected = window.DESKTOP_LAYOUT.pages.filter(page => page.kind === 'grid').flatMap(page => page.widgets.map(widget => widget.id)).sort()
    const actual = tiles.map(tile => tile.dataset.widget).sort()
    return { failures, indicators, identitiesMatch: JSON.stringify(actual) === JSON.stringify(expected), scrollable: page.scrollHeight <= page.clientHeight + 1 || getComputedStyle(page).overflowY === 'auto' }
  })()`)
  check(`${label}: declared Widgets remain readable: ${result.failures.join(', ')}`, result.identitiesMatch && result.failures.length === 0)
  check(`${label}: grid overflow remains reachable`, result.scrollable)
  check(`${label}: page indicators have distinct pointer targets`, result.indicators)
}

async function appPage(win, index, label) {
  await page(win, index)
  const result = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.page[data-page="${index}"] > div')
    const failures = []
    for (const el of surface.querySelectorAll('*')) {
      if (el.closest('[hidden]') || el.classList.contains('sr-only') || el.classList.contains('app-search-label') || !el.getClientRects().length || el instanceof SVGElement) continue
      if (el.scrollWidth > el.clientWidth + 2) failures.push(el.className || el.tagName)
    }
    const controls = [...surface.querySelectorAll('button, input, summary')].filter(el => el.getClientRects().length)
    return {
      failures,
      targets: controls.every(el => el.getBoundingClientRect().height >= 44),
      selectable: getComputedStyle(surface).userSelect === 'text',
      // The retired page chrome stays retired, and the Session Filter that
      // remains lives only inside the Session Overview.
      retiredControls: surface.querySelectorAll('.pi-filter-group, .pi-overview-open, .pi-session-step, .pi-overview-close, .pi-status-badge, .pi-ws-title, .pi-detail-position, #pi-overview-summary, .pi-overview-grid, .pi-overview-name').length === 0,
      filterPlacement: (() => {
        const tabs = [...surface.querySelectorAll('.pi-filter-btn')]
        if (tabs.length === 0) return true
        const group = surface.querySelector('#pi-overview-filters')
        return tabs.length === 5 && Boolean(group) &&
          tabs.every(tab => group.contains(tab)) &&
          tabs.every(tab => !tab.closest('#pi-detail')) &&
          Boolean(surface.querySelector('#pi-overview-list'))
      })(),
    }
  })()`)
  check(`${label}: App ${index} wraps all content: ${result.failures.join(', ')}`, result.failures.length === 0)
  check(`${label}: App ${index} uses touch-sized controls`, result.targets)
  check(`${label}: App ${index} text is selectable`, result.selectable)
  check(`${label}: App ${index} carries no retired session controls`, result.retiredControls)
  check(`${label}: App ${index} keeps the Session Filter inside the Session Overview`, result.filterPlacement)
  const reachable = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.page[data-page="${index}"] > div')
    const controls = [...surface.querySelectorAll('button, input, summary')].filter(el => !el.closest('[hidden]'))
    const bounds = surface.getBoundingClientRect()
    return controls.every(control => {
      control.focus()
      const r = control.getBoundingClientRect()
      // A live-list row can be taller than the scroll viewport: reaching its
      // start is the reachable state then, not fitting it whole.
      if (r.height > bounds.height) return r.top >= bounds.top - 1 && r.top < bounds.bottom - 1
      return r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1
    })
  })()`)

}

// The density harness measures boxes, so it cannot see a frame painting over the
// marks. Hit testing follows paint order, which is what this asserts.
async function cameraInstrument(win) {
  await page(win, PAGES.dot('home'))
  const live = await win.webContents.executeJavaScript(`(() => {
    const tile = document.querySelector('.widget[data-widget="odk.tile.camera"]')
    const frame = tile.querySelector('.w-camera-frame')
    const marks = tile.querySelector('.w-camera-marks')
    const rect = marks.getBoundingClientRect()
    const probe = document.elementFromPoint(rect.left + rect.width * 0.14, rect.top + rect.height * 0.14)
    return {
      frameLive: frame.hidden === false && frame.getAttribute('src') !== null,
      marksAboveFrame: probe === marks || marks.contains(probe),
      hit: probe ? probe.tagName.toLowerCase() : null,
    }
  })()`)
  check('Camera: a live frame does not paint over the framing marks', live.frameLive && live.marksAboveFrame, live)
}

async function contrastAndMotion(win) {
  await page(win, PAGES.dot('pi-sessions'))
  // The transcript is the page's reading surface, so show a live session.
  await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('${PAGES.surface('pi-sessions')} .pi-app-wrapper')
    if (!surface.querySelector('#pi-overview').hidden) surface.querySelector('.pi-overview-cell')?.click()
  })()`)
  await delay(150)
  const ratios = await win.webContents.executeJavaScript(`(() => {
    const luma = value => {
      const rgb = value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
        v /= 255
        return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
      })
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
    }
    return ['.pi-overview-path', '#pi-view-facts', '.pi-goal-text', '.pi-event-text'].map(selector => {
      const el = document.querySelector(selector)
      const fg = luma(getComputedStyle(el).color)
      let bg = el
      while (getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement
      const value = luma(getComputedStyle(bg).backgroundColor)
      return { selector, ratio: (Math.max(fg, value) + .05) / (Math.min(fg, value) + .05) }
    })
  })()`)
  for (const { selector, ratio } of ratios) check(`${selector}: contrast ${ratio.toFixed(2)}:1`, ratio >= 4.5)
  await win.webContents.debugger.attach('1.3')
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const reduced = await win.webContents.executeJavaScript(`['.pi-overview-cell', '.button-pill'].every(s => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).transitionDuration.split(', ').every(v => parseFloat(v) === 0))`)
    check('App controls respect reduced motion', reduced)
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
    // The chosen live row is the page's own control, so it owns the ring.
    await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('${PAGES.surface('pi-sessions')}')
      const surface = page.querySelector('.pi-app-wrapper')
      if (surface.querySelector('#pi-overview').hidden) page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
    })()`)
    await delay(120)
    await win.webContents.debugger.sendCommand('DOM.enable')
    await win.webContents.debugger.sendCommand('CSS.enable')
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument')
    let nodeId = 0
    for (let attempt = 0; attempt < 40 && !nodeId; attempt += 1) {
      ;({ nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.pi-overview-cell.is-selected' }))
      if (!nodeId) await delay(25)
    }
    let focus = false
    if (nodeId) {
      await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] })
      focus = await win.webContents.executeJavaScript(`(() => {
        const row = document.querySelector('${PAGES.surface('pi-sessions')} .pi-overview-cell.is-selected')
        return row.matches(':focus-visible') && getComputedStyle(row).outlineStyle === 'solid' && parseFloat(getComputedStyle(row).outlineWidth) >= 2
      })()`)
    }
    check('the chosen live row has a complete keyboard focus ring', focus)
  } finally {
    await win.webContents.debugger.detach()
  }
}

async function pressKey(win, keyCode) {
  await win.webContents.executeJavaScript(`window.addEventListener('keydown', event => {
    setTimeout(() => { window.__interiorKey = { key: event.key, prevented: event.defaultPrevented } }, 0)
  }, { once: true, capture: true })`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  await delay(200)
  return win.webContents.executeJavaScript(`(() => {
    const result = window.__interiorKey
    delete window.__interiorKey
    return result
  })()`)
}

async function scrollState(win, selector) {
  return win.webContents.executeJavaScript(`(() => ({
    top: document.querySelector('${selector}').scrollTop,
    page: document.querySelector('.dot.active').getAttribute('aria-label'),
    focus: document.activeElement.id || document.activeElement.dataset.filter || document.activeElement.getAttribute('aria-label'),
  }))()`)
}

async function keyboardScrolling(win) {
  await resize(win, 320, 480)
  await page(win, PAGES.dot('home'))
  const selector = PAGES.surface('home')
  await win.webContents.executeJavaScript(`document.querySelector('.dot.active').focus(); document.querySelector('${selector}').scrollTop = 0`)
  const initial = await scrollState(win, selector)
  for (const keyCode of ['Down', 'Up']) {
    const event = await pressKey(win, keyCode)
    const state = await scrollState(win, selector)
    const moved = keyCode === 'Down' ? state.top > initial.top : state.top === initial.top
    check(`keyboard ${keyCode} scrolls Home without changing pages`, event?.prevented === true && moved && state.page === initial.page)
  }
}

async function editableKeyboard(win) {
  await win.webContents.executeJavaScript(`window.odkAppPlatform.openApp({ appId: 'app-manager' })`)
  await delay(150)
  const selector = '#app-runtime .runtime-app'
  await win.webContents.executeJavaScript(`const input = document.querySelector('#app-runtime .app-search'); input.value = 'abcdef'; input.focus()`)
  const initial = await scrollState(win, selector)
  for (const keyCode of ['Up', 'Down', 'Left', 'Right']) {
    await win.webContents.executeJavaScript(`document.querySelector('#app-runtime .app-search').setSelectionRange(3, 3)`)
    const event = await pressKey(win, keyCode)
    const value = await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#app-runtime .app-search')
      return { text: input.value, caret: input.selectionStart, focused: document.activeElement === input }
    })()`)
    const state = await scrollState(win, selector)
    const caret = keyCode === 'Left' ? value.caret === 2 : keyCode === 'Right' ? value.caret === 4 : true
    check(`an editable App control keeps ${keyCode} native without paging`, event?.prevented === false && value.focused && value.text === 'abcdef' && caret && state.page === initial.page)
  }
  await win.webContents.executeJavaScript(`window.odkAppPlatform.closeApp()`)
  await delay(120)

  // Detail focus owns horizontal session movement; page chrome still pages.
  const pager = `${PAGES.surface('pi-sessions')}`
  const detail = `${pager} #pi-detail`
  const savedSessions = sessions
  sessions = {
    source: { kind: 'local', label: 'Local' },
    summary: { running: 1, settled: 0, total: 1, workspacesCount: 1 },
    sessions: [{ status: 'running', pid: 4102, uuid: 'detail-focus', workspaceName: 'Desk runtime', cwd: '/workspace/desk', startedAt: Date.now() - 60000, latestGoal: 'Keep arrow input on this page.', modifiedFiles: [], activity: 'bash: test' }],
  }
  try {
    await page(win, PAGES.dot('pi-sessions'))
    await win.webContents.executeJavaScript(`document.querySelector('${pager} .pi-overview-cell').click()`)
    await delay(120)
    await win.webContents.executeJavaScript(`document.querySelector('${detail}').focus()`)
    const before = await scrollState(win, detail)
    const arrow = await pressKey(win, 'Right')
    const after = await scrollState(win, detail)
    check('a focused Session Detail keeps arrow input on its page', arrow?.prevented === true && after.page === before.page, { arrow, before, after })
    await win.webContents.executeJavaScript(`document.querySelector('.dot.active').focus()`)
    const chromeArrow = await pressKey(win, 'Right')
    const paged = await scrollState(win, detail)
    check('page chrome still offers bounded arrow paging', chromeArrow?.prevented === true && paged.page !== before.page)
  } finally {
    sessions = savedSessions
  }
}

async function nativeAppScrolling(win) {
  await page(win, PAGES.dot('quota'))
  await win.webContents.executeJavaScript(`document.querySelector('#quota-refresh').focus(); document.querySelector('.quota-card').scrollTop = 100`)
  const initial = await scrollState(win, '.quota-card')
  let previous = initial
  for (const keyCode of ['Down', 'Up']) {
    const event = await pressKey(win, keyCode)
    const state = await scrollState(win, '.quota-card')
    const moved = keyCode === 'Down' ? state.top > previous.top : state.top < previous.top
    check(`App ${keyCode} uses native scrolling without paging`, event?.prevented === false && moved && state.page === initial.page, { event, previous, state })
    previous = state
  }
}

async function remoteInput(win, input) {
  win.webContents.send('odk-remote-input', { input })
  await delay(100)
}

async function remoteAction(win, action) {
  win.webContents.send('odk-remote-input', { input: 'action', action })
  await delay(100)
}

async function remoteScrollingIsolation(win) {
  const original = sessions
  const startedAt = Date.now() - 60000
  sessions = {
    source: { kind: 'local', label: 'Local' },
    summary: { running: 2, settled: 0, total: 2, workspacesCount: 2 },
    sessions: [
      { status: 'running', pid: 4102, uuid: 'scroll-probe-a', workspaceName: 'Probe desk', cwd: '/workspace/probe', startedAt, latestGoal: 'Scroll this detail.', modifiedFiles: [], activity: 'bash: probe' },
      { status: 'running', pid: 4207, uuid: 'scroll-probe-b', workspaceName: 'Second desk', cwd: '/workspace/second', startedAt: startedAt - 60000, latestGoal: 'Switch to this session.', modifiedFiles: [], activity: 'thinking' },
    ],
  }
  try {
    await scrollingIsolationChecks(win)
  } finally {
    sessions = original
    await page(win, PAGES.dot('pi-sessions'))
  }
}

async function scrollingIsolationChecks(win) {
  await page(win, PAGES.dot('home'))
  const homeSelector = PAGES.surface('home')
  await win.webContents.executeJavaScript(`document.querySelector('.dot.active').focus(); document.querySelector('${homeSelector}').scrollTop = 160`)
  const homeInitial = await scrollState(win, homeSelector)
  for (const input of ['up', 'down']) {
    await remoteInput(win, input)
    const state = await scrollState(win, homeSelector)
    check(`Remote ${input} leaves Home browsing state unchanged`, state.top === homeInitial.top && state.page === homeInitial.page && state.focus === homeInitial.focus)
  }

  const pager = `${PAGES.surface('pi-sessions')}`
  const surface = `${pager} .pi-app-wrapper`
  const detail = `${surface} #pi-detail`
  const view = () => win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('${pager}')
    return {
      listOpen: page.querySelector('#pi-overview').hidden === false,
      detailInert: page.querySelector('#pi-detail').inert,
      focusedCell: document.activeElement?.classList.contains('pi-overview-cell') === true,
      context: document.querySelector('#page-context').textContent,
      subtitle: page.querySelector('#pi-view-subtitle').textContent,
    }
  })()`)
  const showList = () => win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('${pager}')
    const surface = page.querySelector('.pi-app-wrapper')
    if (surface.querySelector('#pi-overview').hidden) page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
  })()`)
  await page(win, PAGES.dot('pi-sessions'))
  await showList()
  await win.webContents.executeJavaScript(`document.querySelector('.dot.active').focus()`)
  await delay(100)
  const browseInitial = await scrollState(win, detail)
  for (const input of ['up', 'down']) {
    await remoteInput(win, input)
    const state = await scrollState(win, detail)
    check(`Remote ${input} leaves Pi Sessions browsing state unchanged`, state.top === browseInitial.top && state.page === browseInitial.page)
  }

  // The page lands on the live list, and the Shell's focus entry point follows
  // the view it can see. Primary enters App Focus Mode on that row.
  await remoteInput(win, 'primary')
  let current = await view()
  check('Remote App Focus Mode enters the live list it can see',
    current.listOpen && current.focusedCell && current.detailInert)
  const listContext = current.context
  await remoteInput(win, 'down')
  const afterDown = await view()
  check('Remote App Focus Mode keeps vertical input on the visible list',
    afterDown.context === listContext && afterDown.listOpen && afterDown.focusedCell)
  await remoteInput(win, 'up')
  // Select the focused row: the page opens that session without leaving itself.
  await remoteInput(win, 'primary')
  await delay(120)
  current = await view()
  check('Remote Select opens the focused session without paging',
    current.listOpen === false && current.detailInert === false && current.context === listContext)

  // The Pi Sessions page declares its own primary axis: Select activates in
  // place, vertical input scrolls the session detail, horizontal input switches
  // sessions, and none of them pages the shell.
  const beforeScroll = await scrollState(win, detail)
  await remoteInput(win, 'down')
  const afterScroll = await scrollState(win, detail)
  const followingLatest = await win.webContents.executeJavaScript(`(() => {
    const detail = document.querySelector('${detail}')
    return Math.abs(detail.scrollHeight - detail.clientHeight - detail.scrollTop) <= 2
  })()`)
  check('Remote App Focus Mode keeps working sessions at the latest event without paging',
    followingLatest && afterScroll.page === beforeScroll.page)

  const firstPosition = (await view()).subtitle
  await remoteInput(win, 'right')
  const secondPosition = (await view()).subtitle
  check('Remote App Focus Mode switches sessions without paging',
    secondPosition !== firstPosition && (await scrollState(win, detail)).page === beforeScroll.page)

  // The details declare their own primary axis: Back returns to the live list,
  // and Back in the list is left to the Shell, which ends App Focus Mode
  // without leaving the page.
  await remoteInput(win, 'back')
  await remoteInput(win, 'back')
  const afterBack = await view()
  check('Remote Back returns to the live list and leaves App Focus Mode to the Shell',
    afterBack.listOpen && afterBack.detailInert && afterBack.context === listContext &&
    publishedRemoteState?.mode === 'browse' && publishedRemoteState?.focus === 'items')
  await page(win, PAGES.dot('pi-sessions'))
}

async function selectionIdentityContinuity(win) {
  const original = sessions
  const pager = `${PAGES.surface('pi-sessions')}`
  const surface = `${pager} .pi-app-wrapper`
  const position = () => win.webContents.executeJavaScript(`document.querySelector('${surface} #pi-view-subtitle').textContent`)
  const selectSecond = () => win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('${pager}')
    const surface = page.querySelector('.pi-app-wrapper')
    if (surface.querySelector('#pi-overview').hidden) page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
    surface.querySelectorAll('.pi-overview-cell')[1]?.click()
  })()`)
  try {
    sessions = structuredClone(original)
    sessions.sessions[0].uuid = 'identity-only-session'
    sessions.sessions[1].uuid = 'second-identity-only-session'
    await page(win, PAGES.dot('pi-sessions'))
    // Choose the second live session, so the assertion is not just the default row.
    await selectSecond()
    await delay(120)
    const before = await position()
    await page(win, PAGES.dot('pi-sessions'))
    check('the selected session survives a scan by session identity', (await position()) === before, { before, after: await position() })
  } finally {
    sessions = original
    await page(win, PAGES.dot('pi-sessions'))
  }
}

async function remoteStripControls(win) {
  const original = sessions
  const startedAt = Date.now() - 60000
  sessions = {
    source: { kind: 'local', label: 'Local' },
    summary: { running: 1, settled: 1, total: 3, workspacesCount: 3 },
    sessions: [
      { status: 'running', pid: 4102, uuid: 'strip-a', workspaceName: 'Strip desk', cwd: '/workspace/strip', startedAt, latestGoal: 'Select me.', modifiedFiles: [], activity: 'bash: strip' },
      { status: 'settled', pid: 4207, uuid: 'strip-b', workspaceName: 'Second desk', cwd: '/workspace/second', startedAt: startedAt - 60000, latestGoal: 'Switch to me.', modifiedFiles: [], activity: 'thinking' },
      { status: 'exited', pid: 4307, uuid: 'strip-c', workspaceName: 'Past desk', cwd: '/workspace/legacy', startedAt: startedAt - 120000, latestGoal: 'Remember me.', modifiedFiles: [], activity: 'bash: done' },
    ],
  }
  const pager = `${PAGES.surface('pi-sessions')}`
  const surface = `${pager} .pi-app-wrapper`
  const readActions = () => (publishedRemoteState?.actions || [])
  const position = () => win.webContents.executeJavaScript(`document.querySelector('${surface} #pi-view-subtitle').textContent`)
  const listState = () => win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('${surface}')
    return {
      subtitle: surface.querySelector('#pi-view-subtitle').textContent,
      cells: [...surface.querySelectorAll('.pi-overview-cell')].map(cell => cell.querySelector('.pi-overview-path').textContent),
      overviewHidden: surface.querySelector('#pi-overview').hidden,
    }
  })()`)
  const showList = () => win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('${pager}')
    const surface = page.querySelector('.pi-app-wrapper')
    if (surface.querySelector('#pi-overview').hidden) page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
  })()`)
  try {
    await page(win, PAGES.dot('pi-sessions'))
    await showList()
    await delay(140)
    // Pi's own Remote contract: the page owns one Strip button, the Session
    // Filter, and Back and Select remain the rest of the interface.
    check('the Pi Sessions page publishes one Session Filter Strip button',
      readActions().length === 1 && readActions()[0].id === 'pi-session-filter' &&
      readActions()[0].label === 'LIVE' && publishedRemoteState?.focus === 'items',
      { state: publishedRemoteState })

    // The page lands on the live set, so exited history is not listed yet.
    const live = await listState()
    check('the page lands on the live set and never lists exited history there',
      live.cells.join(',') === '/workspace/strip,/workspace/second' &&
      live.subtitle === '2 live sessions · Local' && live.overviewHidden === false, live)

    // The Strip filter button advances the filter and narrows the list.
    await remoteAction(win, 'pi-session-filter')
    const afterFilter = await listState()
    check('the Strip filter button advances the Session Filter',
      readActions()[0].label === 'WORKING' && /^1 working session · Local$/.test(afterFilter.subtitle),
      { actions: readActions(), state: afterFilter })

    await win.webContents.executeJavaScript(`document.querySelector('${surface} .pi-filter-btn[data-filter="exited"]').click()`)
    await delay(120)
    const history = await listState()
    check('the Exited tab admits history without leaving the page',
      history.subtitle === '1 exited sessions · Local' || history.subtitle === '1 exited session · Local',
      history)
    await win.webContents.executeJavaScript(`document.querySelector('${surface} .pi-filter-btn[data-filter="live"]').click()`)
    await delay(120)
    const restored = await listState()
    check('returning to Live restores the started sessions',
      restored.cells.join(',') === live.cells.join(',') && restored.subtitle === live.subtitle, restored)

    // The page's own horizontal input switches sessions inside the live set.
    // The Shell only delivers directional input in App Focus Mode, so the
    // scenario enters it the way the Remote does: one primary press.
    await win.webContents.executeJavaScript(`document.querySelectorAll('${surface} .pi-overview-cell')[0].click()`)
    await delay(120)
    await remoteInput(win, 'primary')
    const firstPosition = await position()
    await remoteInput(win, 'right')
    const switched = await position()
    await remoteInput(win, 'right')
    check('session switching stays inside the live set',
      firstPosition === '/workspace/strip' && switched === '/workspace/second' &&
      (await position()) === '/workspace/second',
      { firstPosition, switched, after: await position() })

    // A selected session that leaves the live set hands over to a survivor.
    sessions = {
      ...sessions,
      summary: { running: 0, settled: 1, total: 1, workspacesCount: 1 },
      sessions: [sessions.sessions[1]],
    }
    await page(win, PAGES.dot('pi-sessions'))
    await delay(160)
    check('a session that leaves the live set hands the selection to a survivor',
      (await position()) === '/workspace/second', { position: await position() })

    // Back returns to the Session Overview without leaving the page.
    await remoteInput(win, 'back')
    const backState = await listState()
    check('Back returns to the Session Overview without leaving the page',
      backState.overviewHidden === false, backState)
  } finally {
    sessions = original
    await page(win, PAGES.dot('pi-sessions'))
  }
}

async function processIdentityContinuity(win) {
  const original = sessions
  const pager = `${PAGES.surface('pi-sessions')}`
  const surface = `${pager} .pi-app-wrapper`
  const position = () => win.webContents.executeJavaScript(`document.querySelector('${surface} #pi-view-subtitle').textContent`)
  const showList = () => win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('${pager}')
    const surface = page.querySelector('.pi-app-wrapper')
    if (surface.querySelector('#pi-overview').hidden) page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
  })()`)
  try {
    sessions = structuredClone(original)
    delete sessions.sessions[0].uuid
    sessions.sessions[0].id = 'process-with-local-id'
    await page(win, PAGES.dot('pi-sessions'))
    await showList()
    await win.webContents.executeJavaScript(`document.querySelector('${surface} .pi-overview-cell').click()`)
    await delay(120)
    const before = await position()
    sessions.sessions[0].latestGoal = 'Updated goal for the same local process'
    await page(win, PAGES.dot('pi-sessions'))
    check('a session without a uuid keeps its selection across a refresh', (await position()) === before, { before, after: await position() })
    await showList()
    check('the session overview selects exactly one session',
      await win.webContents.executeJavaScript(`document.querySelectorAll('${surface} .pi-overview-cell.is-selected').length === 1`))
  } finally {
    sessions = original
    await page(win, PAGES.dot('pi-sessions'))
  }
}

async function quotaRefreshFeedback(win) {
  await page(win, PAGES.dot('quota'))
  completeQuotaRefresh = () => {}
  try {
    const feedback = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#quota-refresh')
      const initial = button.getBoundingClientRect()
      const label = button.textContent
      button.click()
      const next = button.getBoundingClientRect()
      return button.disabled && button.getAttribute('aria-busy') === 'true' && label === button.textContent && initial.width === next.width && initial.height === next.height
    })()`)
    check('Usage refresh exposes busy state without moving its label', feedback)
    await delay(50)
    completeQuotaRefresh()
    completeQuotaRefresh = null
    await delay(50)
    check('Usage refresh restores its actionable state', await win.webContents.executeJavaScript(`!document.querySelector('#quota-refresh').disabled && !document.querySelector('#quota-refresh').hasAttribute('aria-busy')`))
  } finally {
    completeQuotaRefresh?.()
    completeQuotaRefresh = null
  }
}

async function scannerRecovery(win) {
  const original = sessions
  const pager = `${PAGES.surface('pi-sessions')}`
  try {
    scanFails = true
    await page(win, PAGES.dot('pi-sessions'))
    await delay(160)
    const announced = await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('${pager}')
      return {
        list: page.querySelector('#pi-overview-list').textContent,
        detail: page.querySelector('#pi-detail-body').textContent,
        cells: page.querySelectorAll('.pi-overview-cell').length,
      }
    })()`)
    check('a failed scan is named as unavailable without a Refresh instruction',
      /unavailable/i.test(announced.list) && !/refresh/i.test(announced.list), announced)
    check('a failed scan never fabricates a session',
      /unavailable/i.test(announced.detail) && announced.cells === 0, announced)
  } finally {
    sessions = original
    scanFails = false
    await page(win, PAGES.dot('pi-sessions'))
  }
}

async function builtinApps(win) {
  for (const id of ['calendar', 'clock', 'pomodoro', 'year', 'app-manager', 'pi-sessions']) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      await window.odkAppPlatform.openApp({ appId: '${id}' })
      const surface = document.querySelector('#app-runtime .runtime-app')
      return Boolean(surface) && surface.scrollWidth <= surface.clientWidth + 2
    })()`)
    check(`built-in ${id}: contained App interior`, result)
    await win.webContents.executeJavaScript(`document.querySelector('#app-back').click()`)
    await delay(50)
  }
}

async function main() {
  // Hidden on purpose: this harness must never activate a window on the desk it
  // measures. Layout, focus and hit testing still work offscreen, and
  // backgroundThrottling stays off so rAF keeps running.
  const win = new BrowserWindow({ width: 1920, height: 1280, useContentSize: true, frame: false, show: false,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true },
  })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await win.webContents.executeJavaScript('document.fonts.ready')
  PAGES = await resolvePages(win)
  for (const [width, height] of [[1920, 1280], [1920, 1080], [960, 640], [480, 854], [320, 480]]) {
    await resize(win, width, height)
    const label = `${width}x${height}`
    await widgets(win, label)
    await appPage(win, PAGES.dot('pi-sessions'), label)
    await appPage(win, PAGES.dot('quota'), label)
  }
  await resize(win, 1920, 1280)
  const savedSessions = sessions
  await require('./pi-design-refinement.cjs').run(win, check, value => { sessions = value })
  sessions = savedSessions
  await require('./pi-reading-stability.cjs').run(win, check, value => { sessions = value })
  sessions = savedSessions
  await processIdentityContinuity(win)
  await cameraInstrument(win)
  await contrastAndMotion(win)
  await builtinApps(win)
  await resize(win, 1920, 1280)
  win.webContents.setZoomFactor(2)
  await delay(350)
  await widgets(win, '200% zoom')
  await appPage(win, PAGES.dot('pi-sessions'), '200% zoom')
  await appPage(win, PAGES.dot('quota'), '200% zoom')
  win.webContents.setZoomFactor(1)
  await resize(win, 320, 480)
  quota = { state: 'available', snapshot: { accounts: [{ id: 'codex-test', provider: 'codex', fileName: 'codex-test.json', account: 'test@example.com', plan: 'Pro', resetCredits: { available: 2, expiresAt: ['2027-01-01T00:00:00Z'] }, groups: [{ title: 'Codex limits', description: null, quotas: [{ label: '5 hour limit', remainingPct: 58, resetAt: '2027-01-01T05:00:00Z', description: null }, { label: 'Weekly limit', remainingPct: 37, resetAt: '2027-01-07T00:00:00Z', description: null }] }] }] } }
  await win.webContents.executeJavaScript('window.odkServices.subscription.refresh()')
  await appPage(win, PAGES.dot('quota'), '320x480 configured usage')
  sessions = { source: { kind: 'local', label: 'Local' }, summary: { running: 0, settled: 0, total: 0, workspacesCount: 0 }, sessions: [] }
  await page(win, PAGES.dot('pi-sessions'))
  await delay(80)
  check('an empty session set is stated honestly and stays readable', await win.webContents.executeJavaScript(`(() => {
    const empty = document.querySelector('${PAGES.surface('pi-sessions')} .pi-empty-state')
    const detail = document.querySelector('${PAGES.surface('pi-sessions')} #pi-detail')
    return Boolean(empty) && empty.scrollWidth <= detail.clientWidth + 1 && /No session matches Live\./i.test(empty.textContent)
  })()`))
  await require('./design-refinement.cjs')(win, check)
  await quotaRefreshFeedback(win)
  await keyboardScrolling(win)
  await editableKeyboard(win)
  await nativeAppScrolling(win)
  await remoteScrollingIsolation(win)
  await remoteStripControls(win)
  await scannerRecovery(win)
  assert.equal(failures, 0, `${failures} interior checks failed`)
  console.log('WIDGET_APP_STYLES_PASS')
}

const timeout = setTimeout(() => { console.error('STYLE_TEST_TIMEOUT'); app.exit(1) }, 90000)
app.whenReady().then(main).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
