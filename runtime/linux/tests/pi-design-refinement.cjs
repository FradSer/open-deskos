const { resolvePages } = require('./helpers/pages')
async function run(win, check) {
  const pages = await resolvePages(win)
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
  await new Promise(resolve => setTimeout(resolve, 350))
  const results = await win.webContents.executeJavaScript(`(async () => {
    const surface = document.querySelector('${pages.surface("pi-sessions")} .pi-app-wrapper')
    const find = selector => surface.querySelector(selector)
    const fixture = await window.odkPlatform.getPiSessions()
    const refresh = async () => {
      find('#pi-refresh-btn').click()
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    const results = []
    const record = (name, value) => results.push([name, Boolean(value)])
    const button = find('#pi-refresh-btn')
    record('header has named Refresh icon without LOCAL badge', button.closest('header') && button.getAttribute('aria-label') === 'Refresh' && button.querySelector('[data-tabler="refresh"]') && !find('header .widget-glance-badge'))
    const size = button.getBoundingClientRect()
    record('Refresh is a compact 44px target', size.width >= 44 && size.width <= 48 && size.height >= 44 && size.height <= 48)
    const searchInput = find('#pi-search-input')
    const searchLabel = find('label[for="pi-search-input"]')
    const searchRow = searchInput.closest('.pi-header-actions')
    const searchRect = searchInput.getBoundingClientRect()
    const refreshRect = button.getBoundingClientRect()
    record('search input sits in the header row left of Refresh', Boolean(searchRow) && searchInput.closest('header') && searchRect.right <= refreshRect.left && searchRect.left >= find('.app-surface-heading').getBoundingClientRect().right && Boolean(searchLabel))
    const toggle = find('#pi-view-toggle')
    record('default view is cross-folder with workspace badges and working metric', (() => {
      const cards = [...surface.querySelectorAll('.pi-session-card')].length
      const headers = surface.querySelectorAll('.pi-workspace-section').length
      const labeled = cards === fixture.sessions.length && headers === 0 && [...surface.querySelectorAll('.pi-card-workspace')].length === cards && toggle.getAttribute('aria-pressed') === 'true'
      const workingLabel = find('.pi-metric-running').textContent.includes('working')
      const workingBtn = find('.pi-filter-btn[data-filter="running"]').textContent === 'Working'
      return labeled && workingLabel && workingBtn
    })())
    const card = find('.pi-session-card')
    const details = card.querySelector('details.pi-process-details')
    record('process details button and disclosure are removed', details === null)
    record('status and elapsed stay in the session header without raw PID', Boolean(card.querySelector('.pi-status-badge')) && Boolean(card.querySelector('.pi-card-time')) && card.querySelector('.pi-card-pid') === null)
    const files = card.querySelector('.pi-files-toggle')
    if (files && files.getAttribute('aria-expanded') !== 'true') files.click()
    if (files) files.focus({ preventScroll: true })
    surface.scrollTop = 100
    const scroll = surface.scrollTop
    await refresh()
    record('identical refresh keeps DOM file disclosure focus and scroll', find('.pi-session-card') === card && (!files || files.getAttribute('aria-expanded') === 'true') && (!files || document.activeElement === files) && surface.scrollTop === scroll)
    const now = Date.now
    const before = card.querySelector('.pi-card-time').textContent
    try {
      Date.now = () => now() + 120000
      await new Promise(resolve => setTimeout(resolve, 5500))
      const updated = find('.pi-session-card')
      record('periodic elapsed update restores inspection context', updated !== card && updated.querySelector('.pi-card-time').textContent !== before && (!files || updated.querySelector('.pi-files-toggle').getAttribute('aria-expanded') === 'true') && (!files || document.activeElement === updated.querySelector('.pi-files-toggle')) && surface.scrollTop === scroll)
    } finally {
      Date.now = now
      await refresh()
    }
    return results
  })()`)
  for (const [name, value] of results) check(`Pi refinement: ${name}`, value)
}

module.exports = { run }
