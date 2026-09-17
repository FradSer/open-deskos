const { resolvePages } = require('./helpers/pages')

// One Session Detail is shown at a time, so reading stability now means: the
// selected session and the reading position inside its event stream survive an
// automatic scan refresh, while the Session Set keeps a stable order.
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
  const a = session('a', '/alpha')
  const b = session('b', '/alpha', 'settled')
  const c = session('c', '/beta', 'settled')
  const d = session('d', '/gamma', 'settled')

  const publish = (items) => {
    setSessions({
      summary: { running: items.filter(item => item.status === 'running').length, total: items.length, workspacesCount: 3 },
      sessions: items,
    })
  }

  await win.webContents.executeJavaScript(`document.querySelector('${surface} .pi-filter-btn[data-filter="all"]').click()`)
  publish([a, b, c, d])
  // Entering the Pi Sessions page refreshes it, so no poll wait is needed.
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await new Promise(resolve => setTimeout(resolve, 350))

  await win.webContents.executeJavaScript(`(() => {
    const detail = document.querySelector('${surface} #pi-detail')
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
      workspace: document.querySelector('${surface} .pi-ws-title')?.textContent || '',
      goal: document.querySelector('${surface} .pi-goal-text')?.textContent || '',
      anchor: anchor?.querySelector('.pi-event-text')?.textContent || '',
      position: document.querySelector('${surface} .pi-detail-position')?.textContent || '',
    }
  })()`)

  const grow = (item) => ({ ...item, latestGoal: 'A preceding goal grew.\n'.repeat(18) })
  publish([d, c, b, a, session('new', '/alpha'), session('extra', '/extra')].map(grow))
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await new Promise(resolve => setTimeout(resolve, 350))

  const result = await win.webContents.executeJavaScript(`(() => {
    const detail = document.querySelector('${surface} #pi-detail')
    const events = [...document.querySelectorAll('${surface} #pi-events .pi-event')]
    const size = selector => {
      const el = document.querySelector(selector)
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0
    }
    return {
      scrollTop: detail.scrollTop,
      workspace: document.querySelector('${surface} .pi-ws-title')?.textContent || '',
      goal: document.querySelector('${surface} .pi-goal-text')?.textContent || '',
      position: document.querySelector('${surface} .pi-detail-position')?.textContent || '',
      order: [...document.querySelectorAll('${surface} .pi-overview-cell')].map(cell => cell.querySelector('.pi-overview-name').textContent).join(','),
      sizes: [size('${surface} .pi-goal-text'), size('${surface} .pi-ws-title'), size('${surface} .pi-card-time'), size('${surface} .pi-status-badge')],
      contained: events.every(event => event.scrollWidth <= event.clientWidth + 1),
      singleDetail: document.querySelectorAll('${surface} #pi-detail .pi-status-badge').length === 1,
    }
  })()`)

  const observed = { before, result: { workspace: result.workspace, goal: result.goal.slice(0, 48), scrollTop: result.scrollTop, position: result.position } }
  check('Pi reading: the selected session survives a scan refresh', result.workspace === before.workspace && result.singleDetail, observed)
  check('Pi reading: the reading position survives a scan refresh', result.scrollTop === before.scrollTop, observed)
  check('Pi reading: the Session Set keeps a stable order and appends newcomers', result.order === '/alpha,/alpha,/extra,/alpha,/beta,/gamma', { order: result.order })
  check('Pi reading: goals remain fresh', result.goal.includes('A preceding goal grew.'), observed)
  check(`Pi reading: CM5 text roles stay readable and contained (${result.sizes.join(', ')}; contained=${result.contained})`,
    result.sizes[0] >= 28 && result.sizes[1] >= 18 && result.sizes[2] >= 18 && result.sizes[3] >= 18 && result.contained)
}

module.exports = { run }