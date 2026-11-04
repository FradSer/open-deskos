// Asserts one concentric radius scale across Agent surfaces in the real renderer.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-radius-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 90000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// A session source from the same frame. The host binds it to the recommendation
// footer, so the Reply keeps its real replyTo authorization target.
const remoteMessage = {
  id: '4'.repeat(64),
  at: 1000,
  text: 'Synthetic Pi update.',
  presentation: 'assistant_update',
  sources: [{
    key: 'a'.repeat(64), revision: 'b'.repeat(64), threadId: 'c'.repeat(64),
    machine: 'CM5', sessionId: 'synthetic-session', project: '/synthetic/training',
    taskName: 'Synthetic Mac', control: 'report_only', availability: 'live',
  }],
}

const proposal = {
  id: 'e311a280-c0b9-4411-96cd-4e1e92385349',
  ruleId: 'dry-soil',
  status: 'pending',
  offered: true,
  presented: true,
  advice: '检测到盆栽土壤湿度**偏低**，建议检查并记录补水。',
  preview: {
    summary: '理想中心（公司） → 静安里（家）',
    items: [{ label: '预计耗时', value: '52min', tone: 'warn' }, { label: '车型', value: '约 32 元' }],
    from: [{ handle: 'from-a', name: '理想中心' }],
    to: [{ handle: 'to-a', name: '静安里' }]
  },
  action: { tool: 'memory_update', params: { category: 'watering', value: '已检查盆土' } },
  confirmation: '记住 watering：已检查盆土',
  nextStep: '保存浇水备忘',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'odk.tile.hydra', field: 'soilPercent', value: 12, state: 'live', measuredAt: new Date().toISOString() }]
}

app.whenReady().then(async () => {
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight',
    'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list',
    'odk-personal-agent-status', 'odk-remote-publish-page-state', 'odk-personal-agent-consumer-ready',
    'odk-renderer-development-plugins', 'odk-remote-link-state']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [], state: 'disconnected', sequence: 0 }))
  }
  ipcMain.handle('odk-personal-agent-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-agent-proposal', () => ({ accepted: true }))

  const win = new BrowserWindow({
    show: false, width: 480, height: 960, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true }
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(700)
  await run(`(() => { if (window.odkPersonalAgent) window.odkPersonalAgent.supportsReplyTo = true })()`)
  win.webContents.send('odk-personal-agent-status', {
    state: 'idle', proposals: [proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true },
    remote: { state: 'partial', messages: [remoteMessage], replies: [] },
  })
  await delay(350)
  await run(`document.querySelector('[data-proposal-action="execute"]')?.click()`)
  await delay(150)
  await run(`(() => { const d = document.querySelector('.personal-agent-ride-route'); if (d) d.hidden = false })()`)
  await delay(150)

  const read = () => run(`(() => {
    const num = v => {
      if (v.includes('50%')) return Infinity
      if (v === '0px') return 0
      const m = v.match(/(-?[\\d.]+)px/)
      return m ? parseFloat(m[1]) : NaN
    }
    const px = sel => { const n = document.querySelector(sel); if (!n) return null; const s = getComputedStyle(n); const r = n.getBoundingClientRect(); return { sel, tl: s.borderTopLeftRadius, tr: s.borderTopRightRadius, br: s.borderBottomRightRadius, radius: num(s.borderTopLeftRadius), width: r.width, height: r.height } }
    const scale = getComputedStyle(document.querySelector('.agent-panel'))
    const token = name => scale.getPropertyValue(name).trim()
    return {
      tokens: {
        padSurface: token('--agent-pad-surface'), padCard: token('--agent-pad-card'),
        surface: token('--agent-radius-surface'), card: token('--agent-radius-card'),
        inset: token('--agent-radius-inset'), control: token('--agent-radius-control'), chip: token('--agent-radius-chip')
      },
      markdown: (() => {
        const advice = document.querySelector('.agent-recommendation .personal-agent-proposal-advice')
        const remote = document.querySelector('.agent-update .agent-message-body')
        return {
          adviceStrong: advice ? advice.querySelector('strong')?.textContent ?? null : null,
          adviceScript: advice ? !!advice.querySelector('script') : null,
          adviceText: advice ? advice.textContent : null,
          remoteText: remote ? remote.textContent : null,
        }
      })(),
      padding: (() => {
        const q = s => { const n = document.querySelector(s); if (!n) return null; const c = getComputedStyle(n); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft] }
        const card = q('.personal-agent-preview-card'), chip = q('.personal-agent-preview-chip')
        const proposal = q('.personal-agent-proposal'), panel = getComputedStyle(document.querySelector('.agent-panel'))
        return { card, chip, cardPad: panel.getPropertyValue('--agent-pad-card').trim(),
          gapBlock: panel.getPropertyValue('--agent-gap-block').trim(), gapInline: panel.getPropertyValue('--agent-gap-inline').trim(),
          gapChip: panel.getPropertyValue('--agent-gap-chip').trim(), line: panel.getPropertyValue('--agent-line-body').trim(),
          proposalGap: getComputedStyle(document.querySelector('.personal-agent-proposal')).rowGap,
          adviceLine: getComputedStyle(document.querySelector('.personal-agent-proposal-advice')).lineHeight,
          summaryLine: getComputedStyle(document.querySelector('.personal-agent-preview-summary')).lineHeight,
          chipLine: getComputedStyle(document.querySelector('.personal-agent-preview-chip')).lineHeight }
      })(),
      parts: {
        capsule: px('.agent-identity .agent-capsule'),
        bubble: px('.agent-message-bubble'),
        card: px('.personal-agent-preview-card'),
        chip: px('.personal-agent-preview-chip'),
        inset: px('.personal-agent-preview-fields'),
        select: px('.personal-agent-preview-fields select'),
        next: px('.personal-agent-proposal-next'),
        confirm: px('.personal-agent-proposal-primary'),
        secondary: px('.personal-agent-proposal-secondary'),
        composer: px('.agent-composer'),
        composerButton: px('.agent-composer .agent-send'),
        latest: px('.agent-latest'),
        footerReply: px('.agent-recommendation .agent-session-reply'),
        remoteReply: px('.agent-update .agent-session-reply')
      },
      footer: (() => {
        const sel = s => document.querySelector('.agent-recommendation ' + s)
        const reply = sel('.agent-session-reply')
        const name = sel('.agent-session-name')
        const bubble = sel('.agent-message-bubble')
        const group = sel('.agent-update-sources')
        const open = sel('.agent-recommendation-footer .agent-session-open')
        const svg = sel('.agent-recommendation-footer .agent-session-open svg')
        const cs = n => n ? getComputedStyle(n) : null
        const rect = n => n ? n.getBoundingClientRect() : null
        const B = rect(bubble)
        return {
          replyFont: reply ? parseFloat(cs(reply).fontSize) : null,
          nameFont: name ? parseFloat(cs(name).fontSize) : null,
          bubblePad: bubble ? [cs(bubble).paddingTop, cs(bubble).paddingRight, cs(bubble).paddingBottom, cs(bubble).paddingLeft] : null,
          groupGap: group ? cs(group).rowGap : null,
          // Plain conversation footers and recommendation footers are symmetric.
          // Measure both with one function so every field can be compared.
          bothFooters: (() => {
            const metrics = article => {
              const foot = article?.querySelector('.agent-update-sources')
              if (!foot) return null
              const open = foot.querySelector('.agent-session-open')
              const name = foot.querySelector('.agent-session-name')
              const reply = foot.querySelector('.agent-session-reply')
              const svg = open?.querySelector('svg')
              const c = n => n ? getComputedStyle(n) : null
              const r = n => n ? n.getBoundingClientRect() : null
              const B = article.querySelector('.agent-message-bubble')?.getBoundingClientRect()
              return {
                gap: c(foot).rowGap, marginTop: c(foot).marginTop,
                replyRadius: reply ? parseFloat(c(reply).borderTopLeftRadius) : null,
                replyFont: reply ? parseFloat(c(reply).fontSize) : null,
                nameFont: name ? parseFloat(c(name).fontSize) : null,
                openPaddingLeft: open ? parseFloat(c(open).paddingLeft) : null,
                openTransform: open ? c(open).transform : null,
                touchTarget: open ? parseFloat(c(open).minHeight) : null,
                iconLeft: svg && B ? +(r(svg).left - B.left).toFixed(1) : null,
                centreSpread: (() => {
                  const cy = n => r(n).top + r(n).height / 2
                  const cs = [svg, name, reply].filter(Boolean).map(cy)
                  return +(Math.max(...cs) - Math.min(...cs)).toFixed(1)
                })(),
              }
            }
            return {
              plain: metrics(document.querySelector('.agent-update')),
              openui: metrics(document.querySelector('.agent-recommendation')),
            }
          })(),
          gapBlock: getComputedStyle(document.querySelector('.agent-panel')).getPropertyValue('--agent-gap-block').trim(),
          bodyFont: parseFloat(getComputedStyle(sel('.agent-message-body')).fontSize),
          // Icon and source text stay strictly on one line. The group may take a
          // tiny optical nudge below the Reply centre (a transform, not a layout
          // move), so the Reply and the touch target stay put.
          iconLeft: svg ? +(rect(svg).left - B.left).toFixed(1) : null,
          iconBottom: svg ? +(B.bottom - rect(svg).bottom).toFixed(1) : null,
          textBottom: name ? +(B.bottom - rect(name).bottom).toFixed(1) : null,
          replyBottom: reply ? +(B.bottom - rect(reply).bottom).toFixed(1) : null,
          iconTextSpread: svg && name ? +Math.abs((rect(svg).top + rect(svg).height/2) - (rect(name).top + rect(name).height/2)).toFixed(1) : null,
          sourceNudge: name && reply ? +((rect(name).top + rect(name).height/2) - (rect(reply).top + rect(reply).height/2)).toFixed(1) : null,
          openBoxH: open ? +rect(open).height.toFixed(1) : null,
          touchTarget: open ? parseFloat(cs(open).minHeight) : null,
          padLeft: parseFloat(cs(bubble).paddingLeft),
          padBottom: parseFloat(cs(bubble).paddingBottom),
        }
      })(),
    }
  })()`)

  const record = { theme: null, values: {} }
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready`)
    await delay(320)
    const m = await read()
    record.theme = theme
    record.values[theme] = m
    for (const [name, part] of Object.entries(m.parts)) {
      if (!part) continue
      assert.ok(!Number.isNaN(part.radius), `${theme}/${name}: unparseable radius ${part.tl}`)
      assert.equal(part.tl, part.tr, `${theme}/${name}: horizontal and vertical radii differ`)
      assert.equal(part.tl, part.br, `${theme}/${name}: opposite corners differ`)
    }
    // Concentric means each inner radius equals its container radius minus the padding
    // between them, so the corners stay tangent. A proportional guess would pass an
    // ordering check but fail this one.
    const radius = name => (name in m.parts && m.parts[name]) ? m.parts[name].radius : null
    const bubble = radius('bubble'), card = radius('card'), inset = radius('inset'), control = m.parts.confirm.radius, chip = radius('chip')
    const padSurface = parseFloat(m.tokens.padSurface), padCard = parseFloat(m.tokens.padCard)
    const near = (a, b) => Math.abs(a - b) <= 0.02
    if (theme === 'pixel') {
      assert.equal(bubble, 0, 'pixel: surface collapses')
      assert.equal(card, 0, 'pixel: card collapses')
      assert.equal(inset, 0, 'pixel: inset collapses')
      assert.equal(control, 0, 'pixel: control collapses')
      assert.equal(chip, 0, 'pixel: chip collapses')
    } else {
      assert.ok(near(bubble - card, padSurface), `${theme}: card ${card} must equal surface ${bubble} minus padding ${padSurface}`)
      assert.ok(near(card - inset, padCard), `${theme}: inset ${inset} must equal card ${card} minus padding ${padCard}`)
      assert.equal(chip, inset, `${theme}: a chip inside the card shares the inset radius`)
      assert.equal(control, card, `${theme}: an action button shares the card radius (${card})`)
      assert.ok(bubble > card && card > inset, `${theme}: the surface chain decreases strictly`)
    }
    // Advice renders safe semantic Markdown: strong shows, raw HTML never runs.
    assert.equal(m.markdown.adviceStrong, '偏低', `${theme}: advice strong text renders through the safe Markdown library`)
    assert.equal(m.markdown.adviceScript, false, `${theme}: advice never injects a script element`)
    assert.ok(m.markdown.adviceText?.includes('检测到盆栽土壤湿度偏低'), `${theme}: advice keeps its full readable sentence`)
    // The recommendation footer is host-bound and concentric with the card.
    const footerReply = m.parts.footerReply
    assert.ok(footerReply, `${theme}: a recommendation needs a session Reply footer`)
    assert.ok(m.parts.remoteReply, `${theme}: a remote message keeps its own Reply`)
    const footerR = footerReply.radius
    assert.equal(footerR, card, `${theme}: footer Reply ${footerR} must share the card radius ${card}`)
    assert.equal(footerR, control, `${theme}: footer Reply must share the action button radius ${control}`)
    assert.equal(m.footer.replyFont, m.footer.bodyFont, `${theme}: footer Reply uses the recommendation's one reading size`)
    assert.equal(m.footer.nameFont, m.footer.bodyFont, `${theme}: session source uses the recommendation's one reading size`)
    const [padTop, padRight, padBottom, padLeft] = m.footer.bubblePad.map(parseFloat)
    assert.equal(padTop, padSurface, `${theme}: bubble top padding keeps the surface token`)
    assert.equal(padBottom, padSurface, `${theme}: bubble bottom padding is not reduced below the surface token`)
    assert.equal(padRight, padLeft, `${theme}: bubble horizontal padding stays symmetric`)
    assert.equal(m.footer.groupGap, m.footer.gapBlock, `${theme}: footer spacing comes from the named block gap`)
    // A plain message without a generated card shares the recommendation footer.
    // Every geometry field must agree; the footer does not depend on a card.
    const pf = m.footer.bothFooters.plain, of = m.footer.bothFooters.openui
    assert.ok(pf && of, `${theme}: both a plain and an OpenUI message need a session footer`)
    for (const field of ['gap', 'marginTop', 'replyRadius', 'replyFont', 'nameFont', 'openPaddingLeft', 'openTransform', 'touchTarget', 'iconLeft', 'centreSpread'])
      assert.equal(pf[field], of[field], `${theme}: plain and OpenUI footers must share ${field}: ${pf[field]} vs ${of[field]}`)
    assert.equal(pf.replyRadius, card, `${theme}: the plain Reply shares the card radius ${card}`)
    // Icon and source text stay strictly on one line. The source group sits a
    // small optical 2px below the Reply centre; a 13px layout break is refused.
    // The larger gap below the small text is matched by growing the left inset.
    assert.ok(m.footer.iconTextSpread <= 1,
      `${theme}: icon and text must share a horizontal line (spread ${m.footer.iconTextSpread})`)
    assert.ok(m.footer.sourceNudge >= 1 && m.footer.sourceNudge <= 3,
      `${theme}: source group nudge ${m.footer.sourceNudge} must be a small optical offset (1-3px)`)
    const leftInset = padLeft + padCard
    assert.equal(m.footer.iconLeft, leftInset,
      `${theme}: source left inset ${m.footer.iconLeft} grows by the card padding token to ${leftInset}`)
    assert.ok(Math.abs(m.footer.iconLeft - m.footer.textBottom) <= 3,
      `${theme}: left inset ${m.footer.iconLeft} matches the gap below the text ${m.footer.textBottom}`)
    assert.equal(m.footer.replyBottom, m.footer.padBottom, `${theme}: the Reply control keeps its bottom inset`)
    assert.equal(m.footer.touchTarget, 44, `${theme}: the session source keeps its 44px touch target`)
    if (theme === 'pixel') {
      assert.equal(footerR, 0, 'pixel: footer Reply collapses')
      assert.equal(m.parts.remoteReply.radius, 0, 'pixel: remote Reply collapses')
    }
    const pad = m.padding
    assert.deepEqual(pad.card, [pad.cardPad, pad.cardPad, pad.cardPad, pad.cardPad], `${theme}: card padding matches the concentric token on all four sides`)
    assert.equal(pad.proposalGap, pad.gapBlock, `${theme}: block gap comes from the named scale`)
    assert.equal(pad.adviceLine, pad.summaryLine, `${theme}: advice and card summary share one line height`)
    assert.equal(pad.summaryLine, pad.chipLine, `${theme}: chips share the same line height`)
    assert.ok(parseFloat(pad.chip[0]) >= parseFloat(pad.gapChip), `${theme}: chip text does not crowd its corners`)
    assert.equal(m.parts.composer.radius, bubble, `${theme}: composer and bubble share one surface radius`)
    const controlToken = parseFloat(m.tokens.control) || (theme === 'pixel' ? 0 : m.parts.latest.radius)
    assert.equal(m.parts.latest.radius, controlToken, `${theme}: the latest overlay keeps its own control radius`)
    // A field control inside the inset panel shares the panel radius so the control reads as
    // part of its container. The concentric surface chain stops at the panel.
    assert.equal(m.parts.select.radius, inset, `${theme}: a field control matches its inset panel (inset ${inset}, select ${m.parts.select.tl}, control ${control})`)
    // Pixel collapses every level to a hard edge.
    if (theme === 'pixel') for (const [name, part] of Object.entries(m.parts)) {
      if (part) assert.equal(part.radius, 0, `pixel/${name}: expected a hard edge, got ${part.tl}`)
    } else {
      // No level may fall back to a pill or an unrelated fixed value.
      for (const [name, part] of Object.entries(m.parts)) {
        if (!part || name === 'composerButton') continue
        assert.ok(Number.isFinite(part.radius) && part.radius < 40, `${theme}/${name}: ${part.tl} is not part of the concentric scale`)
      }
      // A square icon control reads as a circle, so it is not part of the surface chain.
      const cbtn = m.parts.composerButton
      assert.equal(cbtn.tl, '50%', `${theme}: the square send control is a circle, got ${cbtn.tl}`)
      assert.ok(Math.abs(cbtn.width - cbtn.height) < 1, `${theme}: the circle needs a square box, got ${cbtn.width}x${cbtn.height}`)
    }
    console.log(`AGENT_RADIUS ${theme} ${JSON.stringify({ bubble, card, inset, control, chip, select: m.parts.select?.tl, send: m.parts.composerButton?.tl })}`)
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'odk-agent-radius.json'), JSON.stringify(record, null, 2))
  console.log('AGENT_RADIUS_PASS: concentric (radius minus padding) across 4 themes; Pixel collapses to 0')
  clearTimeout(timer)
  win.destroy()
  app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
