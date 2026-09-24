'use strict'

// A session's goal and its latest content line are Pi's own text, and Pi renders
// them as Markdown. The overview row reads that text the way the Home tile and
// the Session Detail already read the same fields: the emphasis and the inline
// code are formatting, never the syntax Pi wrote to produce it.
//
// Run: pnpm exec electron tests/pi-overview-markdown.cjs [--capture-dir=<absolute path>]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { resolvePages } = require('./helpers/pages')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-overview-markdown-'))
app.setPath('userData', profile)
const captureDir = process.argv.find((arg) => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)

// Three settled sessions keep the run local, cheap and offline: one reports
// Markdown in both fields, one reports none, and one reports the shape a long
// CJK answer really arrives in — one line Pi wrote, wrapping as the row's own
// supporting text.
const OPENING = 'Read both paths. '
const EMPHASIS = 'The direction is sound'
const TAIL = ', but '
const INLINE = 'pi-sessions.js'
const GOAL_EMPHASIS = 'only'
const GOAL_INLINE = 'runtime/linux'
const MARKDOWN_GOAL = `Review **${GOAL_EMPHASIS}** the \`${GOAL_INLINE}\` renderer path`
const MARKDOWN_ACTIVITY = `${OPENING}**${EMPHASIS}**${TAIL}\`${INLINE}\` is still unreachable.`
const PLAIN_GOAL = 'Review the importer'
const PLAIN_ACTIVITY = 'bash: pnpm test'
const CJK_EMPHASIS = '设计方向（模型从执行器改成作者）是合理的，但现在的实现状态是不自洽的 —— 树里的模型路径端到端 0% 可用，而在跑的现场路径正要被树里的固件切断。'
const CJK_ACTIVITY = `读了设备端和 NAS 端两条路径的当前代码。结论先说：**${CJK_EMPHASIS}**`
const CJK_GOAL = '现在使用模型去分析是否浇水的路径是什么样子，是否合理？'

const sessions = [
  { status: 'settled', pid: 4102, uuid: 'overview-markdown', workspaceName: 'Sample workspace', cwd: '/workspace/sample', startedAt: Date.now() - 60000, latestGoal: MARKDOWN_GOAL, activity: MARKDOWN_ACTIVITY },
  { status: 'settled', pid: 4103, uuid: 'overview-plain', workspaceName: 'Sample workspace', cwd: '/workspace/sample', startedAt: Date.now() - 120000, latestGoal: PLAIN_GOAL, activity: PLAIN_ACTIVITY },
  { status: 'settled', pid: 4104, uuid: 'overview-reported', workspaceName: 'Second workspace', cwd: '/workspace/hydra', startedAt: Date.now() - 180000, latestGoal: `Refresh **${CJK_GOAL}**`, activity: CJK_ACTIVITY },
]

for (const [channel, value] of Object.entries({
  'odk-pi-sessions': { source: { kind: 'local', label: 'Local' }, summary: { running: 0, total: sessions.length, workspacesCount: 2 }, sessions },
  'odk-pi-session-events': { ok: true, events: [{ kind: 'assistant', text: MARKDOWN_ACTIVITY }] },
  'odk-remote-publish-page-state': true,
  'odk-opencode-go-status': { state: 'unconfigured' },
  'odk-hydra-status': { configured: false, connected: false, env: null, nodes: [] },
  'odk-weread-highlight': { status: 'unconfigured', highlight: null },
  'odk-user-apps-list': { ok: true, apps: [] },
  'odk-camera-frame': { state: 'unavailable' },
  'odk-app-manager-list': { apps: [] },
})) ipcMain.handle(channel, () => value)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  // The desk's own window size and its current theme, so a capture reads the way
  // the reported surface reads.
  const win = new BrowserWindow({ show: false, frame: false, width: 1920, height: 1280, useContentSize: true, offscreen: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  const results = []
  // A renderer exception is a failure of the surface, not of a probe. The
  // harness reports it with the failed step instead of losing it in the console.
  const rendererErrors = []
  win.webContents.on('console-message', (event, level, message) => {
    const details = event && typeof event === 'object' && 'message' in event ? event : { level, message }
    if (details.level === 'error' || details.level === 3) rendererErrors.push(String(details.message || ''))
  })
  try {
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
    const pages = await resolvePages(win)
    const surface = pages.surface('pi-sessions')
    await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${pages.dot('pi-sessions')}].click()`)
    const js = (body) => win.webContents.executeJavaScript(
      `(() => { const surface = document.querySelector(${JSON.stringify(surface)}); const $ = (s) => surface.querySelector(s); ${body} })()`)
    const until = async (body) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (await js(body)) return
        await wait(50)
      }
      throw new Error(`Condition not reached: ${body}`)
    }
    // Wait for real rows rather than for an elapsed time, and open the list the
    // way the Shell opens it when the page is not the landing view.
    await until("return Boolean($('.pi-overview-cell'))")
    if (await js("return $('#pi-overview').hidden")) {
      await js("surface.closest('.page').dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))")
      await wait(150)
    }
    await until("return !$('#pi-overview').hidden && surface.querySelectorAll('.pi-overview-cell').length === 3")

    const read = `(node) => ({
      text: node.textContent,
      strong: [...node.querySelectorAll('strong')].map((child) => child.textContent),
      code: [...node.querySelectorAll('code')].map((child) => child.textContent),
      em: [...node.querySelectorAll('em')].map((child) => child.textContent),
      contained: node.scrollWidth <= node.clientWidth + 1 && node.clientHeight > 0,
      lines: Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)),
      fontSize: parseFloat(getComputedStyle(node).fontSize),
    })`

    const rows = await js(`return (() => {
      const read = ${read}
      const cells = [...surface.querySelectorAll('.pi-overview-cell')]
      const row = (uuid) => cells.find((cell) => cell.dataset.sessionKey.includes(uuid))
      const markdown = row('overview-markdown')
      const plain = row('overview-plain')
      const reported = row('overview-reported')
      return {
        count: cells.length,
        rowIsButton: markdown.tagName === 'BUTTON',
        markdownGoal: read(markdown.querySelector('.pi-overview-goal')),
        markdownActivity: read(markdown.querySelector('.pi-overview-activity')),
        plainGoal: read(plain.querySelector('.pi-overview-goal')),
        plainActivity: read(plain.querySelector('.pi-overview-activity')),
        reportedGoal: read(reported.querySelector('.pi-overview-goal')),
        reportedActivity: read(reported.querySelector('.pi-overview-activity')),
      }
    })()`)

    const check = (name, value, observed) => results.push({ name, ok: Boolean(value), observed: value ? undefined : observed })
    check('the overview lists every example row', rows.count === 3, rows.count)
    check('a row stays one session button', rows.rowIsButton, rows.rowIsButton)
    // The row reads Pi's emphasis and inline code as formatting: the words stay,
    // the syntax Pi wrote to produce them is not shown.
    check('the goal renders its emphasis and inline code', rows.markdownGoal.strong.join('|') === GOAL_EMPHASIS &&
      rows.markdownGoal.code.join('|') === GOAL_INLINE && !rows.markdownGoal.text.includes('**') && !rows.markdownGoal.text.includes('`') &&
      rows.markdownGoal.text === `Review ${GOAL_EMPHASIS} the ${GOAL_INLINE} renderer path`, rows.markdownGoal)
    check('the latest content renders its emphasis and inline code', rows.markdownActivity.strong.join('|') === EMPHASIS &&
      rows.markdownActivity.code.join('|') === INLINE && !rows.markdownActivity.text.includes('**') && !rows.markdownActivity.text.includes('`') &&
      rows.markdownActivity.text === `${OPENING}${EMPHASIS}${TAIL}${INLINE} is still unreachable.`, rows.markdownActivity)
    // Markdown is a reading rule, not a rewrite: a line Pi reported without any
    // is rendered exactly as reported.
    check('a reported line without Markdown is unchanged', rows.plainGoal.text === PLAIN_GOAL && rows.plainActivity.text === PLAIN_ACTIVITY &&
      rows.plainGoal.strong.length === 0 && rows.plainGoal.code.length === 0 &&
      rows.plainActivity.strong.length === 0 && rows.plainActivity.code.length === 0, { goal: rows.plainGoal, activity: rows.plainActivity })
    // The reported shape: one long CJK answer whose whole sentence is emphasised
    // reads as one emphasised paragraph that wraps, not as asterisks around it.
    check('a long emphasised answer renders as one emphasised run', rows.reportedActivity.strong.join('|') === CJK_EMPHASIS &&
      rows.reportedActivity.text === `读了设备端和 NAS 端两条路径的当前代码。结论先说：${CJK_EMPHASIS}` &&
      !rows.reportedActivity.text.includes('**') && rows.reportedActivity.lines > 1, rows.reportedActivity)
    check('the reported goal keeps its emphasised run', rows.reportedGoal.strong.join('|') === CJK_GOAL &&
      rows.reportedGoal.text === `Refresh ${CJK_GOAL}`, rows.reportedGoal)
    // The row stays a compact summary with its own typography contract: the goal
    // is body type and the latest content stays smaller supporting text.
    check('the row keeps goal and activity distinguished by size', rows.markdownGoal.fontSize > rows.markdownActivity.fontSize,
      { goal: rows.markdownGoal.fontSize, activity: rows.markdownActivity.fontSize })
    check('formatted text stays inside its row', [rows.markdownGoal, rows.markdownActivity, rows.plainGoal, rows.plainActivity, rows.reportedGoal, rows.reportedActivity]
      .every((node) => node.contained), { report: rows.reportedActivity })

    // The Session Detail already reads these fields this way; the row now states
    // the same line with the same reading rather than a second one.
    await js("[...surface.querySelectorAll('.pi-overview-cell')].find((cell) => cell.dataset.sessionKey.includes('overview-markdown')).click()")
    await until("return Boolean($('.pi-activity-text'))")
    const detail = await js(`return (() => {
      const read = ${read}
      return { activity: read($('.pi-activity-text')), goal: read($('.pi-goal-text')) }
    })()`)
    check('the detail reads the same latest content the same way', detail.activity.strong.join('|') === EMPHASIS &&
      detail.activity.code.join('|') === INLINE && detail.activity.text === `${OPENING}${EMPHASIS}${TAIL}${INLINE} is still unreachable.` &&
      detail.goal.strong.join('|') === GOAL_EMPHASIS && detail.goal.code.join('|') === GOAL_INLINE,
      detail)

    if (captureDir) {
      assert.equal(path.isAbsolute(captureDir), true)
      fs.mkdirSync(captureDir, { recursive: true })
      const index = pages.dot('pi-sessions')
      await win.webContents.executeJavaScript(`(async () => {
        odkTheme.set('pixel')
        document.querySelectorAll('.dot')[${index}].click()
        const page = document.querySelector(${JSON.stringify(surface)})
        page.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'back' }, bubbles: true }))
        await document.fonts.ready
        await new Promise((resolve) => setTimeout(resolve, 400))
      })()`)
      await until("return !$('#pi-overview').hidden")
      fs.writeFileSync(path.join(captureDir, 'pi-overview-markdown.png'), (await win.webContents.capturePage()).toPNG())
      // The same list with the pointer resting on a row that is not the current
      // session: the pointer is not a session state, so the rows still read as
      // one style with a single current-session band.
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('DOM.enable')
      await win.webContents.debugger.sendCommand('CSS.enable')
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument')
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.pi-overview-cell:not(.is-selected)' })
      if (nodeId) await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })
      await wait(200)
      const hovered = await win.webContents.executeJavaScript(`(() => {
        const node = document.querySelector(${JSON.stringify(`${surface} .pi-overview-cell:not(.is-selected)`)})
        return node ? { hover: node.matches(':hover'), fill: getComputedStyle(node).backgroundColor } : null
      })()`)
      check('the row under the pointer keeps the quiet fill', hovered?.hover === true && hovered?.fill === 'rgba(0, 0, 0, 0)', hovered)
      fs.writeFileSync(path.join(captureDir, 'pi-overview-markdown-hover.png'), (await win.webContents.capturePage()).toPNG())
      console.log(`CAPTURE ${path.join(captureDir, 'pi-overview-markdown.png')} ${path.join(captureDir, 'pi-overview-markdown-hover.png')}`)
    }
  } catch (error) {
    results.push({ name: 'the harness reached the rendered overview', ok: false, observed: { error: error.message, rendererErrors } })
  }

  // A renderer exception is a failure of the surface, not of a probe: every check
  // above is read from a page that reported none.
  results.push({ name: 'the page reported no renderer error', ok: rendererErrors.length === 0, observed: rendererErrors })

  for (const result of results) {
    if (result.ok) console.log(`PASS ${result.name}`)
    else console.error(`FAIL ${result.name}: ${JSON.stringify(result.observed)}`)
  }
  assert.ok(results.every((result) => result.ok), 'the overview row reads reported Markdown as formatting')
  console.log(`PI_OVERVIEW_MARKDOWN_RESULT=${JSON.stringify({ ok: true, fixtures: 'example-only', hidden: !win.isVisible(), results })}`)
  app.exit(0)
}).catch((error) => {
  console.error(`PI_OVERVIEW_MARKDOWN_FAILURE=${error.message}`)
  app.exit(1)
})
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }))