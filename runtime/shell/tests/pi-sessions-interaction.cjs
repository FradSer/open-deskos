'use strict'

// Deterministic example sessions, never evidence of real Pi task execution.
// Run on CM5 via SSH with an isolated HOME and --ozone-platform=headless.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { resolvePages } = require('./helpers/pages')
const root = path.resolve(__dirname, '..')
const startedAt = Date.now() - 60000
const session = (id, goal, status = 'running', extra = {}) => ({
  uuid: id, sessionId: id, pid: id, startedAt, status,
  workspaceName: 'Example workspace', cwd: '/example/workspace',
  latestGoal: goal, activity: 'read: src/example.js',
  ...extra,
})
const initial = [session('example-a', 'Example: inspect keyboard navigation.'), session('example-b', 'Example: 优化会话阅读与返回。')]
// The board's density claim needs more sessions than the default pair, and one
// session per Pi state so every lane is present in the same render.
const dense = [
  ...initial,
  ...Array.from({ length: 4 }, (_, index) => session(`dense-run-${index}`, `Example: running session ${index + 1}.`)),
  ...Array.from({ length: 2 }, (_, index) => session(`dense-idle-${index}`, `Example: settled session ${index + 1}.`, 'settled')),
  session('dense-exit', 'Example: finished session.', 'exited'),
]
let snapshot
let pendingEvent = null
let eventRequests = 0
let holdEvents = false
// The first scan stays unanswered until the first scenario releases it, so the
// page's own loading state can be observed rather than assumed.
let holdScan = true
let resultFixture = null
let remoteState
// Electron answers "reply was never sent" once it collects the native invoke
// event while the handler's promise is still unsettled. A scan or a log read
// this harness holds open is held, not abandoned, so it keeps its own event
// alive: otherwise a collection at the wrong moment turns the held answer into
// a reported scanner failure.
const heldInvocations = []
function holdInvoked(event) {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  const held = { event, promise, resolve }
  heldInvocations.push(held)
  return held
}
function publish(items = initial) {
  snapshot = { ok: true, source: { kind: 'local', label: 'Example fixture' }, sessions: items,
    summary: { running: items.filter(item => item.status === 'running').length, total: items.length, workspacesCount: 1 } }
}

publish()
const events = id => ({ ok: true, events: Array.from({ length: 48 }, (_, index) => ({ kind: ['user', 'thinking', 'tool', 'result', 'assistant'][index % 5], text: `${id}: example event ${index + 1}` })) })
ipcMain.handle('odk-pi-sessions', (event) => (holdScan ? holdInvoked(event).promise : snapshot))
ipcMain.handle('odk-pi-session-events', (event, query) => {
  eventRequests += 1
  if (holdEvents) {
    const held = holdInvoked(event)
    pendingEvent = () => held.resolve(events(query.sessionId))
    return held.promise
  }
  return resultFixture || events(query.sessionId)
})
ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, nodes: [], env: null }))
ipcMain.handle('odk-camera-frame', () => ({ status: 'unavailable' }))
ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
ipcMain.handle('odk-remote-publish-page-state', (_event, state) => { remoteState = state; return true })

const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms))
let win
let surface
const js = body => win.webContents.executeJavaScript(`(async () => { const surface = document.querySelector(${JSON.stringify(surface)}); const $ = selector => surface.querySelector(selector); ${body} })()`)
async function until(body) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await js(body)) return
    await pause(30)
  }
  throw new Error(`Condition not reached: ${body}`)
}
async function refresh() {
  await js("surface.closest('.page').dispatchEvent(new Event('odk-page-shown'))")
  await pause(120)
}
async function click(selector) {
  await js(`$( ${JSON.stringify(selector)} ).click()`)
  await pause()
}
// The page carries no controls, so its own Remote input is how the harness
// moves between the live list and the session it selects.
async function pageInput(input) {
  await js(`surface.closest('.page').dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: ${JSON.stringify(input)} } }))`)
  await pause(80)
}
async function enterPage() {
  await win.webContents.executeJavaScript("[...document.querySelectorAll('.dot')].find(dot => dot.getAttribute('aria-label')?.includes('Pi Sessions')).click()")
  await pause(250)
}
// The desk's reasoning display is launch configuration, so the harness relaunches
// the renderer with the same search the main process would build for it.
async function relaunch(search) {
  await win.loadFile(path.join(root, 'src/renderer/index.html'), { search })
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
  await win.webContents.executeJavaScript('document.fonts.ready')
  await enterPage()
}
async function showOverview() {
  if (await js("return !$('#pi-overview').hidden")) return
  await pageInput('primary')
}
async function reset(items = initial) {
  await enterPage()
  holdEvents = false
  pendingEvent?.()
  pendingEvent = null
  publish(items)
  await refresh()
  // The Session Filter is page state and survives a scan, so a scenario starts
  // from the live default rather than from whatever the last one selected.
  await showOverview()
  if (await js("return $('.pi-filter-btn.active')?.dataset.filter !== 'live'")) {
    await click('.pi-filter-btn[data-filter="live"]')
  }
  await refresh()
  if (await js("return Boolean($('#pi-overview-list .pi-overview-cell'))")) {
    await js("$('#pi-overview-list .pi-overview-cell').click()")
    await until("return $('.pi-event-text')?.textContent.startsWith('example-a:')")
  }
}
const results = []
// A renderer exception is a failure of the page, not of a probe: the scenario
// that provokes one asserts that none appeared.
const rendererErrors = []
async function scenario(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}

async function main() {
  win = new BrowserWindow({ width: 1920, height: 1280, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', (event, level, message) => {
    // Electron reports console messages as an event object in newer versions and
    // as scalar arguments in older ones.
    const details = event && typeof event === 'object' && 'message' in event ? event : { level, message }
    if (details.level === 'error' || details.level === 3) rendererErrors.push(String(details.message || ''))
  })
  win.webContents.debugger.attach('1.3')
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
  await win.webContents.executeJavaScript('document.fonts.ready')
  const pages = await resolvePages(win)
  surface = `${pages.surface('pi-sessions')} .pi-app-wrapper`
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await pause(400)
  assert.equal(win.isVisible(), false, 'the test window must stay hidden')

  await scenario('an unanswered first scan states loading once and shows Pi\'s own indicator', async () => {
    // The page and the widget are mounted with the scan still unanswered, so
    // this is the state a desk shows before its first scan comes back.
    try {
      const state = await js(`return {
        subtitle: $('#pi-view-subtitle').textContent,
        spinner: $('#pi-overview-list .pi-spinner') !== null,
        region: $('#pi-overview-list').textContent.trim(),
        counts: [...$('#pi-overview-filters').querySelectorAll('.pi-filter-count')].map(node => node.textContent).join(','),
      }`)
      const tile = await win.webContents.executeJavaScript(`(() => {
        const node = document.querySelector('[data-widget="odk.tile.pi-sessions"]')
        return {
          tag: node.querySelector('.pi-widget-tag-label').textContent,
          summary: node.querySelector('.pi-widget-summary').textContent,
          state: node.querySelector('.w-state').textContent,
          count: node.querySelector('.pi-widget-count').textContent,
        }
      })()`)
      const observed = JSON.stringify({ state, tile })
      assert.equal(state.subtitle, 'Loading Pi sessions...', observed)
      assert.equal(state.spinner && !state.region.includes('Loading Pi sessions'), true, observed)
      assert.equal(state.counts, '--,--,--,--,--', observed)
      assert.deepEqual(tile, { tag: 'READING', summary: 'Not scanned yet', state: '', count: '--' }, observed)
    } finally {
      holdScan = false
      await refresh()
    }
  })

  await scenario('the page lands on a live list of started sessions only', async () => {
    publish([...initial, session('example-settled', 'Example settled goal', 'settled'), session('example-exited', 'Example exited goal', 'exited')])
    await refresh()
    await showOverview()
    assert.equal(await js("return !$('#pi-overview').hidden"), true)
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-overview-goal')].map(node => node.textContent.trim())"), ['Example: inspect keyboard navigation.', 'Example: 优化会话阅读与返回。', 'Example settled goal'])
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 3)
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '', 'the overview carries no session summary line')
    assert.equal(await js("return $('#pi-overview').textContent.includes('Example exited goal')"), false)
  })

  await scenario('the detail is the current Pi state and its directory, with no page chrome', async () => {
    await reset()
    assert.deepEqual(await js(`return {
      title: $('#pi-title-text').textContent,
      spinner: $('#pi-title .pi-spinner').hidden === false,
      spinnerFrame: [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'].includes($('#pi-title .pi-spinner').textContent),
      subtitle: $('#pi-view-subtitle').textContent,
      detailButtons: $('#pi-detail').querySelectorAll('button, input, select').length,
      pageButtons: surface.querySelectorAll('button:not(.pi-overview-cell):not(.pi-filter-btn)').length,
      hiddenWhileDetailed: $('#pi-overview').hidden,
    }`), { title: 'Working...', spinner: true, spinnerFrame: true, subtitle: '/example/workspace', detailButtons: 0, pageButtons: 0, hiddenWhileDetailed: true })
    assert.equal(await js("return $('#pi-title').textContent.includes('Pi Sessions')"), false)
    assert.equal(await js("return $('.pi-goal-text').textContent.trim()"), initial[0].latestGoal)
  })

  await scenario('no attribution line is carried under the title', async () => {
    await reset([session('example-a', 'Example Hosted Pi goal', 'settled', {
      hostedPi: true,
      controlAttribution: { machine: 'desk-mac', sessionId: 'console-example' },
    })])
    await showOverview()
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '', 'the title row carries no driven-by description')
    await click('.pi-filter-btn[data-filter="working"]')
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '')
    await click('.pi-filter-btn[data-filter="live"]')
    assert.equal(await js("return $('.pi-overview-path').textContent"), 'Hosted Pi · /example/workspace', 'the card still says the session is hosted')
    await js("$('.pi-overview-cell').click()")
    await pause()
    assert.equal(await js("return $('#pi-detail').textContent.includes('desk-mac') || $('#pi-detail').textContent.includes('console-example')"), false)
    assert.equal(await js("return $('#pi-view-facts').textContent.includes('desk-mac')"), false)
  })

  await scenario('the Session Overview carries the Session Filter and the detail never does', async () => {
    await reset()
    // The Overview owns the filter, and the filter spends the page title row's
    // trailing edge. The page may still be reading the previous scenario's
    // session, so the row's visible state is asserted after returning to the list.
    assert.equal(await js("return $('#pi-overview-filters').querySelectorAll('.pi-filter-btn').length"), 5)
    assert.equal(await js("return $('.pi-app-header').contains($('#pi-overview-filters'))"), true)
    assert.equal(await js("return $('#pi-detail').querySelectorAll('.pi-filter-btn').length"), 0)
    publish([...initial, session('example-idle', 'Example idle goal', 'settled'), session('example-exited', 'Example exited goal', 'exited')])
    await refresh()
    await showOverview()
    assert.equal(await js("return $('#pi-overview-filters').hidden"), false)
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-filter-btn')].map(node => [node.dataset.filter, node.querySelector('.pi-filter-count').textContent, node.getAttribute('aria-pressed')])"),
      [['live', '3', 'true'], ['working', '2', 'false'], ['idle', '1', 'false'], ['exited', '1', 'false'], ['all', '4', 'false']])
    // The page still lands on started sessions only.
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-overview-goal')].map(node => node.textContent.trim())"),
      ['Example: inspect keyboard navigation.', 'Example: 优化会话阅读与返回。', 'Example idle goal'])
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '', 'the overview carries no session summary line')
    // A status tab narrows the list without leaving the page.
    const page = await js("return document.querySelector('#page-context').textContent")
    await click('.pi-filter-btn[data-filter="exited"]')
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-overview-goal')].map(node => node.textContent.trim())"), ['Example exited goal'])
    assert.equal(await js(`return $(".pi-filter-btn[data-filter='exited']").getAttribute('aria-pressed')`), 'true')
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '', 'and the summary does not come back with a narrower filter')
    assert.equal(await js("return document.querySelector('#page-context').textContent"), page)
    // All is the union, so live history stays reachable on request.
    await click('.pi-filter-btn[data-filter="all"]')
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 4)
    await click('.pi-filter-btn[data-filter="live"]')
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 3)
    // Reading a session hides the list's filter and states its elapsed time on
    // the same trailing edge, so the row never carries a control for the list.
    await js("$('.pi-overview-cell').click()")
    await pause()
    assert.equal(await js("return $('#pi-overview-filters').hidden && /elapsed/.test($('#pi-view-facts').textContent)"), true)
    assert.equal(await js("return $('#pi-overview').hidden"), true)
  })

  await scenario('the Remote Strip filter button advances the Session Filter', async () => {
    await reset()
    await showOverview()
    assert.deepEqual(remoteState.actions, [{ id: 'pi-session-filter', label: 'LIVE' }])
    const press = async () => {
      await js("surface.closest('.page').dispatchEvent(new CustomEvent('odk-remote-action', { detail: 'pi-session-filter' }))")
      await pause(80)
    }
    for (const label of ['WORKING', 'IDLE', 'EXITED', 'ALL', 'LIVE']) {
      await press()
      assert.match(String(remoteState.actions[0]?.label), new RegExp(`^${label}$`))
      assert.equal(await js(`return $('.pi-filter-btn[data-filter="${label.toLowerCase()}"]').getAttribute('aria-pressed')`), 'true', `pressed ${label}`)
    }
    assert.match(await js("return document.querySelector('#page-context').textContent"), /Pi Sessions/)
  })

  await scenario('an idle session states Idle without an animated indicator', async () => {
    await reset([session('example-a', 'Example idle goal', 'settled')])
    assert.equal(await js("return $('#pi-title-text').textContent"), 'Idle')
    assert.equal(await js("return $('#pi-title .pi-spinner').hidden"), true)
  })

  await scenario('the spinner runs native Pi frames and stops under reduced motion', async () => {
    await reset()
    const first = await js("return $('#pi-title .pi-spinner').textContent")
    await pause(200)
    const second = await js("return $('#pi-title .pi-spinner').textContent")
    assert.notEqual(first, second, 'the braille indicator must animate')
    assert.equal(await js("return [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'].includes($('#pi-title .pi-spinner').textContent)"), true)
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await pause(300)
    const held = await js("return $('#pi-title .pi-spinner').textContent")
    await pause(300)
    assert.equal(await js("return $('#pi-title .pi-spinner').textContent"), held, 'reduced motion must hold one frame')
    assert.equal(await js("return $('#pi-title-text').textContent"), 'Working...')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  })

  await scenario('a session reported twice is one session, not two rows', async () => {
    // Two Reporting Machines may describe the same session; the page must not
    // collide on the identity it keys rows by, and must not leak cells.
    const duplicate = session('example-a', initial[0].latestGoal, 'running', { reportedBy: 'second-machine' })
    await reset([session('example-a', initial[0].latestGoal), duplicate, session('example-b', initial[1].latestGoal)])
    await refresh()
    await showOverview()
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 3)
    const before = await js("return surface.querySelectorAll('.pi-overview-cell').length")
    for (let round = 0; round < 4; round += 1) await refresh()
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), before, 'repeat scans must not accumulate rows')
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell.is-selected').length"), 1)
  })

  await scenario('the user prompt wraps to its container instead of a fixed measure', async () => {
    await reset([session('example-a', 'Example: 一个需要按容器宽度换行的很长目标。 '.repeat(6))])
    const measured = await js(`const goal = $('.pi-goal-text'); const host = $('#pi-detail-body');
      return {
        goal: Math.round(goal.getBoundingClientRect().width),
        host: host.clientWidth,
        maxWidth: getComputedStyle(goal).maxWidth,
        overflows: goal.scrollWidth > goal.clientWidth + 1,
        wrapped: goal.getBoundingClientRect().height > parseFloat(getComputedStyle(goal).lineHeight) * 1.5,
      }`)
    assert.equal(measured.host - measured.goal <= 2, true, `the prompt must fill its container: ${JSON.stringify(measured)}`)
    assert.equal(measured.maxWidth, 'none')
    assert.equal(measured.overflows, false)
    assert.equal(measured.wrapped, true)
  })

  await scenario('Remote and keyboard move between live sessions without paging', async () => {
    await reset()
    const before = await js("return document.querySelector('#page-context').textContent")
    await pageInput('right')
    await until("return $('.pi-event-text')?.textContent.startsWith('example-b:')")
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '/example/workspace')
    assert.equal(await js("return document.querySelector('#page-context').textContent"), before)
    await pageInput('right')
    await pause(80)
    assert.equal(await js("return $('.pi-goal-text').textContent.trim()"), initial[1].latestGoal, 'switching stops at the last session')
    await pageInput('left')
    await until("return $('.pi-event-text')?.textContent.startsWith('example-a:')")
    await js("$('#pi-detail').focus(); $('#pi-detail').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))")
    await until("return $('.pi-event-text')?.textContent.startsWith('example-b:')")
    assert.equal(await js("return document.querySelector('#page-context').textContent"), before)
  })

  await scenario('Back and primary return from the detail to the live list without leaving the page', async () => {
    for (const input of ['back', 'primary']) {
      await reset()
      const page = await js("return document.querySelector('#page-context').textContent")
      await pageInput(input)
      assert.equal(await js("return $('#pi-overview').hidden"), false, input)
      assert.equal(await js("return $('#pi-title-text').textContent"), 'Pi Sessions', input)
      assert.equal(await js("return document.querySelector('#page-context').textContent"), page, input)
      assert.equal(await js("return $('#pi-view-subtitle').textContent"), '', input)
    }
  })

  await scenario('the Remote focus entry point follows the visible view', async () => {
    // The Shell focuses the page's own [data-page-focus] target, so it must be
    // the surface the user can actually see, on the Remote as well as by touch.
    await reset()
    assert.deepEqual(await js(`return {
      detailTarget: $('#pi-detail').hasAttribute('data-page-focus'),
      listTargets: $('#pi-overview').querySelectorAll('[data-page-focus]').length,
    }`), { detailTarget: true, listTargets: 0 })
    await showOverview()
    assert.deepEqual(await js(`return {
      detailTarget: $('#pi-detail').hasAttribute('data-page-focus'),
      cellTarget: $('#pi-overview-list [data-page-focus]')?.classList.contains('pi-overview-cell') || false,
      total: surface.querySelectorAll('[data-page-focus]').length,
    }`), { detailTarget: false, cellTarget: true, total: 1 })
    // Directional input moves the list cursor once the Remote owns the page.
    await js("$('#pi-overview-list [data-page-focus]').focus()")
    await pageInput('down')
    // The cursor moves within the list; the Shell's entry point stays on the
    // chosen session, so re-entering focus mode lands where the user left it.
    assert.deepEqual(await js(`return {
      focusedCell: document.activeElement.classList.contains('pi-overview-cell'),
      targetCount: surface.querySelectorAll('[data-page-focus]').length,
    }`), { focusedCell: true, targetCount: 1 })
    await pageInput('primary')
    assert.deepEqual(await js(`return {
      listHidden: $('#pi-overview').hidden,
      detailTarget: $('#pi-detail').hasAttribute('data-page-focus'),
    }`), { listHidden: true, detailTarget: true })
  })

  await scenario('the list is a cover, so choosing a session keeps its reading position', async () => {
    await reset([session('example-a', 'Example idle reading', 'settled')])
    await js("$('#pi-detail').scrollTop = 260; window.__piReadingTop = $('#pi-detail').scrollTop; window.__piDetailNode = $('#pi-detail-body').firstElementChild")
    await showOverview()
    assert.equal(await js("return !$('#pi-detail').hidden && $('#pi-detail-body').firstElementChild === window.__piDetailNode"), true)
    await js("$('#pi-overview-list .pi-overview-cell').click()")
    await pause(120)
    assert.equal(await js("return $('#pi-overview').hidden && Math.abs($('#pi-detail').scrollTop - window.__piReadingTop) <= 1"), true)
  })

  await scenario('list refresh preserves cell identity, focus, and scroll position', async () => {
    await reset(Array.from({ length: 30 }, (_, i) => session(i === 0 ? 'example-a' : `example-${i}`, `Example goal ${i}`)))
    await showOverview()
    await js("window.__piFocusedCell = surface.querySelectorAll('.pi-overview-cell')[20]; window.__piFocusedCell.focus(); window.__piOverviewScroll = $('#pi-overview').scrollTop")
    snapshot.sessions = [...snapshot.sessions.map(item => ({ ...item, activity: 'write: src/revised.js' })), session('example-new', 'Example appended goal')]
    await refresh()
    assert.equal(await js("return document.activeElement === window.__piFocusedCell && window.__piFocusedCell.isConnected"), true)
    assert.equal(await js("return Math.abs($('#pi-overview').scrollTop - window.__piOverviewScroll) <= 1"), true)
    await js("document.activeElement.click()")
    await until("return $('.pi-event-text')?.textContent.startsWith('example-20:')")
  })

  await scenario('an empty live list is stated honestly', async () => {
    await reset([session('example-exited', 'Example exited goal', 'exited')])
    await showOverview()
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 0)
    assert.match(await js("return $('.pi-empty-state').textContent"), /No session matches Live\./)
    assert.equal(await js("return $('#pi-view-subtitle').textContent"), '', 'the empty statement lives on the board, not under the title')
    assert.equal(await js(`return $(".pi-filter-btn[data-filter='exited'] .pi-filter-count").textContent`), '1')

    // A kanban keeps its columns: the filter selects Working and Idle, so both
    // lanes are on the board even though no session matches, and each states a
    // count of zero instead of the lane disappearing with the rows.
    const empty = await js(`
      const lanes = [...$('#pi-overview-list').querySelectorAll('.pi-board-column')];
      return {
        board: getComputedStyle($('#pi-overview-list')).display === 'grid',
        states: lanes.map(lane => lane.dataset.state),
        counts: lanes.map(lane => lane.querySelector('.pi-board-column-count').textContent.trim()),
        cards: lanes.map(lane => lane.querySelectorAll('.pi-overview-cell').length),
      }
    `)
    assert.equal(empty.board, true, 'the board is still the view when nothing matches')
    assert.deepEqual(empty.states, ['running', 'settled'], 'every state the filter selects keeps its lane')
    assert.deepEqual(empty.counts, ['0', '0'], 'an empty lane states a count of zero')
    assert.deepEqual(empty.cards, [0, 0], 'and holds no cards')

    await click(".pi-filter-btn[data-filter='exited']")
    const switched = await js("return [...$('#pi-overview-list').querySelectorAll('.pi-board-column')].map(lane => lane.dataset.state)")
    assert.deepEqual(switched, ['exited'], 'a lane the new filter does not select is taken off the board')
    await click(".pi-filter-btn[data-filter='live']")
  })

  await scenario('late events cannot overwrite the selected session', async () => {
    await reset()
    holdEvents = true
    await refresh()
    assert.equal(typeof pendingEvent, 'function')
    const completeOld = pendingEvent
    pendingEvent = null
    holdEvents = false
    await pageInput('right')
    await until("return $('.pi-event-text')?.textContent.startsWith('example-b:')")
    completeOld()
    await pause(100)
    assert.equal(await js("return [...surface.querySelectorAll('.pi-event-text')].every(node => node.closest('.is-folded') || node.textContent.startsWith('example-b:'))"), true)
    assert.equal(await js("return surface.querySelector('#pi-events').textContent.includes('example-a:')"), false)
  })

  await scenario('automatic handover clears old events while the new stream loads', async () => {
    await reset()
    publish([initial[1]])
    holdEvents = true
    await refresh()
    assert.equal(await js("return $('.pi-goal-text').textContent.trim()"), initial[1].latestGoal)
    assert.equal(await js("return surface.querySelectorAll('.pi-event').length"), 0)
    assert.match(await js("return $('#pi-events-host').textContent"), /Reading session events/)
    holdEvents = false
    pendingEvent?.()
    pendingEvent = null
  })

  await scenario('malformed and failed snapshots cannot look like live sessions', async () => {
    await reset()
    for (const bad of [{}, { ok: true, sessions: [null] }, { ...snapshot, ok: false }]) {
      snapshot = bad
      await refresh()
      // A condition is stated once: the title row states it, and the board has no
      // card to explain. The lanes are structural, so they stand with a count of
      // zero rather than being taken away with the rows they never had.
      assert.equal(await js(`return surface.querySelectorAll('.pi-overview-cell').length === 0
        && /unavailable/i.test($('#pi-view-subtitle').textContent)
        && [...$('#pi-overview-list').querySelectorAll('.pi-board-column')].every(lane => lane.querySelector('.pi-board-column-count').textContent.trim() === '0')`), true)
    }
  })

  await scenario('working sessions always stay at their newest event with a scrollbar', async () => {
    await reset()
    const read = () => js("const d = $('#pi-detail'); return { height: d.clientHeight, scroll: d.scrollHeight, top: d.scrollTop, overflow: getComputedStyle(d).overflowY, following: d.classList.contains('is-following'), width: innerWidth, heightWindow: innerHeight }")
    const first = await read()
    assert.equal(first.scroll > first.height && Math.abs(first.scroll - first.height - first.top) <= 2 && first.overflow === 'scroll', true, `initial ${JSON.stringify(first)}`)
    await js("$('#pi-detail').scrollTop = 0")
    await pause(100)
    const scrolled = await read()
    assert.equal(Math.abs(scrolled.scroll - scrolled.height - scrolled.top) <= 2, true, `manual ${JSON.stringify(scrolled)}`)
    await refresh()
    const updated = await read()
    assert.equal(Math.abs(updated.scroll - updated.height - updated.top) <= 2, true, `updated ${JSON.stringify(updated)}`)
  })

  await scenario('an idle session keeps a manual reading position across a scan', async () => {
    await reset([session('example-a', 'Example idle reading', 'settled')])
    await js("$('#pi-detail').scrollTop = 240")
    const before = await js("return { top: $('#pi-detail').scrollTop, anchor: surface.querySelectorAll('.pi-event-text')[3]?.textContent }")
    await refresh()
    assert.equal(await js("return Math.abs($('#pi-detail').scrollTop - " + before.top + ") <= 2"), true)
  })

  await scenario('native Pi message hierarchy replaces repeated role columns', async () => {
    await reset()
    assert.deepEqual(await js(`
      const user = $('.pi-event-user');
      const assistant = $('.pi-event-assistant');
      const style = node => getComputedStyle(node);
      return {
        labelled: $('.pi-event-kind').classList.contains('sr-only'),
        userBand: style(user).backgroundColor !== 'rgba(0, 0, 0, 0)',
        assistantPlain: style(assistant).backgroundColor === 'rgba(0, 0, 0, 0)',
        noRules: [...surface.querySelectorAll('.pi-event')].every(node => parseFloat(style(node).borderBottomWidth) === 0),
        summary: $('.pi-stream-label')?.textContent,
      };
    `), { labelled: true, userBand: true, assistantPlain: true, noRules: true, summary: 'Recent session events' })
  })

  await scenario('the Session Overview is a board of state lanes holding session cards', async () => {
    await reset(dense)
    await showOverview()
    await click('.pi-filter-btn[data-filter="all"]')
    await showOverview()
    const board = await js(`
      const cells = [...surface.querySelectorAll('.pi-overview-cell')];
      const list = $('#pi-overview-list');
      const lanes = [...list.querySelectorAll('.pi-board-column')];
      const rect = node => node.getBoundingClientRect();
      const laneOf = node => node.closest('.pi-board-column');
      const visible = node => { const box = rect(node); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth };
      const selected = cells.find(node => node.classList.contains('is-selected'));
      const other = cells.find(node => node !== selected);
      return {
        shown: !$('#pi-overview').hidden,
        board: getComputedStyle(list).display === 'grid',
        lanes: lanes.map(lane => lane.dataset.state),
        labels: lanes.map(lane => lane.querySelector('.pi-board-column-label').textContent.trim()),
        countsMatch: lanes.every(lane => Number(lane.querySelector('.pi-board-column-count').textContent.trim()) === lane.querySelectorAll('.pi-overview-cell').length),
        sideBySide: new Set(lanes.map(lane => Math.round(rect(lane).top))).size === 1 &&
          lanes.every((lane, index) => index === 0 || rect(lane).left >= rect(lanes[index - 1]).right - 1),
        cardsInsideLanes: cells.every(node => rect(node).left >= rect(laneOf(node)).left - 1 && rect(node).right <= rect(laneOf(node)).right + 1),
        stroked: cells.every(node => parseFloat(getComputedStyle(node).borderWidth) >= 1),
        // The current session is marked by its edge alone: no card owns a filled band.
        noBand: cells.every(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'),
        marked: cells.filter(node => node.classList.contains('is-selected')).length === 1 &&
          getComputedStyle(selected).borderColor !== getComputedStyle(other).borderColor,
        states: cells.every(node => node.querySelector('.pi-overview-state').textContent.trim().length > 0),
        visibleCards: cells.filter(visible).length,
      };
    `)
    assert.equal(board.shown, true, 'the board is the visible view when it is measured')
    assert.equal(board.board, true, 'the overview arranges sessions on a board')
    assert.deepEqual(board.lanes, ['running', 'settled', 'exited'], 'one lane per Pi state present, in state order')
    assert.deepEqual(board.labels, ['Working', 'Idle', 'Exited'], 'each lane heading names its state')
    assert.equal(board.countsMatch, true, 'each lane heading counts its own cards')
    assert.equal(board.sideBySide, true, 'lanes sit side by side')
    assert.equal(board.cardsInsideLanes, true, 'each card stays inside its lane')
    assert.equal(board.stroked, true, 'each card carries a structural stroke')
    assert.equal(board.noBand, true, 'no card owns a filled band')
    assert.equal(board.marked, true, 'exactly one card is the current session, marked by its edge')
    assert.equal(board.states, true, 'each card states its Pi state')
    assert.ok(board.visibleCards >= 6, `expected at least six cards inside the viewport, saw ${board.visibleCards}`)

    // The desk's own size, where a lane that wrapped to a second row read as a
    // stacked list rather than a board, and where the filter track centred
    // against the title block instead of sharing the title's line.
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 776, deviceScaleFactor: 1, mobile: false })
    await js("window.dispatchEvent(new Event('resize')); await document.fonts.ready")
    await pause(180)
    const desk = await js(`
      const lanes = [...$('#pi-overview-list').querySelectorAll('.pi-board-column')];
      const rect = node => node.getBoundingClientRect();
      const title = $('#pi-title');
      const filters = $('#pi-overview-filters');
      const firstTab = filters.querySelector('.pi-filter-btn');
      const titleBox = rect(title);
      const tabBox = rect(firstTab);
      return {
        laneRows: new Set(lanes.map(lane => Math.round(rect(lane).top))).size,
        laneWidths: lanes.map(lane => Math.round(rect(lane).width)),
        insideSurface: lanes.every(lane => rect(lane).left >= -1 && rect(lane).right <= innerWidth + 1),
        sharesTitleLine: Boolean(title.parentElement) && title.parentElement.contains(filters),
        tabRows: new Set([...filters.querySelectorAll('.pi-filter-btn')].map(tab => Math.round(rect(tab).top))).size,
        titleToTabOffset: Math.round(Math.abs((titleBox.top + titleBox.height / 2) - (tabBox.top + tabBox.height / 2))),
        tabHeight: Math.round(tabBox.height),
      }
    `)
    assert.equal(desk.laneRows, 1, 'at the desk width every lane stays in one row')
    assert.ok(desk.laneWidths.every(width => width >= 260), `every lane keeps a readable card, saw ${desk.laneWidths.join(',')}`)
    assert.equal(desk.insideSurface, true, 'no lane is pushed sideways out of the surface')
    assert.equal(desk.sharesTitleLine, true, 'the filter tabs and the title share one line')
    assert.equal(desk.tabRows, 1, 'and every tab is on that one row')
    assert.ok(desk.titleToTabOffset <= 8, `the tabs read on the title's line, offset ${desk.titleToTabOffset}px`)
    assert.ok(desk.tabHeight >= 44, `the tabs keep a touch height, saw ${desk.tabHeight}`)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
    await js("window.dispatchEvent(new Event('resize')); await document.fonts.ready")
  })

  await scenario('a card shows the prompt over several lines and ellipsizes past that', async () => {
    const longPrompt = '第一行：请把看板做得更紧凑。\n第二行：字号与卡片高度都可以再优化。\n第三行：这条博客应当出现。\n第四行：还有这一行。\n第五行：这一行应当被省略。\n第六行：还有这一行。'
    await reset([session('example-a', longPrompt, 'running')])
    await showOverview()
    const goal = await js(`
      const node = $('.pi-overview-goal')
      const style = getComputedStyle(node)
      const lineHeight = Number.parseFloat(style.lineHeight)
      return {
        clamp: Number.parseInt(style.webkitLineClamp || '0', 10),
        text: node.textContent.trim(),
        breaks: node.querySelectorAll('br').length,
        lines: Math.round(node.clientHeight / lineHeight),
        cut: node.scrollHeight > node.clientHeight + 1,
      }
    `)
    assert.equal(goal.text.includes('第一行'), true, 'the prompt is the card\'s own statement')
    assert.equal(goal.lines >= 2, true, `the prompt keeps its lines, saw ${goal.lines}`)
    assert.equal(goal.clamp >= 2, true, `the prompt is allowed several lines, saw clamp ${goal.clamp}`)
    // What the rule guarantees: the box is multi-line and bounded by its clamp. How
    // many lines are painted inside a clamped box also depends on the card's own
    // height, so that number is not asserted here.
    assert.equal(goal.lines <= goal.clamp, true, `the box never exceeds its clamp, saw ${goal.lines} of ${goal.clamp}`)
    // Six written lines, so five breaks: the card keeps the lines rather than
    // flattening them, which is what made a pasted prompt read as one sentence.
    assert.equal(goal.breaks, 5, `every written line is a line in the card, saw ${goal.breaks} breaks`)
    assert.equal(goal.text.includes('第六行：还有这一行。'), true, 'and the last written line is what the clamp draws from')
    // The activity answers what the session is doing now, so it stays one short line.
    const activity = await js("const node = $('.pi-overview-activity'); const style = getComputedStyle(node); return { clamp: Number.parseInt(style.webkitLineClamp || '0', 10), lines: Math.round(node.clientHeight / Number.parseFloat(style.lineHeight)) }")
    assert.equal(activity.lines <= 1, true, `the activity stays a short summary, saw ${activity.lines}`)
  })

  await scenario('lane input crosses lanes and stays inside one lane', async () => {
    await reset(dense)
    await showOverview()
    await click('.pi-filter-btn[data-filter="all"]')
    await showOverview()
    const lane = () => js("return document.activeElement?.closest('.pi-board-column')?.dataset.state || null")
    const index = () => js("const lane = document.activeElement?.closest('.pi-board-column'); return lane ? [...lane.querySelectorAll('.pi-overview-cell')].indexOf(document.activeElement) : -1")
    await js("$('#pi-overview-list .pi-overview-cell').focus()")
    assert.equal(await lane(), 'running', 'focus starts in the first lane')
    await pageInput('right')
    assert.equal(await lane(), 'settled', 'right input crosses to the next lane')
    await pageInput('right')
    assert.equal(await lane(), 'exited', 'right input reaches the last lane')
    await pageInput('right')
    assert.equal(await lane(), 'exited', 'right input stops at the last lane')
    await pageInput('left')
    await pageInput('left')
    await pageInput('left')
    assert.equal(await lane(), 'running', 'left input stops at the first lane')
    const start = await index()
    await pageInput('down')
    assert.equal(await lane(), 'running', 'down input stays inside the lane')
    assert.equal(await index(), start + 1, 'down input moves one card inside the lane')
    for (let step = 0; step < 8; step += 1) await pageInput('down')
    assert.equal(await lane(), 'running', 'down input never leaves the lane')
    assert.equal(await index(), 5, 'down input stops at the lane\'s last card')
    await pageInput('up')
    assert.equal(await index(), 4, 'up input moves one card inside the lane')
  })

  await scenario('complete results render safe Markdown tables on every theme and narrow screens', async () => {
    await reset()
    const text = '# Example result\n\nFirst paragraph.\n\n- Item one\n- Item two\n\n| File | Result |\n| --- | --- |\n| example.js | **Passed** |\n\n```js\nconst value = 42\n```\n\n<script>window.__piUnsafe = true</script>\n\n![remote](https://example.invalid/image.png)\n\n[external](https://example.invalid)\n\nLast result line.'
    resultFixture = { ok: true, events: [{ kind: 'result', toolName: 'bash', text }, { kind: 'result', text: 'Bounded example', truncated: true }] }
    try {
      await refresh()
      assert.deepEqual(await js(`const result = $('.pi-event-result'); return {
        heading: result.querySelector('h3')?.textContent,
        rows: result.querySelectorAll('table tr').length,
        list: result.querySelectorAll('ul li').length,
        code: result.querySelector('pre code')?.textContent.trim(),
        last: result.textContent.includes('Last result line.'),
        tool: result.querySelector('.pi-result-tool')?.textContent,
        unsafe: Boolean(result.querySelector('script, img, a[href]') || window.__piUnsafe),
        truncated: Boolean($('.pi-result-truncated')),
      }`), { heading: 'Example result', rows: 2, list: 2, code: 'const value = 42', last: true, tool: 'bash', unsafe: false, truncated: true })
      for (const theme of ['instrument', 'pixel', 'border-beam']) {
        await js(`odkTheme.set('${theme}')`)
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: false })
        await js("window.dispatchEvent(new Event('resize')); await document.fonts.ready")
        await pause(180)
        assert.equal(await js("const result = $('.pi-event-result'); const scroll = result.querySelector('.pi-result-table-scroll'); return result.scrollWidth <= result.clientWidth + 1 && Boolean(scroll) && getComputedStyle(scroll).overflowX === 'auto'"), true, theme)
      }
    } finally {
      resultFixture = null
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
      await refresh()
    }
  })

  await scenario('a table in any event kind keeps its reading and never freezes the page', async () => {
    // A Markdown table in an assistant reply, which is not a result event: the
    // reading position and focus bookkeeping used to assume every table sat in
    // one, so the next repaint threw and took the whole render pass with it.
    await reset([session('example-a', 'Example: inspect keyboard navigation.', 'running')])
    const before = rendererErrors.length
    resultFixture = { ok: true, events: [
      { kind: 'assistant', text: '# Reply\n\n| A | B |\n| --- | --- |\n| one | two |' },
      { kind: 'assistant', text: 'First reply after the table' },
    ] }
    try {
      await refresh()
      resultFixture.events = [...resultFixture.events, { kind: 'assistant', text: 'Appended after the table' }]
      await refresh()
      assert.equal(rendererErrors.length, before, `renderer errors: ${rendererErrors.join(' | ')}`)
      assert.equal(await js("return $('#pi-events').textContent.includes('Appended after the table')"), true)
      assert.equal(await js("return surface.querySelectorAll('.pi-result-table-scroll').length"), 1)
      // The render pass completes: the list behind the detail still narrows.
      await click('.pi-filter-btn[data-filter="working"]')
      assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 1)
      assert.equal(await js("return $('.pi-filter-btn.active').dataset.filter"), 'working')
    } finally {
      resultFixture = null
      await refresh()
    }
  })

  await scenario('a running session without delivered events states the delivery gap', async () => {
    await reset([session('example-a', 'Example running session', 'running')])
    resultFixture = { ok: false, reason: 'no-reported-events' }
    try {
      await refresh()
      const note = await js("return $('#pi-events-host').textContent")
      assert.match(note, /Pi is running/i)
      assert.match(note, /No events have arrived/i)
      assert.doesNotMatch(note, /has not reported/i)
    } finally {
      resultFixture = null
      await refresh()
    }
  })

  await scenario('result tables retain horizontal reading and focus on refresh', async () => {
    await reset([session('example-a', 'Example table reading', 'settled')])
    resultFixture = { ok: true, events: [{ kind: 'result', text: '| A | B | C | D | E | F | G | H |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| data | data | data | data | data | data | data | data |' }] }
    try {
      await refresh()
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 320, height: 480, deviceScaleFactor: 1, mobile: false })
      await js("window.dispatchEvent(new Event('resize'))")
      await pause(200)
      await js("const table = $('.pi-result-table-scroll'); table.focus(); table.scrollLeft = 80; window.__piTableScroll = table.scrollLeft")
      for (const append of [false, true]) {
        if (append) resultFixture.events.push({ kind: 'assistant', text: 'Example appended message' })
        await refresh()
        assert.equal(await js("return document.activeElement === $('.pi-result-table-scroll') && $('.pi-result-table-scroll').scrollLeft === window.__piTableScroll && window.__piTableScroll > 0"), true)
      }
      const table = '| A | B | C | D | E | F | G | H |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| data | data | data | data | data | data | data | data |'
      resultFixture = { ok: true, events: [
        { kind: 'result', text: '# Older result\n\n' + table },
        { kind: 'result', text: '# Retained result\n\n' + table },
        ...Array.from({ length: 58 }, (_, i) => ({ kind: 'assistant', text: 'Example ' + i })),
      ] }
      await refresh()
      await js("const table = surface.querySelectorAll('.pi-result-table-scroll')[1]; table.focus(); table.scrollLeft = 80; window.__piTableScroll = table.scrollLeft")
      resultFixture.events = [...resultFixture.events.slice(1), { kind: 'assistant', text: 'Example new event' }]
      await refresh()
      assert.equal(await js("return document.activeElement === $('.pi-result-table-scroll') && $('.pi-result-table-scroll').scrollLeft === window.__piTableScroll && $('.pi-event-result').textContent.includes('Retained result')"), true)
    } finally {
      resultFixture = null
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
      await refresh()
    }
  })

  await scenario("a reply renders as Markdown with Pi's own reading colours", async () => {
    await reset()
    resultFixture = { ok: true, events: [{ kind: 'assistant', text: '# Example heading\n\nA **bold** word and `inline code`.\n\n- first item\n- second item' }] }
    try {
      await refresh()
      const read = await js(`return (() => {
        const rgb = selector => { const node = $(selector); return node ? getComputedStyle(node).color : null };
        const heading = $('.pi-event-assistant .pi-markdown h3');
        return {
          multiline: $('.pi-event-assistant .pi-event-body').textContent.includes(String.fromCharCode(10)),
          items: surface.querySelectorAll('.pi-event-assistant .pi-markdown li').length,
          bold: Boolean($('.pi-event-assistant .pi-markdown strong')),
          heading: heading?.textContent,
          headingColour: heading ? getComputedStyle(heading).color : null,
          codeColour: rgb('.pi-event-assistant .pi-markdown code'),
          proseColour: rgb('.pi-event-assistant .pi-markdown p'),
          html: surface.querySelectorAll('.pi-event-assistant script, .pi-event-assistant a[href]').length,
        };
      })()`)
      assert.deepEqual(read, {
        multiline: true, items: 2, bold: true, heading: 'Example heading',
        headingColour: 'rgb(240, 198, 116)', codeColour: 'rgb(138, 190, 183)',
        proseColour: 'rgb(255, 255, 255)', html: 0,
      })
    } finally {
      resultFixture = null
      await refresh()
    }
  })

  await scenario("code fences and diffs carry Pi's syntax colours", async () => {
    await reset()
    resultFixture = { ok: true, events: [
      { kind: 'result', toolName: 'read', text: '```js\nconst answer = 42 // a note\nconst label = "value"\n```' },
      { kind: 'result', toolName: 'bash', text: '--- a/example.js\n+++ b/example.js\n@@ -1,2 +1,2 @@\n-const removed = 1\n+const added = 2\n const context = 3' },
      { kind: 'result', toolName: 'bash', text: '- a plain bullet\n- another bullet' },
    ] }
    try {
      await refresh()
      const read = await js(`return (() => {
        const results = [...surface.querySelectorAll('.pi-event-result')];
        const colour = (root, selector) => {
          const node = root.querySelector(selector);
          return node ? getComputedStyle(node).color : null;
        };
        return {
          keyword: colour(results[0], '.hljs-keyword'),
          string: colour(results[0], '.hljs-string'),
          comment: colour(results[0], '.hljs-comment'),
          hunk: colour(results[1], '.pi-diff-hunk'),
          added: colour(results[1], '.pi-diff-added'),
          removed: colour(results[1], '.pi-diff-removed'),
          context: colour(results[1], '.pi-diff-context'),
          addedText: results[1].querySelector('.pi-diff-added')?.textContent,
          plainBullets: results[2].querySelectorAll('.pi-diff-added, .pi-diff-removed').length,
        };
      })()`)
      assert.deepEqual(read, {
        keyword: 'rgb(86, 156, 214)', string: 'rgb(206, 145, 120)', comment: 'rgb(106, 153, 85)',
        hunk: 'rgb(0, 215, 255)', added: 'rgb(181, 189, 104)', removed: 'rgb(204, 102, 102)',
        context: 'rgb(128, 128, 128)', addedText: '+const added = 2', plainBullets: 0,
      })
    } finally {
      resultFixture = null
      await refresh()
    }
  })

  await scenario('three themes and compact geometry keep the page readable', async () => {
    const long = 'Example: readable session purpose / 示例：明确的会话目标与状态。 '.repeat(6)
    await reset([session('example-a', long), session('example-b', 'Example second goal')])
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      for (const [width, height] of [[1920, 1280], [960, 640], [480, 854], [320, 480]]) {
        win.setContentSize(width, height)
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        await js("window.dispatchEvent(new Event('resize')); await document.fonts.ready")
        await until(`return window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)
        await until("return Math.abs(surface.closest('.page').getBoundingClientRect().left) <= 1")
        await showOverview()
        const failures = await js(`
          const failures = [];
          for (const node of surface.querySelectorAll('button, .pi-overview-goal, .pi-overview-path, #pi-title, .pi-goal-text, .pi-event-text')) {
            if (!node.getClientRects().length || node.closest('[hidden]')) continue;
            const rect = node.getBoundingClientRect();
            if (node.scrollWidth > node.clientWidth + 2) failures.push(node.className + ': overflow');
            if (node.tagName === 'BUTTON' && rect.height < 44) failures.push(node.className + ': target');
            if (parseFloat(getComputedStyle(node).fontSize) < 12) failures.push(node.className + ': type');
          }
          const rect = surface.getBoundingClientRect();
          if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) failures.push('surface bounds: ' + JSON.stringify({ rect: rect.toJSON(), width: innerWidth, height: innerHeight, page: document.querySelector('#page-context').textContent }));
          return failures;
        `)
        assert.deepEqual(failures, [], `${theme} ${width}x${height}: ${failures.join(', ')}`)
        await js("surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        await pause(60)
      }
    }
    // The page publishes one Strip control, the Session Filter; the Remote's
    // persistent Back and Select remain the rest of its interface.
    assert.deepEqual(remoteState.actions, [{ id: 'pi-session-filter', label: 'LIVE' }])
    assert.equal(remoteState.focus, 'items')
  })

  await scenario('a thought is folded to Thinking... and opens only on configured reasoning', async () => {
    // The page's reading contract: the desk shows that Pi thought, not what Pi
    // thought, until the device's runtime display says otherwise.
    // The scenario reads geometry, so it runs at the shell's own size: the
    // previous scenario leaves the window at its compact test size.
    win.setContentSize(1920, 1280)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
    await js("window.dispatchEvent(new Event('resize')); await document.fonts.ready")
    await reset([session('example-a', 'Example reasoning session', 'settled')])
    const cycle = ['user', 'thinking', 'tool', 'thinking', 'assistant']
    const group = (index) => [
      { kind: 'user', text: `Example prompt ${index}` },
      { kind: 'thinking', text: `Example reasoning body ${index}: checking the composer before changing it.`, truncated: index === 0 },
      { kind: 'tool', toolName: 'bash', text: `bash: pnpm test ${index}` },
      { kind: 'thinking', text: `Example second thought ${index}: the fold repeats one line of copy.` },
      { kind: 'assistant', text: `Example reply ${index}` },
    ]
    resultFixture = { ok: true, events: [0, 1, 2, 3, 4, 5].flatMap(group) }
    try {
      await refresh()
      assert.deepEqual(await js(`const folded = [...surface.querySelectorAll('.pi-event-thinking')]; return {
        rows: surface.querySelectorAll('.pi-event').length,
        order: [...surface.querySelectorAll('.pi-event')].map(node => [...node.classList].find(name => name.startsWith('pi-event-'))).join(','),
        folded: folded.length,
        visible: [...new Set(folded.map(node => node.querySelector('.pi-event-text').textContent.trim()))].join('|'),
        body: surface.querySelector('#pi-events').textContent.includes('checking the composer'),
        markdown: folded.reduce((count, node) => count + node.querySelectorAll('p, pre, code').length, 0),
        kindLabel: folded.filter(node => node.querySelector('.pi-event-kind')).length,
        truncated: surface.querySelectorAll('.pi-result-truncated').length,
      }`), {
        // One turn of folded reasoning reads as one quiet row, so the second
        // thought of each group is not a second row of the same copy.
        rows: 24,
        order: Array.from({ length: 6 }, () => ['user', 'thinking', 'tool', 'assistant']).flat().map((kind) => `pi-event-${kind}`).join(','),
        folded: 6,
        visible: 'Thinking...',
        body: false,
        markdown: 0,
        kindLabel: 0,
        truncated: 0,
      })
      // The fold is display only: the stream still keeps the body Pi produced.
      assert.equal(await js("return surface.querySelector('.pi-event-assistant .pi-event-text').textContent.includes('Example reply 0')"), true)
      // A folded row repeats one line of copy, so a settled reader is kept by the
      // row's place in the stream rather than by its text alone.
      const anchored = await js(`const detail = $('#pi-detail'); const rows = [...surface.querySelectorAll('.pi-event')];
        const viewTop = detail.getBoundingClientRect().top;
        const thought = [...rows].filter(node => node.classList.contains('pi-event-thinking'))[1];
        const height = thought.getBoundingClientRect().height;
        detail.scrollTop += (thought.getBoundingClientRect().top - viewTop) + Math.ceil(height / 2);
        return {
          top: Math.round(detail.scrollTop),
          thought: rows.indexOf(thought),
          anchored: rows.findIndex(node => node.getBoundingClientRect().bottom > viewTop),
          height,
          scrolled: detail.scrollHeight > detail.clientHeight,
        }`)
      assert.equal(anchored.scrolled && anchored.top > 0 && anchored.anchored === anchored.thought, true, `the second thought must be the anchored row: ${JSON.stringify(anchored)}`)
      await refresh()
      assert.deepEqual(await js(`const detail = $('#pi-detail'); const rows = [...surface.querySelectorAll('.pi-event')];
        const viewTop = detail.getBoundingClientRect().top;
        return { top: Math.round(detail.scrollTop), anchored: rows.findIndex(node => node.getBoundingClientRect().bottom > viewTop) }`), { top: anchored.top, anchored: anchored.thought })

      // The desk's runtime display is launch configuration, so the harness
      // relaunches the renderer with the query the main process would build.
      await relaunch('?piReasoning=shown')
      assert.equal(await js("return window.odkRuntimeConfig.current.piSessionReasoning"), 'shown')
      await until("return surface.querySelectorAll('.pi-event').length === 30")
      assert.deepEqual(await js(`const shown = surface.querySelector('.pi-event-thinking'); return {
        body: shown.textContent.includes('checking the composer before changing it.'),
        kindLabel: Boolean(shown.querySelector('.pi-event-kind')),
        truncated: shown.querySelector('.pi-result-truncated')?.textContent,
        folded: surface.querySelectorAll('.pi-event.is-folded').length,
      }`), { body: true, kindLabel: true, truncated: 'Message truncated at the 4 KiB safety limit.', folded: 0 })

      // An unrecognized launch value is not a second way to publish reasoning.
      await relaunch('?piReasoning=SHOWN')
      assert.equal(await js("return window.odkRuntimeConfig.current.piSessionReasoning"), 'hidden')
      await until("return surface.querySelectorAll('.pi-event').length === 24")
      assert.equal(await js("return [...new Set([...surface.querySelectorAll('.pi-event-thinking .pi-event-text')].map(node => node.textContent.trim()))].join('|')"), 'Thinking...')
      assert.equal(await js("return surface.querySelector('#pi-events').textContent.includes('checking the composer')"), false)
    } finally {
      resultFixture = null
      await relaunch('')
      await refresh()
    }
  })

  // Windows presents an Xbox-style pad with the standard mapping, so the harness
  // presents the page the same thing the browser would and drives the desk the way
  // its owner does. This is the page's own navigation, reached through the pad.
  await scenario('a gamepad drives the desk through the desk\'s own navigation intents', async () => {
    const rp = (body) => win.webContents.executeJavaScript(`(() => { const $ = selector => document.querySelector(selector); ${body} })()`)
    const activePage = () => rp("return [...document.querySelectorAll('.dot')].findIndex(dot => dot.getAttribute('aria-current') === 'page')")

    await rp(`(() => {
      const held = new Set();
      const pad = { index: 0, id: 'Xbox Wireless Controller (fixture)', connected: true, mapping: 'standard' };
      const source = () => [{ ...pad, buttons: Array.from({ length: 17 }, (_value, index) => ({ pressed: held.has(index), value: held.has(index) ? 1 : 0 })) }];
      try { navigator.getGamepads = source } catch (error) { Object.defineProperty(navigator, 'getGamepads', { value: source, configurable: true }) }
      window.__odkMic = [];
      const voice = window.odkPersonalBotStatus;
      const originalMic = voice.mic.bind(voice);
      voice.mic = () => { window.__odkMic.push('mic'); return originalMic() };
      window.__odkRestoreMic = () => { voice.mic = originalMic };
      window.__odkHold = (indexes) => { held.clear(); for (const index of indexes) held.add(index) };
      window.__odkPadOff = () => { pad.connected = false };
      window.dispatchEvent(new Event('gamepadconnected'));
      return true;
    })()`)
    await pause(200)

    // A known page to change away from.
    await rp("document.querySelectorAll('.dot')[0].click(); return true")
    await pause(250)

    // The desk states the pad it can read.
    assert.equal(await rp("return $('#sb-pad').hidden"), false, 'the desk states the connected pad')
    assert.match(await rp("return $('#sb-pad').getAttribute('aria-label')"), /Gamepad connected: Xbox Wireless Controller/)
    assert.equal(await rp("return $('#sb-pad').dataset.readable"), 'true')

    // The shoulders change page, and the directional pad does not.
    const start = await activePage()
    await rp("window.__odkHold([5]); return true")
    await pause(200)
    assert.equal(await activePage(), start + 1, 'the right shoulder shows the next page')
    await rp("window.__odkHold([4]); return true")
    await pause(200)
    assert.equal(await activePage(), start, 'the left shoulder shows the previous page')
    await rp("window.__odkHold([]); return true")
    await pause(120)

    // A focuses the page that owns its input, and B leaves that focus.
    await enterPage()
    await pageInput('back')
    await rp("window.__odkHold([0]); return true")
    await pause(250)
    assert.equal(await js("return surface.closest('.page').contains(document.activeElement)"), true, 'A focuses the page')
    await rp("window.__odkHold([]); return true")
    await pause(150)
    await rp("window.__odkHold([1]); return true")
    await pause(250)
    assert.equal(await js("return surface.closest('.page').contains(document.activeElement)"), false, 'B leaves the page focus')
    await rp("window.__odkHold([]); return true")
    await pause(150)

    // Y reaches the desk's own microphone entry point, the same one the Remote
    // Control's MIC reaches through the link.
    await rp("window.__odkHold([3]); return true")
    await pause(200)
    assert.deepEqual(await rp('return window.__odkMic'), ['mic'], 'Y reaches the microphone entry point')
    await rp("window.__odkHold([]); return true")
    await pause(150)

    // A pad that goes away is stated as gone, and the page is left as it was.
    await rp("window.__odkPadOff(); return true")
    await pause(300)
    assert.equal(await rp("return $('#sb-pad').hidden"), true, 'the desk states no pad once it is gone')
    await rp('window.__odkRestoreMic(); delete navigator.getGamepads; return true')
    await pause(120)
    await reset()
  })

  const capture = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)
  if (capture) {
    assert.equal(path.isAbsolute(capture), true)
    fs.mkdirSync(capture, { recursive: true })
    win.setContentSize(1920, 1280)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
    await reset()
    await js("window.odkTheme.set('pixel'); window.dispatchEvent(new Event('resize')); await document.fonts.ready")
    await pause(400)
    await js("$('#pi-detail').scrollTop = 0")
    fs.writeFileSync(path.join(capture, 'pi-detail-example.png'), (await win.webContents.capturePage()).toPNG())
    await pageInput('primary')
    await pause(200)
    fs.writeFileSync(path.join(capture, 'pi-overview-example.png'), (await win.webContents.capturePage()).toPNG())
  }
  console.log(`PI_INTERACTION_RESULT=${JSON.stringify({ ok: results.every(result => result.ok), fixtures: 'example-only', hidden: !win.isVisible(), results })}`)
  app.exit(results.every(result => result.ok) ? 0 : 1)
}
const timeout = setTimeout(() => { console.error('PI_INTERACTION_TIMEOUT'); app.exit(1) }, 90000)
app.whenReady().then(main).then(() => clearTimeout(timeout)).catch(error => { console.error(error); app.exit(1) })