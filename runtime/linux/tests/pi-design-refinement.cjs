const { resolvePages } = require('./helpers/pages')

// The Pi Sessions page is a single-session instrument: the title row carries
// only the title, one Session Detail fills the main area, and the Session
// Overview is the screen-side chooser and filter entry.
async function run(win, check, setSessions) {
  const pages = await resolvePages(win)
  const enterPage = async () => {
    await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  await enterPage()
  const localFixture = await win.webContents.executeJavaScript(`window.odkPlatform.getPiSessions()`)
  const results = await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
    const find = selector => surface.querySelector(selector)
    const tick = () => new Promise(resolve => setTimeout(resolve, 60))
    const results = []
    const record = (name, value) => results.push([name, Boolean(value)])

    const header = find('.pi-app-header')
    record('title row carries only the heading', Boolean(header) &&
      header.querySelectorAll('h1').length === 1 &&
      header.querySelectorAll('button, input, select, summary, .pi-metric-pill, .pi-filter-btn, #pi-source-label').length === 0)

    record('removed page controls stay removed', ['#pi-search-input', '#pi-refresh-btn', '#pi-view-toggle',
      '#pi-source-label', '.pi-sessions-feed', '.pi-session-card', '.pi-metric-pill', '.pi-workspace-section']
      .every(selector => find(selector) === null))

    const fixture = await window.odkPlatform.getPiSessions()
    const detail = find('#pi-detail')
    record('exactly one session detail is shown', Boolean(detail) && detail.hidden === false && surface.querySelectorAll('#pi-detail .pi-status-badge').length === 1)
    record('detail identifies status workspace and elapsed time',
      Boolean(find('.pi-detail-identity .pi-status-badge')) &&
      Boolean(find('.pi-detail-identity .pi-ws-title')) &&
      /elapsed/.test(find('.pi-detail-identity .pi-card-time').textContent))
    record('detail reports position within the session set', /^\\d+ \\/ \\d+$/.test(find('.pi-detail-position').textContent.trim()))
    record('detail states the session position honestly', find('.pi-detail-position').textContent.trim() !== '1 / 0' || fixture.sessions.length === 0)
    record('the data source is not named in the session detail', !find('#pi-detail').textContent.includes(fixture.source.label))
    record('detail offers no process identifier or file list', find('.pi-card-pid') === null && find('.pi-files-list') === null && find('.pi-files-toggle') === null)

    const events = [...surface.querySelectorAll('#pi-events .pi-event')]
    record('event stream renders kinds and bounded single lines', events.length > 0 &&
      events.every(event => Boolean(event.querySelector('.pi-event-kind').textContent.trim())) &&
      events.every(event => event.querySelector('.pi-event-text').textContent.length <= 200) &&
      events.every(event => !event.querySelector('.pi-event-text').textContent.includes('\\n')))

    const overview = find('#pi-overview')
    record('session overview starts closed', overview.hidden === true && detail.hidden === false)

    find('#pi-overview-open').click()
    await tick()
    record('session overview opens from the screen control', overview.hidden === false && detail.hidden === true)
    record('session overview names the set size and the source',
      find('#pi-overview-summary').textContent.includes(fixture.source.label))

    const cells = [...surface.querySelectorAll('.pi-overview-cell')]
    record('session overview renders one cell per member of the session set', cells.length === fixture.sessions.length)
    record('session overview marks the selected session', surface.querySelectorAll('.pi-overview-cell.is-selected').length === 1)
    record('session overview carries the screen-side filter controls',
      ['all', 'working', 'settled', 'exited'].every(value => Boolean(surface.querySelector('.pi-filter-btn[data-filter="' + value + '"]'))))

    surface.querySelector('.pi-filter-btn[data-filter="all"]').click()
    await tick()
    record('the screen-side filter is applied and pressed', surface.querySelector('.pi-filter-btn[data-filter="all"]').getAttribute('aria-pressed') === 'true')

    const skillCell = cells.find(cell => cell.querySelector('.pi-overview-name').textContent === 'Second desk')
    skillCell.click()
    await tick()
    record('choosing a cell closes the overview', overview.hidden === true && detail.hidden === false)
    record('choosing a cell selects that session', find('.pi-ws-title').textContent === 'Second desk')
    const goalHtml = find('.pi-goal-text').innerHTML
    record('a skill invocation goal renders as a bracketed skill tag',
      goalHtml.includes('[skill]') && goalHtml.includes('marketing') && !goalHtml.includes('<skill name='))
    record('the detail shows the latest model activity', find('.pi-activity-text').textContent.trim().length > 0)

    const longStream = document.querySelectorAll('#pi-events .pi-event').length > 20
    record('a long event stream stays reachable inside the detail',
      getComputedStyle(detail).overflowY === 'auto' && (!longStream || detail.scrollHeight > detail.clientHeight))
    return results
  })()`)
  for (const [name, value] of results) check(`Pi refinement: ${name}`, value)

  // A Mac over SSH source keeps no local session log, so the detail must state
  // that this source provides no session events rather than render nothing.
  setSessions({ source: { kind: 'ssh', label: 'Mac / SSH · test-mac' }, summary: localFixture.summary, sessions: localFixture.sessions })
  await enterPage()
  const remote = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
    return {
      detail: surface.querySelector('#pi-events-host').textContent,
      identity: surface.querySelector('.pi-detail-identity')?.textContent || '',
      summary: surface.querySelector('#pi-overview-summary').textContent,
    }
  })()`)
  check('Pi refinement: a Mac over SSH source states that session events are unavailable', /session events are unavailable for Mac \/ SSH/i.test(remote.detail))
  check('Pi refinement: a Mac over SSH source still shows the session identity', remote.identity.length > 0)
  check('Pi refinement: the session overview names the Mac source', remote.summary.includes('Mac / SSH'))

  setSessions(localFixture)
  await enterPage()
}

module.exports = { run }