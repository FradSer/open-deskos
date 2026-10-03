const { resolvePages } = require('./helpers/pages')

// One session is shown at a time, so reading stability means: the selection
// survives refresh, an idle session preserves a manual reading anchor, and a
// working session always follows its newest event. The live list carries the
// change: a scan keeps its defined order and admits newcomers.
async function run(win, check, setSessions) {
  const pages = await resolvePages(win)
  const surface = `${pages.surface('pi-sessions')} .pi-app-wrapper`
  win.setContentSize(1920, 1280)
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
  await new Promise(resolve => setTimeout(resolve, 350))

  const startedAt = Date.now() - 60000
  const session = (id, cwd, status = 'running') => ({
    uuid: id, pid: id, startedAt, cwd, workspaceName: cwd, status,
    latestGoal: 'Read this goal.', modifiedFiles: ['src/example.js'],
  })
  const a = session('a', '/alpha', 'settled')
  const b = session('b', '/alpha', 'settled')
  const c = session('c', '/beta', 'settled')
  const d = session('d', '/gamma', 'settled')

  const publish = (items) => {
    setSessions({
      summary: { running: items.filter(item => item.status === 'running').length, total: items.length, workspacesCount: 3 },
      sessions: items,
    })
  }

  publish([a, b, c, d])
  // Entering the Pi Sessions page refreshes it, so no poll wait is needed.
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await new Promise(resolve => setTimeout(resolve, 350))
  await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${surface}')
    if (surface.querySelector('#pi-overview').hidden) {
      surface.closest('.page').dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' } }))
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    // A previous step may have left another status tab active.
    const live = surface.querySelector('.pi-filter-btn[data-filter="live"]')
    if (live && !live.classList.contains('active')) live.click()
    surface.querySelector('.pi-overview-cell').click()
    // Wait for a real stream, otherwise the scroll assertions measure nothing.
    const detail = surface.querySelector('#pi-detail')
    for (let attempt = 0; attempt < 40 && detail.querySelectorAll('.pi-event').length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    detail.scrollTop = 120
  })()`)
  const before = await win.webContents.executeJavaScript(`(() => {
    const detail = document.querySelector('${surface} #pi-detail')
    const events = [...document.querySelectorAll('${surface} #pi-events .pi-event')]
    const bounds = detail.getBoundingClientRect()
    const anchor = events.find(event => {
      const rect = event.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    return {
      scrollTop: detail.scrollTop,
      // The reading position is where the anchored line sits in the viewport,
      // not the pixel offset: content above the stream can grow between scans.
      anchorOffset: anchor ? Math.round((anchor.getBoundingClientRect().top - bounds.top) * 10) / 10 : null,
      path: document.querySelector('${surface} #pi-view-subtitle')?.textContent || '',
      goal: document.querySelector('${surface} .pi-goal-text')?.textContent || '',
      anchor: anchor?.querySelector('.pi-event-text')?.textContent || '',
    }
  })()`)

  const grow = (item) => ({ ...item, latestGoal: 'A preceding goal grew.\n'.repeat(18) })
  // The existing members keep their relative order; the newcomers join their
  // workspace group instead of resetting the list.
  publish([a, b, c, d, session('new', '/alpha'), session('extra', '/extra')].map(grow))
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await new Promise(resolve => setTimeout(resolve, 350))

  const result = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('${surface}')
    const detail = surface.querySelector('#pi-detail')
    const bounds = detail.getBoundingClientRect()
    const events = [...surface.querySelectorAll('#pi-events .pi-event')]
    const size = selector => {
      const el = surface.querySelector(selector)
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0
    }
    const anchor = events.find(event => {
      const rect = event.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    return {
      scrollTop: detail.scrollTop,
      anchorOffset: anchor ? Math.round((anchor.getBoundingClientRect().top - bounds.top) * 10) / 10 : null,
      anchor: anchor?.querySelector('.pi-event-text')?.textContent || '',
      path: surface.querySelector('#pi-view-subtitle')?.textContent || '',
      goal: surface.querySelector('.pi-goal-text')?.textContent || '',
      order: [...surface.querySelectorAll('.pi-overview-path')].map(node => node.textContent).join(','),
      sizes: [size('.pi-goal-text'), size('#pi-view-subtitle'), size('#pi-view-facts'), size('#pi-title')],
      contained: events.every(event => event.scrollWidth <= event.clientWidth + 1),
      rows: surface.querySelectorAll('.pi-overview-cell').length,
      live: surface.querySelectorAll('.pi-overview-cell').length,
    }
  })()`)

  const observed = { before, result: { path: result.path, goal: result.goal.slice(0, 48), scrollTop: result.scrollTop, anchorOffset: result.anchorOffset } }
  check('Pi reading: the selected session survives a scan refresh', result.path === before.path, observed)
  check('Pi reading: the reading position survives a scan refresh',
    result.anchor !== '' && result.anchor === before.anchor && Math.abs(result.anchorOffset - before.anchorOffset) <= 2,
    { ...observed, beforeAnchorOffset: before.anchorOffset, afterAnchorOffset: result.anchorOffset })
  check('Pi reading: the live list keeps a stable order and appends newcomers',
    result.order === '/alpha,/extra,/alpha,/alpha,/beta,/gamma', { order: result.order })
  check('Pi reading: goals remain fresh', result.goal.includes('A preceding goal grew.'), observed)
  check(`Pi reading: CM5 text roles stay readable and contained (${result.sizes.join(', ')}; contained=${result.contained})`,
    result.sizes[0] >= 28 && result.sizes[1] >= 18 && result.sizes[2] >= 18 && result.sizes[3] >= 24 && result.contained)
}

module.exports = { run }