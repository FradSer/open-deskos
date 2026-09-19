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
let snapshot
let pendingEvent = null
let eventRequests = 0
let holdEvents = false
let resultFixture = null
let remoteState
function publish(items = initial) {
  snapshot = { ok: true, source: { kind: 'local', label: 'Example fixture' }, sessions: items,
    summary: { running: items.filter(item => item.status === 'running').length, total: items.length, workspacesCount: 1 } }
}
publish()
const events = id => ({ ok: true, events: Array.from({ length: 48 }, (_, index) => ({ kind: ['user', 'thinking', 'tool', 'result', 'assistant'][index % 5], text: `${id}: example event ${index + 1}` })) })
ipcMain.handle('odk-pi-sessions', () => snapshot)
ipcMain.handle('odk-pi-session-events', (_event, query) => {
  eventRequests += 1
  if (holdEvents) return new Promise(resolve => { pendingEvent = () => resolve(events(query.sessionId)) })
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
async function scenario(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`) }
}

async function main() {
  win = new BrowserWindow({ width: 1920, height: 1280, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.debugger.attach('1.3')
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false })
  await win.webContents.executeJavaScript('document.fonts.ready')
  const pages = await resolvePages(win)
  surface = `${pages.surface('pi-sessions')} .pi-app-wrapper`
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await pause(400)
  assert.equal(win.isVisible(), false, 'the test window must stay hidden')

  await scenario('the page lands on a live list of started sessions only', async () => {
    publish([...initial, session('example-settled', 'Example settled goal', 'settled'), session('example-exited', 'Example exited goal', 'exited')])
    await refresh()
    await showOverview()
    assert.equal(await js("return !$('#pi-overview').hidden"), true)
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-overview-goal')].map(node => node.textContent.trim())"), ['Example: inspect keyboard navigation.', 'Example: 优化会话阅读与返回。', 'Example settled goal'])
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 3)
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /^3 live sessions · Example fixture$/)
    assert.equal(await js("return $('#pi-overview').textContent.includes('Example exited goal')"), false)
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /3 live sessions/)
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

  await scenario('Hosted Pi attribution appears only in the overview header', async () => {
    await reset([session('example-a', 'Example Hosted Pi goal', 'settled', {
      hostedPi: true,
      controlAttribution: { machine: 'desk-mac', sessionId: 'console-example' },
    })])
    await showOverview()
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /Driven by desk-mac · console-example/)
    await click('.pi-filter-btn[data-filter="working"]')
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /Driven by desk-mac · console-example/)
    await click('.pi-filter-btn[data-filter="live"]')
    assert.equal(await js("return $('.pi-overview-path').textContent"), 'Hosted Pi · /example/workspace')
    await js("$('.pi-overview-cell').click()")
    await pause()
    assert.equal(await js("return $('#pi-detail').textContent.includes('desk-mac') || $('#pi-detail').textContent.includes('console-example')"), false)
    assert.equal(await js("return $('#pi-view-facts').textContent.includes('desk-mac')"), false)
  })

  await scenario('the Session Overview carries the Session Filter and the detail never does', async () => {
    await reset()
    assert.equal(await js("return $('#pi-overview').querySelectorAll('.pi-filter-btn').length"), 5)
    assert.equal(await js("return $('#pi-detail').querySelectorAll('.pi-filter-btn').length"), 0)
    publish([...initial, session('example-idle', 'Example idle goal', 'settled'), session('example-exited', 'Example exited goal', 'exited')])
    await refresh()
    await showOverview()
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-filter-btn')].map(node => [node.dataset.filter, node.querySelector('.pi-filter-count').textContent, node.getAttribute('aria-pressed')])"),
      [['live', '3', 'true'], ['working', '2', 'false'], ['idle', '1', 'false'], ['exited', '1', 'false'], ['all', '4', 'false']])
    // The page still lands on started sessions only.
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-overview-goal')].map(node => node.textContent.trim())"),
      ['Example: inspect keyboard navigation.', 'Example: 优化会话阅读与返回。', 'Example idle goal'])
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /^3 live sessions · Example fixture$/)
    // A status tab narrows the list without leaving the page.
    const page = await js("return document.querySelector('#page-context').textContent")
    await click('.pi-filter-btn[data-filter="exited"]')
    assert.deepEqual(await js("return [...surface.querySelectorAll('.pi-overview-goal')].map(node => node.textContent.trim())"), ['Example exited goal'])
    assert.equal(await js(`return $(".pi-filter-btn[data-filter='exited']").getAttribute('aria-pressed')`), 'true')
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /^1 exited session · Example fixture$/)
    assert.equal(await js("return document.querySelector('#page-context').textContent"), page)
    // All is the union, so live history stays reachable on request.
    await click('.pi-filter-btn[data-filter="all"]')
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 4)
    await click('.pi-filter-btn[data-filter="live"]')
    assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length"), 3)
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
      assert.equal(await js("return $('#pi-view-subtitle').textContent.includes('live session')"), true, input)
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
    assert.match(await js("return $('#pi-view-subtitle').textContent"), /^0 live sessions/)
    assert.equal(await js(`return $(".pi-filter-btn[data-filter='exited'] .pi-filter-count").textContent`), '1')
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
    assert.equal(await js("return [...surface.querySelectorAll('.pi-event-text')].every(node => node.textContent.startsWith('example-b:'))"), true)
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
      assert.equal(await js("return surface.querySelectorAll('.pi-overview-cell').length === 0 && /unavailable/i.test($('#pi-overview').textContent)"), true)
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

  await scenario('the live list is a native Pi style single-column chooser', async () => {
    await reset()
    await showOverview()
    const chooser = await js(`
      const cells = [...surface.querySelectorAll('.pi-overview-cell')];
      const list = $('#pi-overview-list');
      return {
        column: getComputedStyle(list).flexDirection === 'column',
        fullWidth: cells[0].getBoundingClientRect().width >= list.clientWidth - 2,
        cursor: Boolean($('.pi-overview-cell.is-selected .pi-overview-cursor')),
        band: getComputedStyle(cells[0]).backgroundColor !== 'rgba(0, 0, 0, 0)',
        noBorders: cells.every(node => parseFloat(getComputedStyle(node).borderWidth) === 0),
        states: cells.every(node => node.querySelector('.pi-overview-state').textContent.trim().length > 0),
      };
    `)
    assert.deepEqual(chooser, { column: true, fullWidth: true, cursor: true, band: true, noBorders: true, states: true })
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