const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-tabs-'))
app.setPath('userData', profile)
// A running, an idle, and an exited session make every Session Filter tab real,
// so the tabs and the rows they select can be measured instead of asserted
// against an empty page.
const sampleSessions = [
  { status: 'running', pid: 4102, uuid: 'session-tabs-running', workspaceName: 'Sample workspace', cwd: '/workspace/sample', startedAt: Date.now() - 60000, latestGoal: 'Keep the running row readable at every width.', activity: 'bash: pnpm test' },
  { status: 'settled', pid: 4103, uuid: 'session-tabs-idle', workspaceName: 'Sample workspace', cwd: '/workspace/sample', startedAt: Date.now() - 120000, latestGoal: 'Keep the idle row readable at every width.', activity: 'thinking: reviewing' },
  { status: 'exited', pid: 4104, uuid: 'session-tabs-exited', workspaceName: 'Legacy workspace', cwd: '/workspace/legacy', startedAt: Date.now() - 3600000, latestGoal: 'History waits behind the Exited tab.', activity: 'bash: done' },
]
for (const [channel, value] of Object.entries({
  'odk-opencode-go-status': { state: 'unconfigured' },
  'odk-pi-sessions': { source: { kind: 'local', label: 'Local' }, summary: { running: 1, total: 3, workspacesCount: 2 }, sessions: sampleSessions },
  'odk-pi-session-events': { ok: true, events: [{ kind: 'assistant', text: 'A bounded example reply.' }] },
  'odk-remote-publish-page-state': true,
  'odk-hydra-status': { configured: false, connected: false, env: null, nodes: [] },
  'odk-weread-highlight': { status: 'unconfigured', highlight: null },
  'odk-user-apps-list': { ok: true, apps: [] },
  'odk-camera-frame': { state: 'unavailable' },
  'odk-app-manager-list': { apps: [] },
})) ipcMain.handle(channel, () => value)

app.whenReady().then(async () => {
  // Headless Ozone on the CM5 segfaults on a framed hidden window, so this
  // harness opens the same frameless, offscreen, throttling-free window the
  // other measurement harnesses use.
  const win = new BrowserWindow({ show: false, frame: false, width: 1920, height: 900, useContentSize: true, offscreen: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  try {
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('DOM.enable')
    await win.webContents.debugger.sendCommand('CSS.enable')
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument')
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.pi-filter-btn[data-filter="live"]' })
    if (nodeId) await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] })
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      for (const width of [1920, 1000, 480, 380, 320]) {
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
        const result = await win.webContents.executeJavaScript(`(async () => {
          odkTheme.set(${JSON.stringify(theme)})
          const index = DESKTOP_LAYOUT.pages.findIndex(page => page.id === 'pi-sessions')
          document.querySelectorAll('.dot')[index].click()
          window.dispatchEvent(new Event('resize'))
          await document.fonts.ready
          const page = document.querySelector('.page[data-page="' + index + '"]')
          const surface = page.querySelector('.pi-app-wrapper')
          // Wait for real geometry instead of guessing how long this device
          // needs: the pager must have settled and the rows must have measured
          // before anything is compared against the viewport.
          // The Shell publishes its computed grid, so the wait is for real
          // layout rather than for an elapsed time: a page that has not been
          // laid out yet reports collapsed boxes that are not the product.
          const settled = () => {
            const cell = surface.querySelector('.pi-overview-cell')
            const overview = surface.querySelector('#pi-overview')
            return window.__odkGrid?.width === ${width} &&
              innerWidth === ${width} &&
              Math.abs(page.getBoundingClientRect().left) <= 1 &&
              Boolean(overview) && overview.getBoundingClientRect().width >= innerWidth * 0.5 &&
              Boolean(cell) && cell.getBoundingClientRect().width >= 200
          }
          for (let attempt = 0; attempt < 120 && !settled(); attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 50))
          }
          if (surface.querySelector('#pi-overview').hidden) {
            page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
            await new Promise(resolve => setTimeout(resolve, 120))
          }
          const group = surface.querySelector('#pi-overview-filters')
          const tabs = [...group.querySelectorAll('.pi-filter-btn')]
          const active = surface.querySelector('.pi-filter-btn.active')
          const list = surface.querySelector('#pi-overview-list')
          const cells = [...surface.querySelectorAll('.pi-overview-cell')]
          const selected = surface.querySelector('.pi-overview-cell.is-selected')
          const detail = surface.querySelector('#pi-detail')
          const style = el => getComputedStyle(el)
          const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
          const contained = el => {
            const rect = el.getBoundingClientRect()
            return rect.left >= -1 && rect.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1
          }
          const checks = []
          const check = (name, value) => checks.push([name, Boolean(value)])

          // The Session Overview owns the Session Filter, and the filter spends
          // the title row's trailing edge: it acts on the list below it, so it
          // stays on the row that names the view rather than in the list itself.
          check('no page control outside the filter tabs and the rows',
            surface.querySelectorAll('button').length === tabs.length + cells.length)
          const header = surface.querySelector('.pi-app-header')
          const heading = surface.querySelector('.pi-app-header .app-surface-heading')
          const headerRect = header.getBoundingClientRect()
          const groupRect = group.getBoundingClientRect()
          const headingRect = heading.getBoundingClientRect()
          const sharesTitleLine = groupRect.top < headingRect.bottom - 0.5 && headingRect.top < groupRect.bottom - 0.5
          check('filter tabs share the page title row', header.contains(group) && header.contains(tabs[0]))
          // The track's own shape follows its content: a stadium while one row of
          // tabs fits, a chip grid as soon as the tabs wrap. The pixel theme
          // squares every corner, so it has no curve to follow and is exempt.
          const oneRow = new Set(tabs.map(tab => Math.round(tab.getBoundingClientRect().top))).size === 1
          const trackRadius = parseFloat(style(group).borderTopLeftRadius)
          const tabRadius = parseFloat(style(tabs[0]).borderTopLeftRadius)
          const squared = trackRadius === 0
          check('filter tabs nest inside the track corner by the track inset', squared
            ? tabRadius === 0
            : trackRadius - tabRadius >= 3,
            { trackRadius, tabRadius, squared })
          check('the filter track is a stadium for one row and a chip grid when it wraps',
            squared || (oneRow ? trackRadius >= groupRect.height / 2 - 1 : trackRadius < groupRect.height / 2 - 1),
            { oneRow, trackRadius, trackHeight: groupRect.height, squared })
          check('filter tabs hold the title row trailing edge', contained(group) &&
            (sharesTitleLine
              ? Math.abs(groupRect.right - headerRect.right) <= 1
              : Math.abs(groupRect.left - headerRect.left) <= 1))
          check('filter tabs never overlap the page title', !overlaps(groupRect, headingRect))
          check('the title keeps the row start and is never clipped by the tabs',
            Math.abs(headingRect.left - headerRect.left) <= 1 && heading.scrollWidth <= heading.clientWidth + 1)
          check('filter inset track', parseFloat(style(group).paddingTop) >= 4)
          check('five status tabs in display order', tabs.map(tab => tab.dataset.filter).join(',') === 'live,working,idle,exited,all')
          check('tabs count the scan', tabs.map(tab => tab.querySelector('.pi-filter-count').textContent).join(',') === '2,1,1,1,3')
          check('one selected tab band', surface.querySelectorAll('.pi-filter-btn.active').length === 1 &&
            active.getAttribute('aria-pressed') === 'true' &&
            style(active).borderTopStyle === 'solid' && style(active).borderTopColor !== 'rgba(0, 0, 0, 0)' &&
            style(active).backgroundColor !== 'rgba(0, 0, 0, 0)')
          check('tabs never overlap', tabs.every((tab, at) =>
            tabs.slice(at + 1).every(other => !overlaps(tab.getBoundingClientRect(), other.getBoundingClientRect()))))
          for (const tab of tabs) {
            const rect = tab.getBoundingClientRect()
            check('tab touch target', rect.width >= 44 && rect.height >= 44)
            check('tab contained label', contained(tab))
          if (!contained(tab)) checks.push(['tab geometry ' + JSON.stringify({ innerWidth, group: group.getBoundingClientRect().toJSON(), groupDisplay: style(group).display, groupAlign: style(group).alignItems, groupJustify: style(group).justifyContent, overview: surface.querySelector('#pi-overview').getBoundingClientRect().toJSON(), list: list.getBoundingClientRect().toJSON(), tab: tab.getBoundingClientRect().toJSON(), scrollWidth: tab.scrollWidth, clientWidth: tab.clientWidth, label: tab.textContent }), false])
            check('tab quiet surface', style(tab).boxShadow === 'none' && style(tab).transform === 'none')
            check('tab readable type', parseFloat(style(tab).fontSize) >= 12 && style(tab).whiteSpace === 'nowrap')
          }
          if (document.querySelector('.pi-filter-btn[data-filter="live"]')) {
            check('tab focus-visible styling', style(surface.querySelector('.pi-filter-btn[data-filter="live"]')).outlineStyle === 'solid' &&
              parseFloat(style(surface.querySelector('.pi-filter-btn[data-filter="live"]')).outlineWidth) >= 2)
          }

          // The live set is the landing rows.
          check('the live list is the landing view', surface.querySelector('#pi-overview').hidden === false && detail.inert === true)
          check('only live sessions are listed', cells.length === 2 && !list.textContent.includes('History waits behind the Exited tab.'))
          check('rows sit in a single column', style(list).flexDirection === 'column')
          check('each row states its Pi state', cells.every(cell => /^(Working\\.\\.\\.|Idle)$/.test(cell.querySelector('.pi-overview-state .pi-state-text').textContent.trim())))
          check('each row states its directory', cells.every(cell => cell.querySelector('.pi-overview-path').textContent.length > 0))
          check('exactly one selected row band', surface.querySelectorAll('.pi-overview-cell.is-selected').length === 1 &&
            Boolean(selected) && selected.getAttribute('aria-pressed') === 'true' &&
            style(selected).backgroundColor !== 'rgba(0, 0, 0, 0)')
          check('rows never overlap', cells.every((cell, at) =>
            cells.slice(at + 1).every(other => !overlaps(cell.getBoundingClientRect(), other.getBoundingClientRect()))))
          for (const cell of cells) {
            const rect = cell.getBoundingClientRect()
            check('row touch target', rect.width >= 44 && rect.height >= 44)
            check('row contained label', contained(cell))
          if (!contained(cell)) checks.push(['row geometry ' + JSON.stringify({ innerWidth, page: page.getBoundingClientRect().toJSON(), cell: cell.getBoundingClientRect().toJSON(), list: list.getBoundingClientRect().toJSON() }), false])
            check('row quiet surface', style(cell).boxShadow === 'none' && style(cell).transform === 'none')
            check('row readable type', parseFloat(style(cell).fontSize) >= 12)
          }
          check('row goals and paths stay inside their container', cells.every(cell =>
            ['.pi-overview-goal', '.pi-overview-path', '.pi-overview-activity'].every(selector => {
              const node = cell.querySelector(selector)
              return node.scrollWidth <= node.clientWidth + 1
            })))

          // A tab narrows the rows without leaving the overview.
          surface.querySelector('.pi-filter-btn[data-filter="exited"]').click()
          await new Promise(resolve => setTimeout(resolve, 80))
          check('the Exited tab admits history', surface.querySelectorAll('.pi-overview-cell').length === 1 &&
            surface.querySelector('.pi-overview-cell .pi-overview-state .pi-state-text').textContent.trim() === 'Exited')
          surface.querySelector('.pi-filter-btn[data-filter="live"]').click()
          await new Promise(resolve => setTimeout(resolve, 80))
          check('returning to Live restores the started rows', surface.querySelectorAll('.pi-overview-cell').length === 2 &&
            surface.querySelector('.pi-filter-btn[data-filter="live"]').getAttribute('aria-pressed') === 'true')

          // Choosing the row makes that session the Session Detail, whose
          // elapsed facts stay on one line without squeezing.
          surface.querySelectorAll('.pi-overview-cell')[0].click()
          await new Promise(resolve => setTimeout(resolve, 120))
          const facts = surface.querySelector('#pi-view-facts')
          check('detail facts readable', /elapsed/.test(facts.textContent) && parseFloat(style(facts).fontSize) >= 12 && style(facts).whiteSpace === 'nowrap')
          check('detail title states Pi state', /^(Working\\.\\.\\.|Idle)$/.test(surface.querySelector('#pi-title-text').textContent))
          check('detail title carries the directory', surface.querySelector('#pi-view-subtitle').textContent.includes('/'))
          check('the Session Detail carries no filter tabs or controls', detail.querySelector('.pi-filter-btn') === null &&
            detail.querySelector('button, input, select') === null)
          check('the detail gives the title row trailing edge to elapsed time',
            group.hidden === true &&
            Math.abs(facts.getBoundingClientRect().right - header.getBoundingClientRect().right) <= 1)
          check('the hidden filter keeps its five tabs for the list', group.querySelectorAll('.pi-filter-btn').length === 5)
          return checks
        })()`)
        // Failed checks are reported by name with their measured detail: a
        // nested array diff prints as "[Array]" and cannot be acted on.
        assert.deepEqual(result.filter(([, ok]) => !ok)
          .map(([name, , detail]) => `${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`), [], `${theme} ${width}`)
        console.log(`PASS session tabs ${theme} ${width}`)
      }
    }
  } finally {
    win.destroy()
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }))