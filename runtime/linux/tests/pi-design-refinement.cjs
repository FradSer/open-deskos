const { resolvePages } = require('./helpers/pages')

// The Pi Sessions page states the live Pi state and nothing else: it carries no
// page title beyond the view h1 and no session controls. The Session Overview
// is its home and owns the status filter; a chosen session becomes the title,
// and the Session Detail itself stays control-free.
async function run(win, check, setSessions, setEvents = () => {}) {
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
    const tick = () => new Promise(resolve => setTimeout(resolve, 80))
    const results = []
    const record = (name, value, detail) => results.push([name, Boolean(value), detail])
    const cells = () => [...surface.querySelectorAll('.pi-overview-cell')]

    try {
    const header = find('.pi-app-header')
    const headerTabs = header ? [...header.querySelectorAll('.pi-filter-btn')] : []
    // The title row carries one heading and exactly the Session Filter: the
    // filter acts on the list beneath it, so it belongs on the row's trailing
    // edge, and nothing else joins it there.
    record('the title row carries one heading and only the Session Filter', Boolean(header) &&
      header.querySelectorAll('h1').length === 1 &&
      headerTabs.length === 5 &&
      header.querySelectorAll('button, input, select').length === headerTabs.length &&
      header.querySelectorAll('input, #pi-refresh-btn, .pi-metric-pill, .pi-view-toggle, #pi-source-label').length === 0)
    record('the title row carries no search, refresh, or metric control', Boolean(header) &&
      header.querySelectorAll('input, #pi-refresh-btn, .pi-metric-pill, .pi-view-toggle, #pi-source-label').length === 0)
    record('the filter tabs hold the title row trailing edge', Boolean(header) &&
      find('#pi-overview-filters') !== null &&
      find('#pi-overview-filters').parentElement === header &&
      find('#pi-overview-filters').hidden === false &&
      header.contains(headerTabs[0]) &&
      Math.abs(find('#pi-overview-filters').getBoundingClientRect().right - header.getBoundingClientRect().right) <= 1)

    // Controls the leader removed stay removed: no session stepper, no
    // page-owned overview button, no process status badge. The status filter
    // now lives on the Session Overview.
    record('removed page controls stay removed', ['#pi-search-input', '#pi-refresh-btn', '#pi-view-toggle',
      '#pi-source-label', '.pi-sessions-feed', '.pi-session-card', '.pi-metric-pill', '.pi-workspace-section',
      '.pi-filter-group', '.pi-overview-open', '.pi-session-step', '.pi-overview-close',
      '.pi-status-badge', '.pi-ws-title', '.pi-detail-position', '#pi-overview-summary',
      '.pi-overview-grid', '.pi-overview-name']
      .every(selector => find(selector) === null))

    const fixture = await window.odkPlatform.getPiSessions()
    const live = fixture.sessions.filter(session => session.status !== 'exited')
    const byStatus = status => fixture.sessions.filter(session => session.status === status)

    // The list is the page's home view.
    const list = find('#pi-overview')
    record('the page lands on the live session list', list.hidden === false && find('#pi-detail').inert === true)

    // The Overview owns the status filter, in a fixed display order.
    const filters = [...surface.querySelectorAll('#pi-overview-filters .pi-filter-btn')]
    record('the Overview carries the status filter tabs in display order',
      Boolean(find('#pi-overview-filters[role="group"][aria-label="Session status filter"]')) &&
      filters.map(button => button.dataset.filter).join(',') === 'live,working,idle,exited,all' &&
      filters.map(button => button.querySelector('.pi-filter-count') !== null).every(Boolean) &&
      filters.every((button, index) =>
        button.textContent.startsWith(['Live', 'Working', 'Idle', 'Exited', 'All'][index])))
    record('the default filter is the live set',
      find('.pi-filter-btn.active')?.dataset.filter === 'live' &&
      find('.pi-filter-btn.active').getAttribute('aria-pressed') === 'true' &&
      filters.filter(button => button.getAttribute('aria-pressed') === 'true').length === 1)
    record('the filter tabs count the scan truthfully',
      filters.map(button => button.querySelector('.pi-filter-count').textContent).join(',') ===
      [live.length, byStatus('running').length, byStatus('settled').length, byStatus('exited').length, fixture.sessions.length].join(','))
    record('the filtered set is named with the source',
      find('#pi-view-subtitle').textContent ===
      live.length + ' live session' + (live.length === 1 ? '' : 's') + ' · ' + fixture.source.label)

    record('the live list renders one row per started session', cells().length === live.length)
    record('no exited session is listed', cells().every((cell, index) =>
      cell.querySelector('.pi-overview-path').textContent === live[index].cwd))
    record('the live list marks exactly one selected session',
      surface.querySelectorAll('.pi-overview-cell.is-selected').length === 1)
    record('the Shell focus entry point follows the visible list',
      surface.querySelectorAll('.pi-overview-cell.is-selected[data-page-focus]').length === 1 &&
      find('#pi-detail').hasAttribute('data-page-focus') === false)
    record('each live row states its Pi state', cells().every(cell =>
      /^(Working\\.\\.\\.|Idle|Exited)$/.test(cell.querySelector('.pi-overview-state .pi-state-text').textContent.trim())))

    // Exited history is one deliberate press away.
    const exited = byStatus('exited').length
    find('.pi-filter-btn[data-filter="exited"]').click()
    await tick()
    record('exited sessions appear only when the operator asks',
      cells().length === exited &&
      (exited > 0
        ? cells().every(cell => cell.querySelector('.pi-overview-state .pi-state-text').textContent.trim() === 'Exited')
        : /No session matches Exited\\./.test(find('#pi-overview-list .pi-empty-state')?.textContent || '')))
    record('the filtered subtitle names the active filter',
      find('#pi-view-subtitle').textContent === exited + ' exited session' + (exited === 1 ? '' : 's') + ' · ' + fixture.source.label)
    find('.pi-filter-btn[data-filter="live"]').click()
    await tick()
    record('returning to the live filter restores the started sessions',
      cells().length === live.length && find('#pi-view-subtitle').textContent.includes('live session'))

    // Choosing a row makes that session the page title.
    cells()[0].click()
    await tick()
    record('choosing a row shows that session without leaving the page', list.hidden === true && find('#pi-detail').inert === false)
    record('the detail title is the session state with the native indicator',
      /^(Working\\.\\.\\.|Idle|Exited)$/.test(find('#pi-title-text').textContent) &&
      find('#pi-title .pi-spinner').hidden === (find('#pi-title-text').textContent !== 'Working...'))
    record('the detail title carries the session directory',
      find('#pi-view-subtitle').textContent === cells()[0].querySelector('.pi-overview-path').textContent)
    record('the Session Detail carries no filter tabs or session controls',
      find('#pi-detail').querySelectorAll('button, input, select, summary').length === 0 &&
      find('#pi-detail .pi-filter-btn') === null && find('#pi-detail .pi-overview-filters') === null &&
      find('.pi-session-step') === null && find('.pi-overview-open') === null &&
      find('#pi-overview-summary') === null && find('.pi-detail-position') === null)
    // The list's filter leaves the title row while a session is being read, and
    // that session's elapsed time takes the same trailing edge.
    record('reading a session hides the tabs and states elapsed time on the trailing edge',
      find('#pi-overview-filters').hidden === true &&
      find('#pi-view-facts').getBoundingClientRect().width > 0 &&
      Math.abs(find('#pi-view-facts').getBoundingClientRect().right - header.getBoundingClientRect().right) <= 1 &&
      find('#pi-overview-filters').querySelectorAll('.pi-filter-btn').length === 5,
      {
        filtersHidden: find('#pi-overview-filters').hidden,
        factsWidth: find('#pi-view-facts').getBoundingClientRect().width,
        factsRight: find('#pi-view-facts').getBoundingClientRect().right,
        headerRight: header.getBoundingClientRect().right,
        headerWidth: header.getBoundingClientRect().width,
        tabs: find('#pi-overview-filters').querySelectorAll('.pi-filter-btn').length,
        innerWidth,
      })
    record('the detail states elapsed time', /elapsed/.test(find('#pi-view-facts').textContent))
    record('the detail offers no process identifier or file list', find('.pi-card-pid') === null && find('.pi-files-list') === null && find('.pi-files-toggle') === null)
    record('the detail shows the latest model activity', find('.pi-activity-text').textContent.trim().length > 0)

    const events = [...surface.querySelectorAll('#pi-events .pi-event')]
    // A folded thought states its own kind in its own words, so it carries no
    // repeated assistive label; every other kind still does.
    record('event stream renders every kind with a contained body alongside full results', events.length > 0 &&
      events.every(event => event.classList.contains('is-folded')
        ? event.querySelector('.pi-event-text').textContent.trim() === 'Thinking...'
        : Boolean(event.querySelector('.pi-event-kind').textContent.trim())) &&
      events.every(event => {
        const body = event.querySelector('.pi-event-text')
        return Boolean(body) && body.textContent.trim().length > 0 &&
          body.scrollWidth <= body.clientWidth + 2 && event.scrollWidth <= event.clientWidth + 2
      }) &&
      events.some(event => event.classList.contains('pi-event-result')))

    // Native Pi differentiates message roles through flow and tone rather
    // than a repeated role column. The role remains screen-reader text.
    const firstEvent = surface.querySelector('#pi-events .pi-event')
    record('event summaries keep native Pi flow instead of App-list rows',
      Boolean(firstEvent) &&
      getComputedStyle(firstEvent).display === 'block' &&
      firstEvent.querySelector('.pi-event-kind').classList.contains('sr-only') &&
      getComputedStyle(firstEvent).borderBottomWidth === '0px',
      { display: firstEvent ? getComputedStyle(firstEvent).display : 'missing' })

    // The user's own prompt wraps to the container it is given.
    const measured = (() => {
      const goal = find('.pi-goal-text')
      const host = find('#pi-detail-body')
      return { goal: goal.getBoundingClientRect().width, host: host.clientWidth, maxWidth: getComputedStyle(goal).maxWidth }
    })()
    record('the session prompt wraps to its container rather than a fixed measure',
      measured.maxWidth === 'none' && measured.host - measured.goal <= 2, measured)

    const longStream = document.querySelectorAll('#pi-events .pi-event').length > 20
    record('a long event stream stays reachable inside the detail',
      ['auto', 'scroll'].includes(getComputedStyle(find('#pi-detail')).overflowY) && (!longStream || find('#pi-detail').scrollHeight > find('#pi-detail').clientHeight))

    } catch (error) {
      // A probe that throws is one failed check, never a reason to lose the
      // checks that already ran or the ones still to come.
      results.push(['the detail probes all ran', false, String((error && error.stack) || error)])
    }
    return results
  })()`)
  for (const [name, value, detail] of results) check(`Pi refinement: ${name}`, value, detail)

  // The second fixture session invokes a skill, so its goal must read as the
  // default TUI reads it rather than as a raw tag.
  const skill = await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
    // The page is showing a session, so primary returns to the Session Overview.
    surface.closest('.page').dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' } }))
    await new Promise(resolve => setTimeout(resolve, 80))
    const cells = [...surface.querySelectorAll('.pi-overview-cell')]
    const target = cells.find(cell => cell.querySelector('.pi-overview-goal').textContent.includes('[skill]'))
    if (!target) return null
    target.click()
    await new Promise(resolve => setTimeout(resolve, 120))
    return {
      goal: surface.querySelector('.pi-goal-text').innerHTML,
      title: surface.querySelector('#pi-title-text').textContent,
    }
  })()`)
  check('Pi refinement: a skill invocation goal renders as a bracketed skill tag',
    skill === null || (skill.goal.includes('[skill]') && skill.goal.includes('marketing') && !skill.goal.includes('<skill name=')), skill)
  check('Pi refinement: a chosen skill session becomes the page title', skill === null || skill.title.length > 0, skill)

  // A Mac over SSH source keeps no local session log, so the detail must state
  // that this source provides no session events rather than render nothing.
  setSessions({ source: { kind: 'ssh', label: 'Mac / SSH · test-mac' }, summary: localFixture.summary, sessions: localFixture.sessions })
  await enterPage()
  const remote = await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
    if (surface.querySelector('#pi-overview').hidden) {
      surface.closest('.page').dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' } }))
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    const cell = surface.querySelector('.pi-overview-cell')
    if (cell) cell.click()
    await new Promise(resolve => setTimeout(resolve, 150))
    return {
      detail: surface.querySelector('#pi-events-host').textContent,
      identity: surface.querySelector('#pi-detail-body').textContent,
      subtitle: surface.querySelector('#pi-view-subtitle').textContent,
    }
  })()`)
  check('Pi refinement: a Mac over SSH source states that session events are unavailable', /session events are unavailable for Mac \/ SSH/i.test(remote.detail), remote)
  check('Pi refinement: a Mac over SSH source still states the session directory', remote.subtitle.includes('/'), remote)
  check('Pi refinement: the Mac source is not named inside the session detail', !remote.identity.includes('Mac / SSH'), remote)

  setSessions(localFixture)
  await enterPage()

  // A condition is stated once, and a session with nothing to report does not
  // restate its state: the title already carries it.
  setSessions({
    ok: true,
    scannedAt: Date.now(),
    source: { kind: 'local', label: 'Local' },
    summary: { total: 1, running: 0, settled: 1, exited: 0, workspacesCount: 1 },
    workspaces: [],
    sessions: [{ status: 'settled', sessionId: 'quiet-session', cwd: '/workspace/quiet', startedAt: Date.now() - 120000, updatedAt: Date.now(), latestGoal: 'Nothing running here' }],
  })
  await enterPage()
  const quiet = await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
    const cell = surface.querySelector('.pi-overview-cell')
    if (!cell) return null
    cell.click()
    await new Promise((resolve) => setTimeout(resolve, 150))
    return {
      title: surface.querySelector('#pi-title-text').textContent,
      goal: surface.querySelector('.pi-goal-text')?.textContent ?? '',
      activity: surface.querySelector('.pi-activity-text')?.textContent ?? null,
    }
  })()`)
  check('Pi refinement: a session with nothing to report states its state only as the title',
    quiet === null || (quiet.title === 'Idle' && quiet.goal.length > 0 && quiet.activity === null), quiet)

  setSessions({
    ok: false,
    source: { kind: 'local', label: 'Local' },
    error: 'the scanner did not answer',
    scannedAt: null,
    summary: null,
    workspaces: [],
    sessions: [],
  })
  await enterPage()
  const unavailable = await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
    const page = surface.closest('.page')
    if (surface.querySelector('#pi-overview').hidden) {
      page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    return {
      subtitle: surface.querySelector('#pi-view-subtitle').textContent,
      region: surface.querySelector('#pi-overview-list').textContent,
      tabs: surface.querySelectorAll('.pi-filter-btn').length,
    }
  })()`)
  check('Pi refinement: an unavailable source is stated once, in the title row',
    /unavailable/i.test(unavailable.subtitle) && unavailable.region === '' &&
    unavailable.tabs === 5 && unavailable.subtitle.includes('Local'), unavailable)

  setSessions(localFixture)
  await enterPage()

  // Native Pi colours the transcript rather than leaving it monochrome: a prompt
  // is a full-width band on Pi's own user surface, and every tool call is one box
  // on the surface of the outcome Pi recorded for it, with the result Pi wrote
  // for that call joined to it. The colours are Pi's `dark` theme roles, and the
  // outcome is read from the record rather than guessed from the event kind.
  const savedEvents = await win.webContents.executeJavaScript(
    `window.odkPlatform.getPiSessionEvents({ cwd: '/example/workspace', sessionId: 'pi-surface-fixture' })`)
  setEvents({
    ok: true,
    events: [
      { kind: 'user', text: 'Example prompt' },
      { kind: 'thinking', text: 'Example thought' },
      { kind: 'tool', text: 'bash: pnpm test', toolCallId: 'call-ok' },
      { kind: 'result', toolName: 'bash', toolCallId: 'call-ok', text: 'tests passed' },
      { kind: 'tool', text: 'bash: pnpm lint', toolCallId: 'call-bad' },
      { kind: 'result', toolName: 'bash', toolCallId: 'call-bad', isError: true, text: 'exit code 1' },
      { kind: 'tool', text: 'bash: pnpm build', toolCallId: 'call-waiting' },
      { kind: 'result', toolName: 'read', text: 'result Pi recorded on its own' },
      // A source that reports no call identity — today's Desk Link — is read by
      // the order Pi wrote. A thought Pi wrote between a call and its result, and
      // calls Pi ran in parallel, are both ordinary streams: neither may leave a
      // finished call on Pi's pending surface, nor hand one call another's outcome.
      { kind: 'tool', text: 'bash: pnpm typecheck' },
      { kind: 'thinking', text: 'Example interleaved thought' },
      { kind: 'result', toolName: 'bash', text: 'typecheck passed' },
      { kind: 'tool', text: 'bash: pnpm lint --fix' },
      { kind: 'tool', text: 'bash: pnpm format' },
      { kind: 'result', toolName: 'bash', isError: true, text: 'lint failed' },
      { kind: 'result', toolName: 'bash', text: 'format ok' },
      { kind: 'assistant', text: 'Example reply' },
    ],
  })
  let surfaces = null
  try {
    await enterPage()
    surfaces = await win.webContents.executeJavaScript(`(async () => {
      // A probe that throws reports itself: the refinement run must not lose the
      // checks around it.
      try {
      const surface = document.querySelector('${pages.surface('pi-sessions')} .pi-app-wrapper')
      if (surface.querySelector('#pi-overview').hidden === false) surface.querySelector('.pi-overview-cell')?.click()
      await new Promise(resolve => setTimeout(resolve, 200))
      const rows = [...surface.querySelectorAll('#pi-events .pi-event')]
      const has = (node, className) => Boolean(node) && node.classList.contains(className)
      const background = node => (node ? getComputedStyle(node).backgroundColor : 'missing')
      const top = node => (node ? node.getBoundingClientRect().top : NaN)
      const bottom = node => (node ? node.getBoundingClientRect().bottom : NaN)
      const label = (node, selector) => (node?.querySelector(selector)?.textContent ?? null)
      const byKind = kind => rows.find(node => has(node, 'pi-event-' + kind))
      const pairedCall = rows.find(node => node.textContent.includes('pnpm test'))
      const pairedResult = rows.find(node => node.textContent.includes('tests passed'))
      const failedResult = rows.find(node => node.textContent.includes('exit code 1'))
      const pendingTool = rows.find(node => node.textContent.includes('pnpm build'))
      const orphanResult = rows.find(node => node.textContent.includes('on its own'))
      const interleavedCall = rows.find(node => node.textContent.includes('pnpm typecheck'))
      const interleavedResult = rows.find(node => node.textContent.includes('typecheck passed'))
      const parallelFirst = rows.find(node => node.textContent.includes('pnpm lint --fix'))
      const parallelSecond = rows.find(node => node.textContent.includes('pnpm format'))
      const parallelFirstResult = rows.find(node => node.textContent.includes('lint failed'))
      const parallelSecondResult = rows.find(node => node.textContent.includes('format ok'))
      return {
        rows: rows.map(node => [...node.classList].filter(name => name.startsWith('pi-event-') || name.startsWith('pi-tool-') || name === 'pi-continues').join('+')),
        user: background(byKind('user')),
        assistant: background(byKind('assistant')),
        success: background(pairedResult),
        error: background(failedResult),
        pending: background(pendingTool),
        orphan: background(orphanResult),
        joinsPairedCall: has(pairedResult, 'pi-continues') &&
          Math.abs(top(pairedResult) - bottom(pairedCall)) <= 1,
        // The box names the tool once, in the call's own title line.
        callTitle: label(pairedCall, '.pi-event-text')?.trim() ?? null,
        joinedTitle: label(pairedResult, '.pi-result-tool'),
        joinedKind: label(pairedResult, '.pi-event-kind'),
        orphanTitle: label(orphanResult, '.pi-result-tool'),
        orphanMerges: has(orphanResult, 'pi-continues'),
        separatesPendingCall: top(orphanResult) - bottom(pendingTool) > 0,
        errorMerges: has(failedResult, 'pi-continues'),
        interleavedCall: background(interleavedCall),
        parallelFirstCall: background(parallelFirst),
        parallelSecondCall: background(parallelSecond),
        interleavedResult: background(interleavedResult),
        parallelResults: [background(parallelFirstResult), background(parallelSecondResult)],
        // A box keeps its own rows: a result joins only the call Pi wrote it for,
        // and only when that call is the row the reader sees above it.
        joinsAcrossFoldedThought: has(interleavedResult, 'pi-continues'),
        joinsParallelResults: has(parallelFirstResult, 'pi-continues') || has(parallelSecondResult, 'pi-continues'),
        namesOwnTool: [label(parallelFirstResult, '.pi-result-tool'), label(parallelSecondResult, '.pi-result-tool')],
        joinedNamesTool: label(interleavedResult, '.pi-result-tool'),
        foldedThoughtRows: rows.filter(node => node.classList.contains('is-folded')).length,
      }
      } catch (error) { return { __error: String((error && error.stack) || error) } }
    })()`)
  } catch (error) {
    check('Pi refinement: the transcript surface probes ran', false, String((error && error.stack) || error))
  } finally {
    setEvents(savedEvents)
    await enterPage()
  }
  if (surfaces) {
    check('Pi refinement: the transcript surface probes ran', !surfaces.__error, surfaces)
    const piDark = { user: 'rgb(52, 53, 65)', success: 'rgb(40, 50, 40)', error: 'rgb(60, 40, 40)', pending: 'rgb(40, 40, 50)' }
    check('Pi refinement: the prompt carries Pi\'s own user-message surface', surfaces.user === piDark.user, surfaces)
    check('Pi refinement: an assistant reply stays on the base surface', surfaces.assistant === 'rgba(0, 0, 0, 0)', surfaces)
    check('Pi refinement: a completed tool call and its result share Pi\'s success surface as one box',
      surfaces.success === piDark.success && surfaces.joinsPairedCall, surfaces)
    check('Pi refinement: a result Pi recorded as an error carries Pi\'s error surface',
      surfaces.error === piDark.error && surfaces.errorMerges, surfaces)
    check('Pi refinement: a tool call whose result Pi has not reported carries Pi\'s pending surface',
      surfaces.pending === piDark.pending, surfaces)
    check('Pi refinement: a result Pi recorded alone still reads on Pi\'s outcome surface',
      surfaces.orphan === piDark.success && !surfaces.orphanMerges && surfaces.separatesPendingCall, surfaces)
    check('Pi refinement: a tool box names the tool once, in the call\'s own title line',
      surfaces.callTitle === 'bash: pnpm test' && surfaces.joinedTitle === null &&
      surfaces.joinedKind === 'result: ' && surfaces.orphanTitle === 'read', surfaces)
    check('Pi refinement: a call whose result Pi wrote after a thought carries that result\'s outcome',
      surfaces.interleavedCall === piDark.success && surfaces.interleavedResult === piDark.success, surfaces)
    check('Pi refinement: calls Pi ran in parallel each carry the outcome Pi recorded for them',
      surfaces.parallelFirstCall === piDark.error && surfaces.parallelSecondCall === piDark.success &&
      surfaces.parallelResults[0] === piDark.error && surfaces.parallelResults[1] === piDark.success, surfaces)
    check('Pi refinement: a result joins only the call it answers, and only when that call is the row above it',
      surfaces.joinsAcrossFoldedThought === true && surfaces.joinedNamesTool === null &&
      surfaces.joinsParallelResults === false && surfaces.namesOwnTool.every(name => name === 'bash'), surfaces)
    check('Pi refinement: one turn of folded reasoning reads as one quiet row',
      surfaces.foldedThoughtRows === 1, surfaces)
  }
}

module.exports = { run }