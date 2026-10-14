'use strict'

const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-home-preview-profile-'))
app.setPath('userData', profile)
let win
const timeout = setTimeout(() => finish(1, Error('Populated Home preview timed out')), 60000)
function finish(code, error) {
  clearTimeout(timeout)
  if (error) console.error(error)
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch (cleanupError) {
    // Windows can retain the Chromium profile lock until this process exits.
    // Cleanup must not replace the assertion's outcome or reject this handler.
    console.error('Preview profile cleanup deferred:', cleanupError.code)
  }
  app.exit(code)
}

function capturePaintedFrame() {
  return new Promise((resolve, reject) => {
    const contents = win.webContents
    const [width, height] = win.getContentSize()
    const cleanup = () => { clearTimeout(timer); contents.removeListener('paint', painted) }
    const painted = (_event, _dirty, frame) => {
      const size = frame.getSize()
      if (frame.isEmpty() || size.width !== width || size.height !== height) return
      cleanup()
      resolve(frame.toPNG())
    }
    const timer = setTimeout(() => { cleanup(); reject(Error('Preview did not paint its full viewport')) }, 5000)
    contents.on('paint', painted)
    // A hidden offscreen window can have valid DOM bounds before Viz has a
    // capturable surface. Require the native full repaint, not elapsed time.
    contents.invalidate()
  })
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  const preview = installHomePreviewFixtures(ipcMain)
  const js = source => win.webContents.executeJavaScript(source)
  const captures = []
  for (const theme of ['instrument', 'pixel', 'border-beam']) for (const [width, height] of [[1920, 1280], [1280, 776]]) {
    // Start each native surface at its target size. On Linux a resized offscreen
    // surface can emit a correctly sized crop of its previous compositor frame.
    const previous = win
    win = new BrowserWindow({ show: false, frame: false, width, height, useContentSize: true,
      webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true,
        contextIsolation: true, backgroundThrottling: false, offscreen: true } })
    previous?.destroy()
    // Windows constrains the initial window to its work area, even offscreen.
    // Apply the requested content size after creation, before loading the page.
    win.setContentSize(width, height)
    assert.equal(win.webContents.isOffscreen(), true)
    assert.equal(win.webContents.isPainting(), true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
    await js('window.odkShellReady')
    await js(`(async () => {
      const deadline = performance.now() + 5000;
      while (document.querySelector('.pi-widget-count').textContent !== '3' || !document.querySelector('.agent-message-assistant')) {
        if (performance.now() > deadline) throw Error('Populated readings did not arrive');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await Promise.all([document.fonts.load('700 48px Montserrat'), document.fonts.load('400 16px "Noto Sans SC"'), document.fonts.load('400 16px Zpix')]);
      await document.fonts.ready;
    })()`)
    // These surfaces have no product data channel yet. Scope their simulated
    // display to this fixture, expose it explicitly, and restore it after capture.
    const controls = await js(`(() => {
      const timer = document.querySelector('[data-widget="odk.tile.pomodoro"]');
      const net = document.querySelector('#sb-net');
      const nodes = [timer.querySelector('.ring-mmss'), timer.querySelector('.pomodoro-state')];
      window.previewRestore = { nodes, texts: nodes.map(node => node.textContent), netLabel: net.getAttribute('aria-label'), netTitle: net.getAttribute('title') };
      nodes[0].textContent = ${JSON.stringify(preview.pomodoro.remaining)};
      nodes[1].textContent = ${JSON.stringify(preview.pomodoro.state)};
      timer.dataset.previewSimulated = 'true'; net.dataset.previewConnected = 'true';
      net.setAttribute('aria-label', 'Wi-Fi connected (simulated)'); net.setAttribute('title', 'Wi-Fi connected (simulated)');
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('#sb-net[data-preview-connected]::after { content: none; } [data-preview-simulated] .ring-arc { stroke: var(--odk-primary); stroke-dashoffset: ${314 * preview.pomodoro.progress}; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      window.previewSheet = sheet;
      return { timer: nodes[0].textContent, simulated: timer.dataset.previewSimulated, wifi: getComputedStyle(net, '::after').content };
    })()`)
    assert.equal(controls.timer, '18:42')
    assert.equal(controls.simulated, 'true')
    assert.equal(controls.wifi, 'none')
    await js(`(async () => { odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 100)); })()`)
    const state = await js(`(() => {
      const home = document.querySelector('[data-page-id="home"]');
      const tiles = [...home.querySelectorAll('.widget')];
      const square = tiles.every(tile => { const r = tile.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1; });
      const time = document.querySelector('.ring-mmss').getBoundingClientRect();
      const dial = document.querySelector('.ring-track').getBoundingClientRect();
      const bubble = document.querySelector('.agent-message-assistant .agent-message-bubble');
      const summary = document.querySelector('#home-summary');
      return { square, columns: window.__odkGrid.cols, rows: window.__odkGrid.rows, cell: window.__odkGrid.cellDim,
        pi: document.querySelector('.pi-widget-count').textContent,
        weather: document.querySelector('[data-widget="odk.tile.weather"]').textContent,
        holdings: document.querySelector('[data-widget="odk.tile.futu"]').textContent,
        narrative: document.querySelector('#dash-narrative').textContent,
        placeholder: /unavailable|not started|--:--/.test(home.textContent.toLowerCase()),
        paragraphs: document.querySelectorAll('.agent-message').length,
        repeatedNames: document.querySelectorAll('.agent-message-name, .agent-caption').length,
        messageMetadata: document.querySelectorAll('.agent-message time, .agent-message-avatar').length,
        identityEntryHidden: getComputedStyle(document.querySelector('.agent-identity')).display === 'none' && document.querySelector('.agent-identity summary').getClientRects().length === 0,
        agentBubble: !!bubble && getComputedStyle(bubble).backgroundColor !== 'rgba(0, 0, 0, 0)',
        timerFits: time.width <= dial.width * 0.84 && Math.abs((time.left + time.right) / 2 - (dial.left + dial.right) / 2) < 1,
        timerBounds: { text: time.width, dial: dial.width, centerDelta: Math.abs((time.left + time.right) / 2 - (dial.left + dial.right) / 2), font: getComputedStyle(document.querySelector('.ring-mmss')).fontSize },
        noFooter: !home.querySelector('.dash-foot, details, summary'),
        summaryFit: { height: summary.clientHeight, content: summary.scrollHeight, font: getComputedStyle(summary.querySelector('.dash-narrative')).fontSize },
        temperature: document.querySelector('.w-temp')?.textContent,
        viewport: [innerWidth, innerHeight, devicePixelRatio, document.fonts.status] };
    })()`)
    assert.equal(state.square, true)
    assert.equal(state.columns, 3)
    assert.equal(state.rows, 2)
    assert.equal(state.pi, '3')
    assert.match(state.weather, /Taipei/)
    assert.match(state.weather, /26/)
    assert.match(state.holdings, /62\.15/)
    assert.equal(state.narrative, preview.briefing.items[0].text)
    assert.equal(state.placeholder, false)
    assert.equal(state.paragraphs, 2)
    assert.equal(state.repeatedNames, 0, 'Agent name is not repeated inside the conversation')
    assert.equal(state.messageMetadata, 0, 'conversation messages have no avatars or timestamps')
    assert.equal(state.identityEntryHidden, true, 'the pencil entry is absent from layout and keyboard navigation')
    assert.equal(state.agentBubble, true, 'Agent messages have a background container')
    assert.equal(state.timerFits, true, theme + ' complete timer reading has space inside the dial: ' + JSON.stringify(state.timerBounds))
    assert.equal(state.noFooter, true)
    assert.ok(state.summaryFit.content <= state.summaryFit.height, 'normal summary fits without an inner scrollbar: ' + JSON.stringify(state.summaryFit))
    assert.deepEqual(state.viewport, [width, height, 1, 'loaded'])
    const file = path.join(os.tmpdir(), `odk-populated-home-${theme}-${width}.png`)
    // Acknowledge one native frame before requesting the capture frame. The
    // first paint can still contain pixels from before the fixture update.
    await capturePaintedFrame()
    fs.writeFileSync(file, await capturePaintedFrame())
    captures.push({ theme, width, height, cell: state.cell, file })
  }
  const longCopy = 'You have 3 active sessions across 3 workspaces, while 2 plants report 63% moisture. Taipei is 26°C and overcast; your focus session is in progress, and portfolio readings are available from the latest synchronized snapshot.'
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    win.setContentSize(1280, 776)
    await js("window.dispatchEvent(new Event('resize')); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))")
    const originalStyle = await js("document.querySelector('#home-summary').getAttribute('style')")
    let probeRevision = 0
    const probe = async (width, height, text, state = 'live') => {
      const frame = { ...preview.briefing, state, generatedAt: preview.briefing.generatedAt + ++probeRevision, items: [{ ...preview.briefing.items[0], text, segments: [{ text, icon: 'sessions' }] }] }
      await js("odkTheme.set('" + theme + "'); Object.assign(document.querySelector('#home-summary').style, { width: '" + width + "px', height: '" + height + "px', maxWidth: 'none' })")
      win.webContents.send('odk-personal-bot-status', { state: 'idle', briefing: frame })
      return js('(async () => {' +
        'const host = document.querySelector("#home-summary"), paragraph = host.querySelector("#dash-narrative");' +
        'const deadline = performance.now() + 3000;' +
        'while (!paragraph.textContent.endsWith(' + JSON.stringify(text) + ')) { if (performance.now() > deadline) throw Error("Briefing probe not delivered"); await new Promise(resolve => setTimeout(resolve, 10)); }' +
        'await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));' +
        'const header = host.querySelector(".dash-head").getBoundingClientRect(), rect = host.getBoundingClientRect();' +
        'const fits = host.scrollHeight <= host.clientHeight + 1 && host.scrollWidth <= host.clientWidth + 1;' +
        'let reachable = true; if (!fits) { host.scrollTop = host.scrollHeight; reachable = host.scrollTop > 0 && paragraph.getBoundingClientRect().bottom <= host.getBoundingClientRect().bottom + 1; }' +
        'return { width: host.clientWidth, height: host.clientHeight, font: parseFloat(getComputedStyle(paragraph).fontSize),' +
        'weekday: parseFloat(getComputedStyle(host.querySelector(".dash-wd")).fontSize), date: parseFloat(getComputedStyle(host.querySelector(".dash-date")).fontSize),' +
        'headerHeight: header.height, icon: paragraph.querySelector("svg").getBoundingClientRect().width,' +
        'fits, reachable,' +
        'grid: [window.__odkGrid.cols, window.__odkGrid.cellDim] }; })()')
    }
    const typography = []
    try {
      for (const [width, height] of [[400, 300], [760, 300], [760, 180]]) typography.push(await probe(width, height, longCopy))
      const short = await probe(760, 240, '3 active sessions.')
      const long = await probe(760, 240, longCopy)
      assert.ok(short.font > long.font, theme + ' only copy size adapts to content length: ' + JSON.stringify({ short, long }))
      assert.ok(short.icon > long.icon, theme + ' inline icons follow the fitted copy')
      for (const key of ['width', 'height', 'weekday', 'date', 'headerHeight']) assert.equal(short[key], long[key], theme + ' preserves ' + key)
      assert.deepEqual(short.grid, long.grid, theme + ' preserves Widget geometry')
      assert.ok(typography[1].font > typography[0].font, theme + ' copy uses available width: ' + JSON.stringify(typography))
      assert.ok(typography[2].font < typography[1].font, theme + ' copy uses available height')
      assert.ok([...typography, short, long].every(row => row.fits && row.font >= 16 && row.font <= 48 && Math.abs(row.icon - row.font * 0.78) < 1), theme + ' copy and inline icons fit together: ' + JSON.stringify(typography))
      const cjk = await probe(620, 196, '完整桌面数据与会话状态'.repeat(24).slice(0, 240))
      assert.ok(cjk.fits && cjk.font >= 14, theme + ' maximum-length CJK briefing fits the non-scrolling handheld card: ' + JSON.stringify(cjk))
      const staleCjk = await probe(620, 196, '完整桌面数据与会话状态'.repeat(24).slice(0, 240), 'stale')
      assert.ok(staleCjk.fits && staleCjk.font >= 14, theme + ' stale CJK briefing and its availability remain fully visible: ' + JSON.stringify(staleCjk))
      // The deliberately undersized copy fixture uses the narrow-window fallback.
      win.setContentSize(960, 640)
      await js("window.dispatchEvent(new Event('resize'))")
      const floor = await probe(260, 180, longCopy)
      const scrolledRefit = await probe(260, 180, longCopy)
      assert.equal(floor.font, 16, theme + ' long copy keeps its readable floor')
      assert.equal(floor.reachable, true, theme + ' long copy remains reachable by scrolling')
      assert.equal(scrolledRefit.font, 16, theme + ' scrolling cannot inflate the fitting budget')
      console.log('OVERVIEW_COPY_FIT_PASS ' + JSON.stringify({ theme, typography, short, long, floor, scrolledRefit }))
    } finally {
      await js('(() => { const host = document.querySelector("#home-summary"); const original = ' + JSON.stringify(originalStyle) + '; if (original === null) host.removeAttribute("style"); else host.setAttribute("style", original); host.scrollTop = 0; if ((host.getAttribute("style") || "") !== (original || "")) throw Error("Typography fixture sizing retained"); })()')
      win.webContents.send('odk-personal-bot-status', { state: 'idle', briefing: preview.briefing })
    }
  }
  await js(`(() => {
    const { nodes, texts, netLabel, netTitle } = previewRestore;
    nodes.forEach((node, index) => { node.textContent = texts[index]; });
    delete document.querySelector('[data-preview-simulated]').dataset.previewSimulated;
    const net = document.querySelector('#sb-net'); delete net.dataset.previewConnected;
    net.setAttribute('aria-label', netLabel); net.setAttribute('title', netTitle);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== previewSheet);
    if (document.adoptedStyleSheets.includes(previewSheet) || document.querySelector('[data-preview-simulated], [data-preview-connected]')) throw Error('Preview controls retained');
    if (document.querySelector('.ring-mmss').textContent !== '--:--') throw Error('Pomodoro fixture did not restore the product state');
    delete window.previewRestore; delete window.previewSheet;
  })()`)
  console.log('POPULATED_HOME_PREVIEW_PASS ' + JSON.stringify({ synthetic: true, liveProviders: false, fixtureControlsRestored: true, captures }))
  finish(0)
}).catch(error => finish(1, error))
