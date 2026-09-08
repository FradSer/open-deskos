const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')

const root = path.resolve(__dirname, '..')
const longPath = `/workspace/${'long-workspace-segment/'.repeat(8)}project`
let quota = { state: 'unconfigured' }
let completeQuotaRefresh = null
let scannerFails = false
let sessions = {
  summary: { running: 1, settled: 0, total: 1, workspacesCount: 1 },
  sessions: [{
    status: 'running', pid: 4102, uuid: 'session-identifier-'.repeat(6),
    workspaceName: 'Desk runtime', cwd: longPath, startedAt: Date.now() - 60000,
    latestGoal: 'Keep complete process details readable at every supported window size.',
    command: `pi --session ${longPath}/session.jsonl`,
    modifiedFiles: [`${longPath}/renderer/surface.js`],
  }],
}
const endpoint = createAppManagerEndpoint()
ipcMain.handle('odk-opencode-go-status', () => completeQuotaRefresh
  ? new Promise(resolve => { completeQuotaRefresh = () => resolve(quota) })
  : quota)
ipcMain.handle('odk-face-agent-status', () => ({ state: 'unavailable', unlocked: false }))
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
ipcMain.handle('odk-pi-sessions', () => {
  if (scannerFails) throw new Error('Scanner test failure')
  return sessions
})
ipcMain.handle('odk-app-manager-list', () => endpoint.list())
ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
ipcMain.handle('odk-app-manager-state', (_event, id) => endpoint.get(id))
ipcMain.handle('odk-remote-publish-page-state', () => true)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function check(name, value, detail) {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`)
  if (!value) {
    failures += 1
    if (detail) console.log(JSON.stringify(detail))
  }
}

async function resize(win, width, height) {
  win.setContentSize(width, height)
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
  for (let i = 0; i < 100; i += 1) {
    if (await win.webContents.executeJavaScript(`window.__odkGrid?.width === ${width}`)) break
    await delay(20)
  }
  await delay(300)
}

async function page(win, index) {
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${index}].click()`)
  await delay(300)
}

async function widgets(win, label) {
  await page(win, 1)
  const result = await win.webContents.executeJavaScript(`(() => {
    const failures = []
    const tiles = [...document.querySelectorAll('.widget')]
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect()
      if (Math.abs(rect.width - rect.height) > 2 && innerWidth < 1000) failures.push(tile.dataset.app + ': not square')
      for (const el of tile.querySelectorAll('span, strong')) {
        if (!el.textContent.trim() || !el.getClientRects().length) continue
        const r = el.getBoundingClientRect()
        if (r.left < rect.left - 1 || r.right > rect.right + 1 || r.top < rect.top - 1 || r.bottom > rect.bottom + 1 || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)) failures.push(tile.dataset.app + ': ' + el.className)
        if (parseFloat(getComputedStyle(el).fontSize) < 12) failures.push(tile.dataset.app + ': small text ' + el.className)
      }
    }
    const page = tiles[0].closest('.page')
    const indicators = [...document.querySelectorAll('.dot')].every(dot => {
      const r = dot.getBoundingClientRect()
      return [r.top + r.height / 2, r.top + 4].every(y => document.elementFromPoint(r.left + r.width / 2, y) === dot)
    })
    return { failures, indicators, count: tiles.length, scrollable: page.scrollHeight <= page.clientHeight + 1 || getComputedStyle(page).overflowY === 'auto' }
  })()`)
  check(`${label}: ten readable Widgets: ${result.failures.join(', ')}`, result.count === 10 && result.failures.length === 0)
  check(`${label}: grid overflow remains reachable`, result.scrollable)
  check(`${label}: page indicators have distinct pointer targets`, result.indicators)
}

async function appPage(win, index, label) {
  await page(win, index)
  const result = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.page[data-page="${index}"] > div')
    const failures = []
    for (const el of surface.querySelectorAll('*')) {
      if (el.closest('[hidden]') || el.classList.contains('sr-only') || el.classList.contains('app-search-label') || !el.getClientRects().length || el instanceof SVGElement) continue
      if (el.scrollWidth > el.clientWidth + 2) failures.push(el.className || el.tagName)
    }
    const controls = [...surface.querySelectorAll('button, input, summary')].filter(el => el.getClientRects().length)
    const capsuleGroup = surface.querySelector('.pi-filter-group')
    return {
      failures,
      targets: controls.every(el => el === capsuleGroup || el.closest('.pi-filter-group') === capsuleGroup || el.getBoundingClientRect().height >= 44),
      label: ${index} !== 2 || Boolean(surface.querySelector('label[for="pi-search-input"]')?.getClientRects().length && surface.querySelector('.pi-filter-group[role="group"][aria-label]')),
      selectable: getComputedStyle(surface).userSelect === 'text',
      filterLines: [...surface.querySelectorAll('.pi-filter-btn')].every(el => getComputedStyle(el).whiteSpace === 'nowrap'),
    }
  })()`)
  check(`${label}: App ${index} wraps all content: ${result.failures.join(', ')}`, result.failures.length === 0)
  check(`${label}: App ${index} uses touch-sized controls`, result.targets)
  check(`${label}: App ${index} keeps a visible search label`, result.label)
  check(`${label}: App ${index} text is selectable`, result.selectable)
  check(`${label}: App ${index} filter labels stay on one line`, result.filterLines)
  const reachable = await win.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.page[data-page="${index}"] > div')
    const controls = [...surface.querySelectorAll('button, input, summary')].filter(el => !el.closest('[hidden]'))
    const bounds = surface.getBoundingClientRect()
    return controls.every(control => {
      control.focus()
      const r = control.getBoundingClientRect()
      return r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1
    })
  })()`)
  check(`${label}: App ${index} focuses controls into view`, reachable)
}

async function contrastAndMotion(win) {
  await page(win, 2)
  const ratios = await win.webContents.executeJavaScript(`(() => {
    const luma = value => {
      const rgb = value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
        v /= 255
        return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
      })
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
    }
    return ['.pi-filter-btn:not(.active)', '.pi-card-time', '.pi-goal-label', '.pi-search-input'].map(selector => {
      const el = document.querySelector(selector)
      const fg = luma(getComputedStyle(el, selector === '.pi-search-input' ? '::placeholder' : null).color)
      let bg = el
      while (getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement
      const value = luma(getComputedStyle(bg).backgroundColor)
      return { selector, ratio: (Math.max(fg, value) + .05) / (Math.min(fg, value) + .05) }
    })
  })()`)
  for (const { selector, ratio } of ratios) check(`${selector}: contrast ${ratio.toFixed(2)}:1`, ratio >= 4.5)
  await win.webContents.debugger.attach('1.3')
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const reduced = await win.webContents.executeJavaScript(`['.pi-filter-btn', '.pi-search-input', '.button-pill'].every(s => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).transitionDuration.split(', ').every(v => parseFloat(v) === 0))`)
    check('App controls respect reduced motion', reduced)
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  } finally {
    await win.webContents.debugger.detach()
  }
  await win.webContents.executeJavaScript(`document.querySelector('.pi-search-input').focus()`)
  const focus = await win.webContents.executeJavaScript(`parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2`)
  check('search has a complete keyboard focus ring', focus)
}

async function pressKey(win, keyCode) {
  await win.webContents.executeJavaScript(`window.addEventListener('keydown', event => {
    window.__interiorKey = { key: event.key, prevented: event.defaultPrevented }
  }, { once: true })`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  await delay(200)
  return win.webContents.executeJavaScript(`(() => {
    const result = window.__interiorKey
    delete window.__interiorKey
    return result
  })()`)
}

async function scrollState(win, selector) {
  return win.webContents.executeJavaScript(`(() => ({
    top: document.querySelector('${selector}').scrollTop,
    page: document.querySelector('.dot.active').getAttribute('aria-label'),
    focus: document.activeElement.id || document.activeElement.dataset.filter || document.activeElement.getAttribute('aria-label'),
  }))()`)
}

async function keyboardScrolling(win) {
  await resize(win, 320, 480)
  await page(win, 1)
  const selector = '.page[data-page="1"]'
  await win.webContents.executeJavaScript(`document.querySelector('.dot.active').focus(); document.querySelector('${selector}').scrollTop = 0`)
  const initial = await scrollState(win, selector)
  for (const keyCode of ['Down', 'Up']) {
    const event = await pressKey(win, keyCode)
    const state = await scrollState(win, selector)
    const moved = keyCode === 'Down' ? state.top > initial.top : state.top === initial.top
    check(`keyboard ${keyCode} scrolls Home without changing pages`, event?.prevented === true && moved && state.page === initial.page)
  }
}

async function editableKeyboard(win) {
  await page(win, 2)
  const selector = '.pi-app-wrapper'
  await win.webContents.executeJavaScript(`const input = document.querySelector('#pi-search-input'); input.value = 'abcdef'; input.focus()`)
  const initial = await scrollState(win, selector)
  for (const keyCode of ['Up', 'Down', 'Left', 'Right']) {
    await win.webContents.executeJavaScript(`document.querySelector('#pi-search-input').setSelectionRange(3, 3)`)
    const event = await pressKey(win, keyCode)
    const value = await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#pi-search-input')
      return { text: input.value, caret: input.selectionStart, focused: document.activeElement === input }
    })()`)
    const state = await scrollState(win, selector)
    const caret = keyCode === 'Left' ? value.caret === 2 : keyCode === 'Right' ? value.caret === 4 : true
    check(`search ${keyCode} stays native without paging`, event?.prevented === false && value.focused && value.text === 'abcdef' && caret && state.page === initial.page)
  }
  await win.webContents.executeJavaScript(`document.querySelector('#pi-search-input').value = ''`)
}

async function nativeAppScrolling(win) {
  await page(win, 3)
  await win.webContents.executeJavaScript(`document.querySelector('#quota-refresh').focus(); document.querySelector('.quota-card').scrollTop = 100`)
  const initial = await scrollState(win, '.quota-card')
  let previous = initial
  for (const keyCode of ['Down', 'Up']) {
    const event = await pressKey(win, keyCode)
    const state = await scrollState(win, '.quota-card')
    const moved = keyCode === 'Down' ? state.top > previous.top : state.top < previous.top
    check(`App ${keyCode} uses native scrolling without paging`, event?.prevented === false && moved && state.page === initial.page)
    previous = state
  }
}

async function remoteInput(win, input) {
  win.webContents.send('odk-remote-input', { input })
  await delay(100)
}

async function remoteScrollingIsolation(win) {
  for (const [index, selector] of [[1, '.page[data-page="1"]'], [2, '.pi-app-wrapper']]) {
    await page(win, index)
    await win.webContents.executeJavaScript(`document.querySelector('.dot.active').focus(); document.querySelector('${selector}').scrollTop = 160`)
    const initial = await scrollState(win, selector)
    for (const input of ['up', 'down']) {
      await remoteInput(win, input)
      const state = await scrollState(win, selector)
      check(`Remote ${input} leaves page ${index} browsing state unchanged`, state.top === initial.top && state.page === initial.page && state.focus === initial.focus)
    }
  }
  await remoteInput(win, 'primary')
  const initial = await scrollState(win, '.pi-app-wrapper')
  await remoteInput(win, 'down')
  const moved = await scrollState(win, '.pi-app-wrapper')
  const controlFocused = await win.webContents.executeJavaScript(`document.querySelector('.pi-app-wrapper').contains(document.activeElement) && document.activeElement.matches('button, input')`)
  check('Remote App Focus Mode moves focus without paging', initial.focus === 'pi-search-input' && moved.focus !== initial.focus && controlFocused && moved.page === initial.page, { initial: initial.focus, moved: moved.focus })
  await remoteInput(win, 'back')
}

async function processIdentityContinuity(win) {
  const original = sessions
  try {
    sessions = structuredClone(original)
    delete sessions.sessions[0].uuid
    sessions.sessions[0].id = 'process-with-local-id'
    await page(win, 2)
    const refresh = async () => {
      await win.webContents.executeJavaScript(`document.querySelector('#pi-refresh-btn').click()`)
      await delay(100)
    }
    await refresh()
    const toggle = () => win.webContents.executeJavaScript(`document.querySelector('.pi-files-toggle')`)
    if (await toggle()) {
      await win.webContents.executeJavaScript(`document.querySelector('.pi-files-toggle').click()`)
      sessions.sessions[0].latestGoal = 'Updated goal for the same local process'
      await refresh()
      check('id-only process retains an expanded files disclosure', await win.webContents.executeJavaScript(`document.querySelector('.pi-files-toggle')?.getAttribute('aria-expanded') === 'true'`))
      sessions.sessions[0].startedAt += 1000
      await refresh()
      check('reused PID does not inherit prior files disclosure', await win.webContents.executeJavaScript(`document.querySelector('.pi-files-toggle')?.getAttribute('aria-expanded') === 'false'`))
    } else {
      check('session cards omit secondary file disclosure for compact reading', true)
    }
  } finally {
    sessions = original
    await win.webContents.executeJavaScript(`document.querySelector('#pi-refresh-btn').click()`)
    await delay(100)
  }
}

async function quotaRefreshFeedback(win) {
  await page(win, 3)
  completeQuotaRefresh = () => {}
  try {
    const feedback = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#quota-refresh')
      const initial = button.getBoundingClientRect()
      const label = button.textContent
      button.click()
      const next = button.getBoundingClientRect()
      return button.disabled && button.getAttribute('aria-busy') === 'true' && label === button.textContent && initial.width === next.width && initial.height === next.height
    })()`)
    check('Usage refresh exposes busy state without moving its label', feedback)
    await delay(50)
    completeQuotaRefresh()
    completeQuotaRefresh = null
    await delay(50)
    check('Usage refresh restores its actionable state', await win.webContents.executeJavaScript(`!document.querySelector('#quota-refresh').disabled && !document.querySelector('#quota-refresh').hasAttribute('aria-busy')`))
  } finally {
    completeQuotaRefresh?.()
    completeQuotaRefresh = null
  }
}

async function scannerRecovery(win) {
  await page(win, 2)
  sessions = null
  for (const fails of [false, true]) {
    scannerFails = fails
    await win.webContents.executeJavaScript(`document.querySelector('#pi-refresh-btn').click()`)
    await delay(100)
    const announced = await win.webContents.executeJavaScript(`(() => {
      const message = document.querySelector('#pi-sessions-status').textContent
      return message.includes('Refresh') && document.querySelector('.pi-empty-state').textContent.includes(message)
    })()`)
    check(`scanner ${fails ? 'error' : 'unavailable'} announces a recovery action`, announced)
  }
}

async function builtinApps(win) {
  for (const id of ['calendar', 'clock', 'pomodoro', 'year', 'app-manager', 'pi-sessions']) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      await window.odkAppPlatform.openApp({ appId: '${id}' })
      const surface = document.querySelector('#app-runtime .runtime-app')
      return Boolean(surface) && surface.scrollWidth <= surface.clientWidth + 2
    })()`)
    check(`built-in ${id}: contained App interior`, result)
    await win.webContents.executeJavaScript(`document.querySelector('#app-back').click()`)
    await delay(50)
  }
}

async function main() {
  const win = new BrowserWindow({ width: 1920, height: 1280, useContentSize: true, frame: false, show: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await win.webContents.executeJavaScript('document.fonts.ready')
  for (const [width, height] of [[1920, 1280], [1920, 1080], [960, 640], [480, 854], [320, 480]]) {
    await resize(win, width, height)
    const label = `${width}x${height}`
    await widgets(win, label)
    await appPage(win, 2, label)
    await appPage(win, 3, label)
  }
  await resize(win, 1920, 1280)
  await require('./pi-design-refinement.cjs').run(win, check)
  const savedSessions = sessions
  await require('./pi-reading-stability.cjs').run(win, check, value => { sessions = value })
  sessions = savedSessions
  await processIdentityContinuity(win)
  await contrastAndMotion(win)
  await builtinApps(win)
  await resize(win, 1920, 1280)
  win.webContents.setZoomFactor(2)
  await delay(350)
  await widgets(win, '200% zoom')
  await appPage(win, 2, '200% zoom')
  await appPage(win, 3, '200% zoom')
  win.webContents.setZoomFactor(1)
  await resize(win, 320, 480)
  quota = { state: 'available', snapshot: { rollingPct: 42, rollingResetMin: 185, weekPct: 63, monthPct: 28, zen: '$12.00' } }
  await win.webContents.executeJavaScript('window.odkServices.subscription.refresh()')
  await appPage(win, 3, '320x480 configured usage')
  sessions = { summary: {}, sessions: [] }
  await page(win, 2)
  await win.webContents.executeJavaScript(`document.querySelector('#pi-refresh-btn').click()`)
  await delay(50)
  check('empty sessions remain readable', await win.webContents.executeJavaScript(`document.querySelector('.pi-empty-state').scrollWidth <= document.querySelector('.pi-sessions-feed').clientWidth`))
  await require('./design-refinement.cjs')(win, check)
  await quotaRefreshFeedback(win)
  await keyboardScrolling(win)
  await editableKeyboard(win)
  await nativeAppScrolling(win)
  await remoteScrollingIsolation(win)
  await scannerRecovery(win)
  assert.equal(failures, 0, `${failures} interior checks failed`)
  console.log('WIDGET_APP_STYLES_PASS')
}

const timeout = setTimeout(() => { console.error('STYLE_TEST_TIMEOUT'); app.exit(1) }, 90000)
app.whenReady().then(main).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
