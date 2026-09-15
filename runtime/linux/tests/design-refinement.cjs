async function today(win, check) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.dash')
    const box = surface.getBoundingClientRect()
    const fits = [...surface.querySelectorAll('.dash-wd, .dash-date, .dash-narrative > span')].every(el => {
      const r = el.getBoundingClientRect()
      return r.left >= box.left && r.right <= box.right && el.scrollWidth <= el.clientWidth + 1
    })
    return { fits, noDot: !document.querySelector('.dash-status-dot'), names: document.querySelectorAll('.vision-status-layout .widget-status-name').length }
  })()`)
  check('Today wraps the date and all three status statements', result.fits)
  check('Today has no decorative active-state dot', result.noDot)
  check('vision Widgets retain visible identities', result.names === 2)
}

async function usage(win, check) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.quota-card')
    const actions = card.querySelector('.quota-header-controls')
    const metrics = card.querySelector('.provider-quota-grid')
    return {
      actionsFirst: Boolean(actions.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING),
      noStatusCard: !card.querySelector('.quota-status-card') && !card.querySelector('#quota-state'),
      checkedInHeader: card.querySelector('.quota-page-head')?.contains(card.querySelector('#quota-checked')),
      compactHeader: card.querySelector('.quota-page-head')?.children.length === 2 && card.querySelector('.quota-header-controls')?.querySelectorAll(':scope > *').length === 2,
      singlePageTitle: card.querySelector('.quota-page-head h1')?.textContent === 'AI usage & quotas' && card.querySelectorAll('.quota-page-head h1, .quota-page-head p').length === 1,
      noStatusLabel: !card.querySelector('.quota-status-label'),
      noNavigationHelp: !card.querySelector('#quota-help'),
      conciseCardTitles: [...card.querySelectorAll('.provider-quota-card-head')].every(head => head.querySelectorAll('.provider-quota-identity > *').length === 1 && head.querySelector('strong')?.textContent.endsWith('.json')),
      plansInBody: [...card.querySelectorAll('.provider-quota-card')].every(providerCard => !providerCard.querySelector('.provider-quota-card-head .provider-plan') && providerCard.querySelector('.provider-quota-card-body .provider-plan')),
      noBadge: !card.querySelector('.widget-glance-badge'),
      hasQuotaGrid: Boolean(metrics),
      quietDial: getComputedStyle(document.querySelector('.ring-arc')).stroke === getComputedStyle(document.querySelector('.ring-track')).stroke,
    }
  })()`)
  check('Usage puts recovery actions before quota details', result.actionsFirst)
  check('Usage omits the separate quota-service status instrument', result.noStatusCard)
  check('Usage keeps last-check provenance in its header', result.checkedInHeader)
  check('Usage keeps refresh controls beside the title in one compact row', result.compactHeader)
  check('Usage page heading names AI usage and quotas in one line', result.singlePageTitle)
  check('Usage status instrument omits its redundant label', result.noStatusLabel)
  check('Usage omits redundant navigation help', result.noNavigationHelp)
  check('Usage quota cards use the authentication filename as one title', result.conciseCardTitles)
  check('Usage quota plans live in the card body', result.plansInBody)
  check('Usage omits its redundant provider badge', result.noBadge)
  check('Usage exposes the provider quota grid', result.hasQuotaGrid)
  check('inactive focus has a quiet neutral dial', result.quietDial)
}

async function pagerMotion(win, check) {
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[0].click(); document.querySelectorAll('.dot')[0].focus()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await new Promise(resolve => setTimeout(resolve, 40))
  const keyboard = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#pages-track')).transitionDuration`)
  check('keyboard paging has no slide delay', keyboard === '0s')
  win.webContents.send('odk-remote-input', { input: 'right' })
  await new Promise(resolve => setTimeout(resolve, 40))
  const remote = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#pages-track')).transitionDuration`)
  check('Remote paging has no slide delay', remote === '0s')
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[3].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`)
  const pointer = await win.webContents.executeJavaScript(`(() => ({
    duration: parseFloat(getComputedStyle(document.querySelector('#pages-track')).transitionDuration),
    dot: getComputedStyle(document.querySelector('.dot'), '::after').transitionProperty,
  }))()`)
  check('pointer paging retains a short spatial transition', pointer.duration > 0 && pointer.duration <= .25)
  check('page indicators never animate layout width', !pointer.dot.includes('width'))
}

module.exports = async function run(win, check) {
  await today(win, check)
  await usage(win, check)
  await pagerMotion(win, check)
}
