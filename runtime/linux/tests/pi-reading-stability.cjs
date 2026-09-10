const { resolvePages } = require('./helpers/pages')
async function run(win, check, setSessions) {
  const pages = await resolvePages(win)
  win.setContentSize(1920, 1280)
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
  await new Promise(resolve => setTimeout(resolve, 350))
  await win.webContents.executeJavaScript(`document.querySelector('${pages.surface("pi-sessions")} .pi-filter-btn[data-filter="all"]')?.click()`)
  const startedAt = Date.now() - 60000
  const session = (id, cwd, status = 'running') => ({ uuid: id, pid: id, startedAt, cwd, workspaceName: cwd, status, latestGoal: 'Read this goal.', modifiedFiles: ['src/example.js'] })
  const a = session('a', '/alpha')
  const b = session('b', '/alpha', 'settled')
  const c = session('c', '/beta', 'settled')
  const d = session('d', '/gamma', 'settled')
  const refresh = async (items) => {
    setSessions({ summary: { running: items.filter(s => s.status === 'running').length, total: items.length, workspacesCount: 3 }, sessions: items })
    await win.webContents.executeJavaScript(`document.querySelector('${pages.surface("pi-sessions")} #pi-refresh-btn').click()`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  await refresh([a, b, c, d])
  const before = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('${pages.surface("pi-sessions")} .pi-app-wrapper')
    const feed = surface.querySelector('.pi-sessions-feed')
    const cards = surface.querySelectorAll('.pi-session-card')
    const card = cards[2]
    const files = card.querySelector('.pi-files-toggle')
    if (files && files.getAttribute('aria-expanded') !== 'true') files.click()
    if (files) files.focus({ preventScroll: true })
    card.scrollIntoView({ block: 'start' })
    const viewTop = Math.max(feed.getBoundingClientRect().top, surface.getBoundingClientRect().top)
    const anchor = [...feed.querySelectorAll('[data-session-key]')].find(node => {
      const r = node.getBoundingClientRect()
      return r.bottom > viewTop && r.top < surface.getBoundingClientRect().bottom
    })
    return { key: anchor?.dataset.sessionKey || '', top: anchor?.getBoundingClientRect().top || 0, cardTop: card.getBoundingClientRect().top }
  })()`)
  await refresh([d, c, b, { ...a, latestGoal: 'A preceding goal grew.\n'.repeat(18) }, session('new', '/alpha'), session('extra', '/extra')])
  const result = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('${pages.surface("pi-sessions")} .pi-app-wrapper')
    const feed = surface.querySelector('.pi-sessions-feed')
    const cards = [...surface.querySelectorAll('.pi-session-card')]
    const card = cards.find(el => JSON.parse(el.dataset.sessionKey)[0] === 'c')
    const size = selector => {
      const el = surface.querySelector(selector)
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0
    }
    const files = card ? card.querySelector('.pi-files-toggle') : null
    const wsLabel = surface.querySelector('.pi-card-workspace') || surface.querySelector('.pi-ws-title')
    const wsSize = wsLabel ? parseFloat(getComputedStyle(wsLabel).fontSize) : 18
    const viewTop = Math.max(feed.getBoundingClientRect().top, surface.getBoundingClientRect().top)
    const anchor = [...feed.querySelectorAll('[data-session-key]')].find(node => {
      const r = node.getBoundingClientRect()
      return r.bottom > viewTop && r.top < surface.getBoundingClientRect().bottom
    })
    return {
      anchorKey: anchor?.dataset.sessionKey || '',
      anchorTop: anchor?.getBoundingClientRect().top || 0,
      order: cards.map(el => JSON.parse(el.dataset.sessionKey)[0]).join(','),
      offset: card ? card.getBoundingClientRect().top : 0,
      expanded: files ? files.getAttribute('aria-expanded') === 'true' : true,
      focused: files ? document.activeElement === files : true,
      fresh: cards[0].textContent.includes('A preceding goal grew.'),
      sizes: [size('.pi-goal-text'), wsSize, size('.pi-card-time'), size('.pi-status-badge')],
      readable: size('.pi-goal-text') >= 28 && wsSize >= 18 && size('.pi-card-time') >= 18 && size('.pi-status-badge') >= 18,
      contained: cards.every(el => el.scrollWidth <= el.clientWidth + 1),
    }
  })()`)
  const anchorKey0 = JSON.parse(before.key || '["","",""]')[0]
  const anchorKey1 = JSON.parse(result.anchorKey || '["","",""]')[0]
  const anchorDiff = Math.abs(result.anchorTop - before.top)
  check('Pi reading: content anchor survives preceding height changes', anchorDiff <= 2 && anchorKey0 === anchorKey1)
  check('Pi reading: running sessions lead stable order; newcomers append', result.order === 'a,new,extra,b,c,d')
  check('Pi reading: disclosures and focus survive activity refresh', result.expanded && result.focused)
  check('Pi reading: goals remain fresh', result.fresh)
  check(`Pi reading: CM5 text roles are larger and contained (${result.sizes.join(', ')}; contained=${result.contained})`, result.readable && result.contained)
}
module.exports = { run }
