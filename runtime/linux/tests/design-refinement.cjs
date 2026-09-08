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
    const actions = card.querySelector('.quota-actions')
    const metrics = card.querySelector('.quota-metrics')
    return {
      actionsFirst: Boolean(actions.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING),
      statusGroup: card.querySelector('.quota-status-group')?.contains(card.querySelector('#quota-checked')),
      noBadge: !card.querySelector('.widget-glance-badge'),
      quietDial: getComputedStyle(document.querySelector('.ring-arc')).stroke === getComputedStyle(document.querySelector('.ring-track')).stroke,
    }
  })()`)
  check('Usage puts recovery actions before metric details', result.actionsFirst)
  check('Usage groups current state with last-check provenance', result.statusGroup)
  check('Usage omits its redundant provider badge', result.noBadge)
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
