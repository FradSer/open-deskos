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

const proposal = {
  id: 'e311a280-c0b9-4411-96cd-4e1e92385349',
  ruleId: 'dry-soil',
  status: 'pending',
  offered: true,
  presented: true,
  advice: '检测到盆栽土壤湿度偏低，建议检查并记录补水。',
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
  win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
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
    const px = sel => { const n = document.querySelector(sel); if (!n) return null; const s = getComputedStyle(n); return { sel, tl: s.borderTopLeftRadius, tr: s.borderTopRightRadius, br: s.borderBottomRightRadius, radius: num(s.borderTopLeftRadius) } }
    const scale = getComputedStyle(document.querySelector('.agent-panel'))
    const token = name => scale.getPropertyValue(name).trim()
    return {
      tokens: {
        surface: token('--agent-radius-surface'), card: token('--agent-radius-card'),
        inset: token('--agent-radius-inset'), control: token('--agent-radius-control'), chip: token('--agent-radius-chip')
      },
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
        composerButton: px('.agent-composer .agent-mic'),
        latest: px('.agent-latest')
      }
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
    // The declared scale must be strictly ordered, outermost to innermost.
    const order = ['bubble', 'card', 'next', 'inset', 'control']
    const radius = name => name in m.parts && m.parts[name] ? m.parts[name].radius : null
    const bubble = radius('bubble'), card = radius('card'), inset = radius('inset'), control = m.parts.confirm.radius, chip = m.parts.chip.radius
    assert.ok(bubble >= card, `${theme}: card ${card} must not exceed bubble ${bubble}`)
    assert.ok(card >= inset, `${theme}: inset ${inset} must not exceed card ${card}`)
    assert.ok(card >= control, `${theme}: control ${control} must not exceed card ${card}`)
    assert.ok(inset >= chip, `${theme}: chip ${chip} must not exceed inset ${inset}`)
    assert.equal(m.parts.composer.radius, bubble, `${theme}: composer and bubble share one surface radius`)
    assert.equal(m.parts.composerButton.radius, control, `${theme}: composer buttons use the control radius`)
    assert.equal(m.parts.latest.radius, control, `${theme}: the latest overlay uses the control radius`)
    assert.equal(m.parts.select.radius, inset, `${theme}: a field inside the inset panel uses the inset radius`)
    // Pixel collapses every level to a hard edge.
    if (theme === 'pixel') for (const [name, part] of Object.entries(m.parts)) {
      if (part) assert.equal(part.radius, 0, `pixel/${name}: expected a hard edge, got ${part.tl}`)
    } else {
      // No level may fall back to a pill or an unrelated fixed value.
      for (const [name, part] of Object.entries(m.parts)) {
        if (part) assert.ok(Number.isFinite(part.radius) && part.radius < 40, `${theme}/${name}: ${part.tl} is not part of the concentric scale`)
      }
    }
    console.log(`AGENT_RADIUS ${theme} ${JSON.stringify({ bubble, card, inset, control, chip })}`)
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'odk-agent-radius.json'), JSON.stringify(record, null, 2))
  console.log('AGENT_RADIUS_PASS: one concentric scale across 4 themes; Pixel collapses to 0')
  clearTimeout(timer)
  win.destroy()
  app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
