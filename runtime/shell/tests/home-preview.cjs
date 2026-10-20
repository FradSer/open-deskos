'use strict'

const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')
const { resolvePages } = require('./helpers/pages')
const { installTimeWidgetLayout } = require('./helpers/time-widget-layout')
const allPages = process.argv.includes('--all-pages')
const captureDir = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length) || os.tmpdir()
fs.mkdirSync(captureDir, { recursive: true })

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-home-preview-profile-'))
app.setPath('userData', profile)
let win
const timeout = setTimeout(() => finish(1, Error('Populated Home preview timed out')), allPages ? 180000 : 60000)
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
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) for (const [width, height] of [[1920, 1280], [1280, 776]]) {
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
    if (allPages) await installTimeWidgetLayout(win, { pageId: 'time-preview', separatePage: true })
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
    await js('window.odkShellReady')
    await js(`(async () => {
      const deadline = performance.now() + 5000;
      while (document.querySelector('.pi-widget-count').textContent !== '3' || !document.querySelector('.agent-message-assistant') || document.querySelector('.quota-tile-value').textContent !== '64%') {
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
    await js(`(async () => {
      await odkTheme.set('${theme}');
      // Theme activation can finish before its stylesheet imports have loaded.
      // Wait for the shared material to apply before measuring or capturing it.
      const styleDeadline = performance.now() + 5000;
      while ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => !link.sheet)
        || ('${theme}' === 'liquid-glass' && !getComputedStyle(document.documentElement).getPropertyValue('--odk-glass-material').trim())) {
        if (performance.now() > styleDeadline) throw Error('Preview theme styles did not load');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      window.dispatchEvent(new Event('resize'));
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if ('${theme}' === 'liquid-glass' && !['sdk', 'fallback'].includes(document.documentElement.dataset.liquidGlass)) {
        await new Promise((resolve, reject) => {
          const observer = new MutationObserver(() => {
            if (!['sdk', 'fallback'].includes(document.documentElement.dataset.liquidGlass)) return;
            clearTimeout(timer);
            observer.disconnect();
            resolve();
          });
          const timer = setTimeout(() => { observer.disconnect(); reject(Error('Liquid Glass did not finish map setup')); }, 12000);
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-liquid-glass'] });
        });
      }
    })()`)
    const state = await js(`(() => {
      const home = document.querySelector('[data-page-id="home"]');
      const tiles = [...home.querySelectorAll('.widget')];
      const square = tiles.every(tile => { const r = tile.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1; });
      const time = document.querySelector('.ring-mmss').getBoundingClientRect();
      const dial = document.querySelector('.ring-track').getBoundingClientRect();
      const bubble = document.querySelector('.agent-message-assistant .agent-message-bubble');
      const summary = document.querySelector('#home-summary');
      const overview = summary.querySelector('.dash');
      const overviewStyle = getComputedStyle(overview);
      const glassWidget = home.querySelector('.widget[data-interaction="display-only"]');
      const glassWidgetStyle = glassWidget ? getComputedStyle(glassWidget) : null;
      return { square, columns: window.__odkGrid.cols, rows: window.__odkGrid.rows, cell: window.__odkGrid.cellDim,
        pi: document.querySelector('.pi-widget-count').textContent,
        weather: document.querySelector('[data-widget="odk.tile.weather"]').textContent,
        holdings: document.querySelector('[data-widget="odk.tile.futu"]').textContent,
        narrative: document.querySelector('#dash-narrative').textContent,
        placeholder: /unavailable|not started|--:--/.test(home.textContent.toLowerCase()),
        paragraphs: document.querySelectorAll('.agent-message').length,
        repeatedNames: document.querySelectorAll('.agent-message-name, .agent-caption').length,
        messageMetadata: document.querySelectorAll('.agent-message time, .agent-message-avatar').length,
        identityCapsule: document.querySelector('.agent-identity summary').getBoundingClientRect().height >= 44 && document.querySelector('.agent-head .agent-state') !== null,
        agentBubble: !!bubble && getComputedStyle(bubble).backgroundColor !== 'rgba(0, 0, 0, 0)',
        timerFits: time.width <= dial.width * 0.84 && Math.abs((time.left + time.right) / 2 - (dial.left + dial.right) / 2) < 1,
        timerBounds: { text: time.width, dial: dial.width, centerDelta: Math.abs((time.left + time.right) / 2 - (dial.left + dial.right) / 2), font: getComputedStyle(document.querySelector('.ring-mmss')).fontSize },
        noFooter: !home.querySelector('.dash-foot, details, summary'),
        summaryFit: { height: summary.clientHeight, content: summary.scrollHeight, font: getComputedStyle(summary.querySelector('.dash-narrative')).fontSize },
        liquidGlass: document.documentElement.dataset.liquidGlass,
        overviewCard: { borderWidth: overviewStyle.borderTopWidth, borderStyle: overviewStyle.borderTopStyle,
          borderRadius: overviewStyle.borderTopLeftRadius, background: overviewStyle.backgroundColor,
          shadow: overviewStyle.boxShadow, backdrop: overviewStyle.backdropFilter,
          liquidGlassSurface: overview.classList.contains('lg-surface'),
          paddingInline: overviewStyle.paddingInlineStart },
        glassWidget: glassWidgetStyle && { borderWidth: glassWidgetStyle.borderTopWidth,
          backgroundImage: glassWidgetStyle.backgroundImage, liquidGlassSurface: glassWidget.classList.contains('lg-surface') },
        temperature: document.querySelector('.w-temp')?.textContent,
        viewport: [innerWidth, innerHeight, devicePixelRatio, document.fonts.status] };
    })()`)
    assert.equal(state.square, true)
    if (theme === 'liquid-glass') assert.ok(['sdk', 'fallback'].includes(await js('document.documentElement.dataset.liquidGlass')))
    assert.equal(state.columns, 3)
    assert.equal(state.rows, 2)
    assert.equal(state.pi, '3')
    assert.match(state.weather, /Taipei/)
    assert.match(state.weather, /26/)
    assert.match(state.holdings, /62\.15/)
    assert.equal(state.narrative, preview.briefing.items[0].text)
    assert.equal(state.placeholder, false)
    assert.equal(state.paragraphs, 3)
    assert.equal(await js(`document.querySelectorAll('.agent-update').length`), 2)
    assert.equal(await js(`document.querySelector('.agent-earlier-updates').open`), false)
    assert.deepEqual(await js(`[...document.querySelectorAll('.agent-update .agent-message-body')].map(n=>n.firstChild.textContent)`), preview.updates)
    assert.equal(state.repeatedNames, 0, 'Agent name is not repeated inside the conversation')
    assert.equal(state.messageMetadata, 0, 'conversation messages have no avatars or timestamps')
    assert.equal(state.identityCapsule, true, 'the name and status capsule exposes the existing identity editor')
    assert.equal(state.agentBubble, true, 'Agent messages have a background container')
    assert.equal(state.timerFits, true, theme + ' complete timer reading has space inside the dial: ' + JSON.stringify(state.timerBounds))
    assert.equal(state.noFooter, true)
    assert.ok(state.summaryFit.content <= state.summaryFit.height, 'normal summary fits without an inner scrollbar: ' + JSON.stringify(state.summaryFit))
    if (theme === 'liquid-glass') {
      assert.equal(state.overviewCard.liquidGlassSurface, false, 'Overview has no separate Liquid Glass card surface')
      assert.equal(state.overviewCard.borderWidth, '0px', 'Overview has no card border')
      assert.equal(state.overviewCard.borderRadius, '0px', 'Overview has no card frame')
      assert.equal(state.overviewCard.background, 'rgba(0, 0, 0, 0)', 'Overview stays on the shared canvas')
      assert.equal(state.overviewCard.shadow, 'none', 'Overview has no card edge highlight')
      assert.equal(state.overviewCard.backdrop, 'none', 'Overview has no separate card blur')
      assert.ok(Number.parseFloat(state.overviewCard.paddingInline) >= 16, 'Overview retains the wider content inset')
      assert.equal(state.glassWidget.borderWidth, '1px', 'Widget card keeps its own Liquid Glass border')
      if (state.liquidGlass === 'sdk') assert.equal(state.glassWidget.liquidGlassSurface, true, 'Widget card retains its SDK glass surface')
      else assert.notEqual(state.glassWidget.backgroundImage, 'none', 'Widget card keeps its static glass tint')
    }
    assert.deepEqual(state.viewport, [width, height, 1, 'loaded'])
    const file = path.join(captureDir, `odk-populated-home-${theme}-${width}.png`)
    // Acknowledge a native frame, then request the current compositor surface.
    // Paint events can still carry pixels from before the fixture update.
    await capturePaintedFrame()
    const capture = await win.webContents.capturePage()
    const bitmap = capture.getSize()
    const backingScale = bitmap.width / width
    assert.ok(backingScale >= 1 && backingScale <= 2)
    assert.equal(bitmap.height / height, backingScale, 'Preview capture must not crop the viewport')
    fs.writeFileSync(file, capture.toPNG())
    captures.push({ theme, width, height, cell: state.cell,
      ...(theme === 'liquid-glass' ? { liquidGlass: await js('document.documentElement.dataset.liquidGlass') } : {}), file })
    if (allPages) {
      const pages = await resolvePages(win)
      for (const page of ['desk', 'preorder', 'reading', 'time-preview']) {
        await js(`document.querySelectorAll('.dot')[${pages.dot(page)}].click()`)
        await js(`(async () => {
          const node = document.querySelector('[data-page-id="${page}"]'), viewport = document.querySelector('#pages-viewport');
          const deadline = performance.now() + 5000;
          while (Math.abs(node.getBoundingClientRect().left - viewport.getBoundingClientRect().left) > 1) {
            if (performance.now() > deadline) throw Error('Preview page did not settle: ${page}');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`)
        if (page === 'desk') {
          const spacing = await js(`(() => {
            const card = document.querySelector('[data-widget="odk.tile.hydra"]');
            const body = card.querySelector('.hydra-body'), head = card.querySelector('.hydra-head');
            const plants = card.querySelector('.hydra-plants'), env = card.querySelector('.hydra-env');
            return { shape: body.dataset.shape, cardHeight: card.getBoundingClientRect().height,
              cellHeight: card.parentElement.getBoundingClientRect().height,
              contentWidth: body.getBoundingClientRect().width, plantWidth: plants.getBoundingClientRect().width,
              display: getComputedStyle(body).display, gap: getComputedStyle(body).rowGap, rows: getComputedStyle(body).gridTemplateRows,
              afterHeader: plants.getBoundingClientRect().top - head.getBoundingClientRect().bottom,
              beforeEnvironment: env.getBoundingClientRect().top - plants.getBoundingClientRect().bottom,
              contained: card.scrollHeight <= card.clientHeight + 1 };
          })()`)
          assert.equal(spacing.shape, 'wide')
          assert.equal(spacing.contained, true)
          assert.ok(Math.abs(spacing.contentWidth - spacing.plantWidth) < 1, 'Hydra content fills the card width')
          assert.ok(spacing.cardHeight <= spacing.cellHeight - 32, 'Hydra card releases unused Cell height')
          assert.ok([spacing.afterHeader, spacing.beforeEnvironment].every(gap => gap >= 12 && gap <= 20.1), JSON.stringify(spacing))
          console.log('HYDRA_COMPACT_CARD_PASS ' + JSON.stringify({ theme, width, ...spacing }))
        }
        if (page === 'reading') {
          const attribution = await js(`(async () => {
            const tile = document.querySelector('[data-widget="odk.tile.weread"]');
            const author = tile.querySelector('.weread-author'), cover = tile.querySelector('.weread-cover');
            const wrap = tile.querySelector('.weread-cover-wrap'), foot = tile.querySelector('.weread-foot');
            const deadline = performance.now() + 5000;
            while (wrap.hidden || author.hidden || !cover.width || !cover.getContext('2d').getImageData(0, 0, 1, 1).data[3]) {
              if (performance.now() > deadline) throw Error('Reading preview attribution did not render');
              await new Promise(resolve => setTimeout(resolve, 20));
            }
            const frame = tile.getBoundingClientRect(), row = foot.getBoundingClientRect();
            const image = cover.getBoundingClientRect(), name = author.getBoundingClientRect();
            const title = tile.querySelector('.weread-title').getBoundingClientRect();
            return { author: author.textContent, title: tile.querySelector('.weread-title').textContent,
              authorBelowTitle: name.top >= title.bottom, coverRightOfAuthor: image.left >= name.right,
              footerContained: row.top >= frame.top && row.bottom <= frame.bottom && image.right <= frame.right,
              coverSize: [image.width, image.height] };
          })()`)
          assert.equal(attribution.author, preview.highlight.author)
          assert.equal(attribution.title, preview.highlight.title)
          assert.equal(attribution.authorBelowTitle, true)
          assert.equal(attribution.coverRightOfAuthor, true)
          assert.equal(attribution.footerContained, true)
          assert.ok(attribution.coverSize.every(size => size > 0))
          console.log('READING_ATTRIBUTION_PASS ' + JSON.stringify({ theme, width, ...attribution }))
        }
        const file = path.join(captureDir, `odk-populated-${page}-${theme}-${width}.png`)
        await capturePaintedFrame()
        fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG())
        captures.push({ page, theme, width, height, file, synthetic: true })
      }
      await js(`document.querySelectorAll('.dot')[${pages.dot('home')}].click()`)
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }
  const longCopy = 'You have 3 active sessions across 3 workspaces, while 2 plants report 63% moisture. Taipei is 26°C and overcast; your focus session is in progress, and portfolio readings are available from the latest synchronized snapshot.'
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    win.setContentSize(1280, 776)
    await js("window.dispatchEvent(new Event('resize')); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))")
    const originalStyle = await js("document.querySelector('#home-summary').getAttribute('style')")
    let probeRevision = 0
    const probe = async (width, height, text, state = 'live') => {
      const frame = { ...preview.briefing, state, generatedAt: preview.briefing.generatedAt + ++probeRevision, items: [{ ...preview.briefing.items[0], text, segments: [{ text, icon: 'sessions' }] }] }
      await js("odkTheme.set('" + theme + "').then(() => Object.assign(document.querySelector('#home-summary').style, { width: '" + width + "px', height: '" + height + "px', maxWidth: 'none' }))")
      win.webContents.send('odk-personal-bot-status', { state: 'idle', jev: {status:'verified'}, briefing: frame })
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
      await js(`(async () => {
        const deadline = performance.now() + 3000;
        while (innerWidth !== 960 || innerHeight !== 640) {
          if (performance.now() > deadline) throw Error('Narrow preview viewport not delivered');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        window.dispatchEvent(new Event('resize'));
        while (getComputedStyle(document.querySelector('#home-summary')).overflowY !== 'auto') {
          if (performance.now() > deadline) throw Error('Narrow preview scrolling geometry not applied');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      })()`)
      const floor = await probe(260, 180, longCopy)
      const scrolledRefit = await probe(260, 180, longCopy)
      console.log('OVERVIEW_FLOOR_CONTEXT ' + JSON.stringify({ theme, floor, viewport: await js('[innerWidth, innerHeight, document.documentElement.dataset.fitCanvas, getComputedStyle(document.querySelector("#home-summary")).overflowY]') }))
      assert.equal(floor.font, 16, theme + ' long copy keeps its readable floor')
      assert.equal(floor.reachable, true, theme + ' long copy remains reachable by scrolling')
      assert.equal(scrolledRefit.font, 16, theme + ' scrolling cannot inflate the fitting budget')
      console.log('OVERVIEW_COPY_FIT_PASS ' + JSON.stringify({ theme, typography, short, long, floor, scrolledRefit }))
    } finally {
      await js('(() => { const host = document.querySelector("#home-summary"); const original = ' + JSON.stringify(originalStyle) + '; if (original === null) host.removeAttribute("style"); else host.setAttribute("style", original); host.scrollTop = 0; if ((host.getAttribute("style") || "") !== (original || "")) throw Error("Typography fixture sizing retained"); })()')
      win.webContents.send('odk-personal-bot-status', { state: 'idle', jev: {status:'verified'}, briefing: preview.briefing })
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
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    const previous = win
    const width = 480, height = 854
    win = new BrowserWindow({ show: false, frame: false, width, height, useContentSize: true,
      webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true,
        contextIsolation: true, backgroundThrottling: false, offscreen: true } })
    previous.destroy()
    win.setContentSize(width, height)
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
    await js('window.odkShellReady')
    await js(`(async()=>{ await odkTheme.set('${theme}'); await document.fonts.ready; const until=performance.now()+5000; while(document.querySelectorAll('.agent-update').length!==2){if(performance.now()>until)throw Error('Synthetic updates unavailable');await new Promise(r=>setTimeout(r,20))} await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); document.querySelector('.agent-conversation').scrollTop=0; })()`)
    const compact = await js(`(()=>{const c=document.querySelector('.agent-conversation'),p=document.querySelector('.agent-composer');return {viewport:[innerWidth,innerHeight],overflow:c.scrollWidth-c.clientWidth,composerBottom:p.getBoundingClientRect().bottom,oldClosed:!document.querySelector('.agent-earlier-updates').open,texts:[...document.querySelectorAll('.agent-update .agent-message-body')].map(n=>n.firstChild.textContent)}})()`)
    assert.deepEqual(compact.viewport,[width,height]);assert.ok(compact.overflow<=1);assert.ok(compact.composerBottom<=height);assert.equal(compact.oldClosed,true);assert.deepEqual(compact.texts,preview.updates)
    await js(`document.querySelector('.agent-conversation').scrollTop=0; new Promise(r=>setTimeout(r,100))`)
    await capturePaintedFrame()
    assert.equal(await js(`document.querySelector('.agent-conversation').scrollTop`),0)
    const file=path.join(os.tmpdir(),`odk-agent-updates-normal-${theme}-${width}.png`)
    fs.writeFileSync(file,(await win.webContents.capturePage()).toPNG())
    captures.push({theme,width,height,file,syntheticUpdates:true})
  }
  console.log('POPULATED_HOME_PREVIEW_PASS ' + JSON.stringify({ synthetic: true, liveProviders: false, fixtureControlsRestored: true, captures }))
  finish(0)
}).catch(error => finish(1, error))
