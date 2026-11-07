// One 17px reading size for every visible text inside a recommendation message bubble.
// iOS-style hierarchy comes from weight and colour, not a second size.
// The pending "Suggested" label is gone; authoritative states and safety text remain.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-type-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 90000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const node = (type, props = {}, children = []) => ({ type, props, children })
const proposal = {
  id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'commute-anomaly', status: 'pending', offered: true, presented: true,
  advice: '通勤比平时多了28分钟。',
  ui: node('Suggestion', {}, [
    node('Badge', { value: '通勤变化', tone: 'warn' }),
    node('Stack', { direction: 'vertical' }, [
      node('Heading', { value: '路上的时间' }),
      node('Metric', { label: '今天', value: '52 分钟', tone: 'warn' }),
      node('Readings', {}, [
        node('Reading', { label: '平时', value: '24 分钟' }),
        node('Reading', { label: '多出', value: '28 分钟', tone: 'warn' }),
        node('Reading', { label: '参考路线', value: '城市中心换乘方案/alternate-commute-route-with-long-segments/review' }),
      ]),
      node('Divider'),
      node('Text', { value: '出门前查看路线变化。' }),
      node('Divider'),
    ]),
    node('OptionSet', {}, [
      node('Option', { label: '查看公共交通', value: 'transit' }),
      node('Option', { label: '查看步行方案', value: 'walk' }),
    ]),
  ]),
  action: { tool: 'memory_update', params: { category: 'note', value: 'opened' } },
  confirmation: '记住 note：opened', nextStep: '打开计划',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: new Date().toISOString() }]
}

const READING = ['.agent-message-body', '.personal-agent-proposal', '.personal-agent-proposal-advice',
  '.personal-agent-preview-card', '.personal-agent-preview-summary', '.personal-agent-preview-chip',
  '.personal-agent-preview-label', '.personal-agent-preview-value',
  '.personal-agent-proposal-next-step', '.personal-agent-proposal-primary', '.personal-agent-proposal-secondary']
// These state nodes no longer exist inside a bubble; the capsule owns them.
const CAPTION = ['.personal-agent-proposal-state', '.personal-agent-proposal-next-label',
  '.personal-agent-proposal-capability', '.personal-agent-preview-notice']

app.whenReady().then(async () => {
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight',
    'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list',
    'odk-personal-agent-status', 'odk-remote-publish-page-state', 'odk-personal-agent-consumer-ready',
    'odk-renderer-development-plugins', 'odk-remote-link-state']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [], state: 'disconnected', sequence: 0 }))
  }
  ipcMain.handle('odk-personal-agent-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-agent-proposal', () => ({ accepted: true }))

  const win = new BrowserWindow({ show: false, width: 480, height: 960, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(800)
  await run(`odkTheme.set('instrument'); document.fonts.ready`)
  win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await delay(400)

  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      win.setContentSize(width, height)
      await delay(120)
      const measured = await run(`(() => {
        const bubble = document.querySelector('.agent-recommendation .agent-message-bubble')
        if (!bubble) return { error: 'no bubble' }
        const card = bubble.querySelector('.openui-suggestion')
        const stack = card.querySelector('.openui-stack')
        const readings = stack.querySelector('.openui-readings')
        const rows = [...readings.querySelectorAll(':scope > .openui-reading')]
        const metric = stack.querySelector('.openui-metric')
        const badge = card.querySelector('.openui-badge')
        const heading = card.querySelector('.openui-heading')
        const list = card.querySelector('ul.openui-option-set')
        const options = list ? [...list.querySelectorAll(':scope > li.openui-option')] : []
        const cs = node => getComputedStyle(node)
        const size = sel => { const n = bubble.querySelector(sel); return n ? parseFloat(cs(n).fontSize) : null }
        const weight = node => parseFloat(cs(node).fontWeight)
        const rect = node => node.getBoundingClientRect()
        const visible = node => cs(node).display !== 'none' && cs(node).visibility === 'visible'
          && rect(node).width > 0 && rect(node).height > 0
        const sides = ['Top', 'Right', 'Bottom', 'Left']
        const borders = node => sides.map(side => parseFloat(cs(node)['border' + side + 'Width']))
        const clear = node => cs(node).backgroundColor === 'rgba(0, 0, 0, 0)' && cs(node).boxShadow === 'none'
        const children = node => [...node.children].filter(visible)
        const gaps = node => children(node).slice(1).map((child, i) => rect(child).top - rect(children(node)[i]).bottom)
        return {
          reading: ${JSON.stringify(READING)}.map(sel => [sel, size(sel)]),
          caption: ${JSON.stringify(CAPTION)}.map(sel => [sel, size(sel)]),
          textNodes: (() => { const w = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) { const t = w.currentNode.textContent.trim(); if (t) out.push({ text: t, size: parseFloat(cs(w.currentNode.parentElement).fontSize) }) } return out })(),
          adviceWeight: weight(bubble.querySelector('.personal-agent-proposal-advice')),
          headingWeight: weight(heading),
          labelWeight: weight(rows[0].querySelector('.personal-agent-preview-label')),
          metricWeight: weight(metric.querySelector('.personal-agent-preview-value')),
          readingWeight: weight(rows[0].querySelector('.personal-agent-preview-value')),
          overflow: [bubble, card, stack, readings, badge, metric, ...rows, ...options].some(n => n.scrollWidth > n.clientWidth + 1),
          controls: [...bubble.querySelectorAll('button')].every(n => rect(n).height >= 44),
          card: { clear: clear(card), border: borders(card),
            padding: sides.map(side => parseFloat(cs(card)['padding' + side])) },
          headingBorder: borders(heading),
          badge: { contentWidth: rect(badge).width, availableWidth: rect(heading).width,
            dot: getComputedStyle(badge, '::before').content !== 'none' && parseFloat(getComputedStyle(badge, '::before').width) > 0,
            clear: clear(badge), border: borders(badge) },
          layout: [stack, readings, metric, ...(list ? [list] : [])].map(node => ({ name: node.className, clear: clear(node), border: borders(node) })),
          options: options.filter(visible).map(option => option.textContent),
          interactiveOptions: Boolean(card.querySelector('select, input, button, [contenteditable]')) ||
            Boolean(list && [list, ...list.querySelectorAll('*')].some(node => node.tabIndex >= 0)),
          rows: [metric, ...rows].map(row => {
            const label = row.querySelector('.personal-agent-preview-label')
            const value = row.querySelector('.personal-agent-preview-value')
            return { clear: clear(row), border: borders(row), right: rect(value).right,
              gap: rect(value).left - rect(label).right, wrapped: rect(value).height > parseFloat(cs(value).lineHeight) + 1,
              clipped: value.scrollWidth > value.clientWidth + 1, align: cs(value).textAlign }
          }),
          groups: [card, stack].map(node => ({ gap: parseFloat(cs(node).rowGap), gaps: gaps(node) })),
          token: parseFloat(getComputedStyle(bubble).getPropertyValue('--agent-text-body')) || parseFloat(getComputedStyle(document.querySelector('.agent-panel')).getPropertyValue('--agent-text-body')),
          divider: (() => {
            const kids = [...stack.children]
            const dividers = kids.filter(n => n.classList.contains('openui-divider'))
            return {
              count: dividers.length,
              margins: dividers.map(n => [parseFloat(cs(n).marginTop), parseFloat(cs(n).marginBottom)]),
              trailingHidden: dividers.length ? cs(dividers.at(-1)).display === 'none' : null,
              trailingIsLast: dividers.length ? dividers.at(-1) === kids.at(-1) : null,
            }
          })(),
        }
      })()`)
      assert.ok(!measured.error, `${theme}/${width}: ${measured.error}`)
      const reading = measured.reading.filter(([, value]) => value !== null)
      const captions = measured.caption.filter(([, value]) => value !== null)
      const sizes = [...new Set([...reading, ...captions, ...measured.textNodes.map(n => [null, n.size])].map(([, value]) => value))]
      assert.equal(sizes.length, 1, `${theme}/${width}: every visible text must be one size, got ${JSON.stringify({ reading: measured.reading, caption: measured.caption, textNodes: measured.textNodes })}`)
      assert.equal(sizes[0], 17, `${theme}/${width}: the reading size must be 17px like iOS body text`)
      assert.equal(sizes[0], measured.token, `${theme}/${width}: reading size must equal the body token ${measured.token}`)
      assert.ok(!measured.textNodes.some(n => /suggest(ed|ion)/i.test(n.text)), `${theme}/${width}: internal suggestion wording must not appear: ${JSON.stringify(measured.textNodes.map(n => n.text))}`)
      assert.ok(!measured.textNodes.some(n => /Dismissed|Expired|In progress|Completed|Outcome not confirmed|Read-only|No executable action|do not resend|do not repeat|Sandbox|Estimate expired|Result recorded|Next step/i.test(n.text)),
        `${theme}/${width}: state text must live in the capsule, not the bubble`)
      assert.deepEqual(measured.options, ['查看公共交通', '查看步行方案'], `${theme}/${width}: the native list shows both options`)
      assert.equal(measured.interactiveOptions, false, `${theme}/${width}: the option list adds no controls or tab stops`)
      const card = measured.card
      assert.ok(card.clear && [...card.border, ...card.padding].every(value => value === 0),
        `${theme}/${width}: generated content needs no extra surface or inset`)
      assert.ok(measured.headingBorder.every(border => border === 0), `${theme}/${width}: the heading needs no rule`)
      for (const part of measured.layout) {
        assert.ok(part.clear && part.border.every(border => border === 0), `${theme}/${width}: ${part.name} adds another surface`)
      }
      const badge = measured.badge
      assert.ok(badge.clear && badge.border.every(border => border === 0), `${theme}/${width}: the badge adds another surface`)
      assert.ok(badge.dot && badge.contentWidth < badge.availableWidth, `${theme}/${width}: the badge must fit its status label and dot`)
      assert.equal(measured.overflow, false, `${theme}/${width}: a card primitive overflows`)
      assert.equal(measured.controls, true, `${theme}/${width}: a control lost its touch target`)
      const [, ...rows] = measured.rows
      for (const [index, row] of measured.rows.entries()) {
        const [top, ...edges] = row.border
        assert.ok(row.clear && edges.every(border => border === 0) && (index >= 2 || top === 0), `${theme}/${width}: reading ${index} adds another surface`)
        assert.ok(row.gap >= 7 && !row.clipped, `${theme}/${width}: reading ${index} crowds or clips the value`)
      }
      assert.ok(rows.every(row => Math.abs(row.right - rows[0].right) <= 1 && ['right', 'end'].includes(row.align)),
        `${theme}/${width}: values need a shared right edge`)
      if (width === 320) assert.ok(rows.at(-1).wrapped, `${theme}/${width}: a long value must wrap in the compact comparison`)
      if (theme !== 'pixel') {
        assert.ok(measured.adviceWeight > measured.labelWeight, `${theme}/${width}: advice needs weight priority`)
        assert.ok(measured.headingWeight > measured.labelWeight, `${theme}/${width}: the heading needs weight priority`)
        assert.ok(measured.metricWeight > measured.readingWeight, `${theme}/${width}: the metric needs weight priority`)
      }
      else assert.equal(measured.adviceWeight, 400, 'pixel keeps one weight and does not synthesize emphasis')
      for (const group of measured.groups) {
        assert.ok(group.gaps.every(gap => Math.abs(gap - group.gap) <= 1),
          `${theme}/${width}: primitive gaps must equal the named group gap ${group.gap}, got ${JSON.stringify(group.gaps)}`)
      }
      // Divider spacing comes only from the card's named gap. No doubled margins,
      // and a trailing divider draws no orphan line.
      const d = measured.divider
      assert.ok(d.count >= 2, `${theme}/${width}: the composed card needs dividers to test spacing` )
      assert.ok(d.margins.every(([top, bottom]) => top === 0 && bottom === 0),
        `${theme}/${width}: a divider added margin that doubles the gap: ${JSON.stringify(d.margins)}`)
      assert.equal(d.trailingIsLast, true, `${theme}/${width}: the test tree ends with a divider`)
      assert.equal(d.trailingHidden, true, `${theme}/${width}: a trailing divider must not draw an orphan line`)
    }
  }
  const nextStep = '出门前比较公交与步行路线。'
  const readOnlyProposal = { ...proposal, action: null, confirmation: '', nextStep,
    ui: node('Suggestion', {}, [...proposal.ui.children, node('OwnerStep', { text: nextStep })]) }
  win.setContentSize(320, 480)
  win.webContents.send('odk-personal-agent-status', {
    state: 'idle', proposals: [readOnlyProposal],
    proposalCapabilities: { read: true, respond: false, acknowledge: false },
  })
  await delay(200)
  const readOnly = await run(`(() => {
    const advice = document.querySelector('.personal-agent-proposal-advice')
    const step = document.querySelector('.personal-agent-proposal-next-step')
    if (!advice || !step) return { error: 'no read-only advice or next step' }
    const style = getComputedStyle(step.parentElement)
    return {
      text: step.textContent,
      background: style.backgroundColor,
      shadow: style.boxShadow,
      borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => style['border' + side + 'Width']),
      inset: step.getBoundingClientRect().left - advice.getBoundingClientRect().left,
    }
  })()`)
  assert.ok(!readOnly.error, readOnly.error)
  assert.equal(readOnly.text, nextStep)
  assert.equal(readOnly.background, 'rgba(0, 0, 0, 0)', 'a generated next step adds no second surface')
  assert.equal(readOnly.shadow, 'none')
  assert.deepEqual(readOnly.borders, ['0px', '0px', '0px', '0px'], 'a generated next step has no frame')
  assert.ok(Math.abs(readOnly.inset) <= 1, 'a generated next step aligns with advice')
  console.log('PASS: one reading size across 4 themes x 3 sizes')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
