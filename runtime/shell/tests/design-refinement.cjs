async function today(win, check) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.dash')
    const box = surface.getBoundingClientRect()
    const fits = [...surface.querySelectorAll('.dash-wd, .dash-date, .dash-clause')].every(el => {
      const r = el.getBoundingClientRect()
      return r.left >= box.left && r.right <= box.right && el.scrollWidth <= el.clientWidth + 1
    })
    return { fits, noDot: !document.querySelector('.dash-status-dot') }
  })()`)
  check('Today wraps the date and every contributed statement', result.fits)
  check('Today has no decorative active-state dot', result.noDot)
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

async function briefing(win, check) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const services = window.odkServices.briefing
    const narrative = () => document.querySelector('#dash-narrative')
    const clauses = () => [...narrative().querySelectorAll('.dash-clause')].map(clause => ({
      id: clause.dataset.briefing || null,
      text: clause.textContent,
      signalText: [...clause.querySelectorAll('b')].map(signal => signal.textContent),
      signalIcons: [...clause.querySelectorAll('b')].reduce((total, signal) => total + signal.querySelectorAll('svg[data-tabler]').length, 0),
    }))
    const ICON = '<svg data-tabler="folder" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M5 4h4l3 3h7" /></svg>'
    const before = clauses()
    const rejectedEmpty = services.contribute({ id: 'odk.briefing.harness-empty', parts: [{ text: '' }] })
    const afterReject = clauses()
    services.contribute({ id: 'odk.briefing.harness-second', order: 30, parts: [{ text: 'Second ' }, { text: 'signal', emphasis: true, icon: ICON }] })
    services.contribute({ id: 'odk.briefing.harness-first', order: 10, parts: [{ text: 'First ' }, { text: 'signal', emphasis: true, icon: ICON }, { text: '.' }] })
    const ordered = clauses()
    const signal = narrative().querySelector('.dash-clause b')
    const clause = signal && signal.closest('.dash-clause')
    const styles = signal ? {
      signalWeight: Number(getComputedStyle(signal).fontWeight),
      connectiveWeight: Number(getComputedStyle(clause).fontWeight),
      signalColor: getComputedStyle(signal).color,
      connectiveColor: getComputedStyle(clause).color,
      iconSize: signal.querySelector('svg').getBoundingClientRect().width,
      signalSize: parseFloat(getComputedStyle(signal).fontSize),
    } : null
    services.withdraw('odk.briefing.harness-first')
    services.withdraw('odk.briefing.harness-second')
    return { before, afterReject, ordered, restored: clauses(), rejectedEmpty, styles }
  })()`)

  const ids = result.ordered.map((clause) => clause.id)
  const first = ids.indexOf('odk.briefing.harness-first')
  const second = ids.indexOf('odk.briefing.harness-second')
  const added = result.ordered.filter((clause) => ids.indexOf(clause.id) >= 0 && /harness/.test(clause.id))

  check('an invalid briefing contribution is refused', result.rejectedEmpty === false)
  check('a refused contribution adds no statement', JSON.stringify(result.afterReject) === JSON.stringify(result.before))
  check('briefing statements render in ascending order', first >= 0 && second >= 0 && first < second)
  check('every harness statement renders one emphasized signal with an icon',
    added.length === 2 && added.every((clause) => clause.signalIcons === 1 && clause.signalText.length === 1))
  check('withdrawing a contribution removes its statement', JSON.stringify(result.restored) === JSON.stringify(result.before))
  // Pixel runs Zpix at a single Regular weight with font-synthesis disabled, so
  // emphasis must survive on the brighter signal color alone.
  check('signals read louder than connectives without outgrowing the line',
    Boolean(result.styles) &&
    result.styles.signalColor !== result.styles.connectiveColor &&
    result.styles.signalWeight >= result.styles.connectiveWeight &&
    result.styles.iconSize > 0 &&
    result.styles.iconSize < result.styles.signalSize)
}

module.exports = async function run(win, check) {
  await today(win, check)
  await briefing(win, check)
  await usage(win, check)
  await pagerMotion(win, check)
}
