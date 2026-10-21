'use strict'
const { app, BrowserWindow, ipcMain, session, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('./helpers/native-page-capture')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-widget-navigation-'))
app.setPath('userData', profile)
let win
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-widget-polish-evidence-'))
const timeout = setTimeout(() => finish(1, Error('Widget navigation timed out')), 60000)
function finish(code, error) {
  clearTimeout(timeout)
  if (error) console.error(error)
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  const preview = installHomePreviewFixtures(ipcMain)
  let wereadReading
  ipcMain.removeHandler('odk-weread-highlight')
  ipcMain.handle('odk-weread-highlight', () => wereadReading || {status:'live', highlight:preview.highlight})
  const endpoint = createAppManagerEndpoint()
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
  ipcMain.removeHandler('odk-app-manager-list')
  ipcMain.handle('odk-app-manager-list', () => endpoint.list())
  let reading = { state: 'live', snapshot: { totals: { plRatio: 0.021 }, positions: Array.from({ length: 40 }, (_, i) => ({ code: `US.STOCK${i}`, price: 10 + i, dayRatio: i / 1000 })) } }
  ipcMain.removeHandler('odk-futu-holdings')
  ipcMain.handle('odk-futu-holdings', () => reading)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true } })
  win.setContentSize(1920, 1280)
  const js = source => win.webContents.executeJavaScript(source)
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  await js('window.odkShellReady')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  let touchTimestamp = Date.now() / 1000 - 60
  const touch = async (type, touchPoints) => {
    // CDP calls can complete within one clock tick on software hosts.
    // Use an ordered input timeline with a 100 ms press, as a real tap has.
    touchTimestamp += 0.1
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type, touchPoints, timestamp: touchTimestamp })
  }
  await js(`(async () => {
    window.until = async predicate => { const deadline = performance.now() + 5000; while (!predicate()) { if (performance.now() > deadline) throw Error('Condition timed out: ' + predicate.toString()); await new Promise(r => setTimeout(r, 20)); } };
    window.navigationInputTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'click', 'focusin', 'focusout']) {
      window.addEventListener(type, event => {
        navigationInputTrace.push({ type, target: event.target?.id || event.target?.className, related: event.relatedTarget?.className, pointerType: event.pointerType, pointerId: event.pointerId, x: event.clientX, y: event.clientY });
        if (navigationInputTrace.length > 20) navigationInputTrace.shift();
      }, true);
    }
    await document.fonts.ready;
    const ids = [...document.querySelectorAll('#pages-track > .page')].map(page => page.dataset.pageId);
    if (JSON.stringify(ids) !== JSON.stringify(['home', 'desk', 'reading'])) throw Error('Only three display pages belong in the desktop');
    if (document.querySelector('[data-plugin="odk.page.pi-sessions"], .page[data-page-id="pi-sessions"]')) throw Error('Pi Sessions App must not mount as a desktop page');
    if (!odkPlugins.byKind('app').some(app => app.appId === 'pi-sessions')) throw Error('Pi Sessions App registration missing');
    const tile = document.querySelector('[data-widget="odk.tile.futu"]');
    if (!tile.querySelector('button.widget-launch')) throw Error('Every Widget needs keyboard App navigation');
  })()`)
  async function capture(name) {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const frame = await capturePaintedPage(win)
    assert.equal(frame.isEmpty(), false)
    fs.writeFileSync(path.join(evidence, name + '.png'), frame.toPNG())
  }
  async function compareWeRead(theme, variant = '') {
    await js(`(async () => {
      await odkTheme.set('${theme}');
      document.querySelectorAll('.dot')[2].click();
      await until(() => [...document.querySelectorAll('link[rel=stylesheet]')].every(link => link.sheet));
      await document.fonts.ready;
      await until(() => !!document.querySelector('.weread-date')?.textContent);
      if (odkTheme.get()==='liquid-glass') await until(() => ['sdk','fallback'].includes(document.documentElement.dataset.liquidGlass));
    })()`)
    await capture(`${theme}${variant}-weread-widget`)
    const before = await js(`(() => {
      const tile = document.querySelector('.w-weread');
      const cover = tile.querySelector('.weread-cover').getBoundingClientRect();
      const properties = ['backgroundColor','backgroundImage','boxShadow','backdropFilter','borderTopWidth','borderTopStyle','borderTopColor','borderTopLeftRadius'];
      const styles = node => Object.fromEntries(properties.map(key => [key,getComputedStyle(node)[key]]));
      window.readingFrameStyles = styles;
      return {frame:styles(tile),coverRatio:cover.width/cover.height, text:tile.querySelector('.weread-text').textContent,
        metadata:['title','author','date'].map(key => {const n=tile.querySelector('.weread-'+key),s=getComputedStyle(n);return {text:n.textContent,size:parseFloat(s.fontSize),weight:s.fontWeight,color:s.color,lineHeight:s.lineHeight}})};
    })()`)
    await js(`(async () => {
      await odkAppPlatform.openApp({appId:'weread',widgetId:'odk.tile.weread',route:'reading'});
      await until(() => !!document.querySelector('.reading-book-title')?.textContent && !document.querySelector('.reading-refresh').disabled && document.querySelector('.reading-book-cover')?.complete);
      if (odkTheme.get()==='liquid-glass') await until(() => document.documentElement.dataset.liquidGlass==='fallback' || (document.documentElement.dataset.liquidGlass==='sdk' && document.getElementById('app-view').classList.contains('lg-surface')));
    })()`)
    await capture(`${theme}${variant}-weread-app`)
    const after = await js(`(() => {
      const card=document.getElementById('app-view');
      const cover=card.querySelector('.weread-cover'),box=cover.getBoundingClientRect();
      return {frame:readingFrameStyles(card),coverRatio:box.width/box.height,naturalRatio:cover.naturalWidth/cover.naturalHeight,text:card.querySelector('.reading-excerpt').textContent,
        metadata:[...card.querySelector('.reading-book-meta').children].map(n=>{const s=getComputedStyle(n);return {text:n.textContent,size:parseFloat(s.fontSize),weight:s.fontWeight,color:s.color,lineHeight:s.lineHeight}})};
    })()`)
    console.log('WEREAD_COMPARISON '+JSON.stringify({theme,before,after,evidence}))
    assert.deepEqual(after.frame,before.frame,theme+': WeRead App material and radius must match its Widget')
    assert.equal(after.text,before.text)
    assert.ok(Math.abs(after.coverRatio-after.naturalRatio)<0.01,'WeRead App must retain the original cover ratio')
    assert.ok(Math.abs(before.coverRatio-after.naturalRatio)<0.01,'WeRead Widget must retain the original cover ratio')
    for (let i=0;i<3;i++) {
      assert.equal(after.metadata[i].text,before.metadata[i].text)
      assert.ok(before.metadata[i].size >= (i===0?18:16),'WeRead Widget metadata must remain legible')
      assert.ok(after.metadata[i].size >= (i===0?18:16),'WeRead App metadata must remain legible')
      assert.equal(after.metadata[i].weight,before.metadata[i].weight)
      assert.equal(after.metadata[i].color,before.metadata[i].color)
    }
    await js('odkAppPlatform.closeApp()')
  }
  async function comparePortraitCover() {
    const cover=nativeImage.createFromBitmap(Buffer.from(Array(8).fill([80,160,100,255]).flat()),{width:2,height:4}).toDataURL()
    wereadReading={status:'live',highlight:{...preview.highlight,cover}}
    await js(`(async()=>{await odkRendererRuntime.setEnabled('odk.tile.weread',false);await odkRendererRuntime.setEnabled('odk.tile.weread',true)})()`)
    await compareWeRead('liquid-glass','-portrait')
    wereadReading=undefined
  }
  async function stressWeReadApp() {
    for (const [width,height] of [[1280,800],[960,640],[480,854],[320,480]]) {
      win.setContentSize(width,height)
      for (const theme of ['instrument','pixel','border-beam','liquid-glass']) {
        wereadReading={status:'live',highlight:{markText:'完整摘录仍然可读，所有文字都必须保留。'.repeat(100), title:'Long English 与中文书名'.repeat(5),author:'Long Author 示例作者'.repeat(5),createTime:Date.now()/1000}}
        await js(`(async()=>{
          await odkTheme.set('${theme}');
          await odkAppPlatform.openApp({appId:'weread',widgetId:'odk.tile.weread',route:'reading'});
          await until(()=>!!document.querySelector('.reading-book-title')?.textContent && !document.querySelector('.reading-refresh').disabled);
          await document.fonts.ready;
          document.getElementById('app-view').scrollIntoView({block:'center'});
        })()`)
        await capture(`${theme}-weread-long-${width}`)
        const stressError = await js(`(() => {try {
          const card=document.getElementById('app-view'), quote=card.querySelector('.weread-text');
          for(const node of card.querySelectorAll('.weread-text,.weread-title,.weread-author,.weread-date')) {
            const box=node.getBoundingClientRect(),bounds=card.getBoundingClientRect();
            if(box.width<=0||box.height<=0||box.left<bounds.left-1||box.right>bounds.right+1) throw Error('WeRead App reading escapes its card: '+node.className);
            if(node===quote && (box.top<bounds.top-1||box.bottom>bounds.bottom+1)) throw Error('WeRead App excerpt escapes its card');
          }
          if(getComputedStyle(card.querySelector('.weread-title')).whiteSpace!=='normal') throw Error('No-cover App title must wrap');
          if(quote.scrollHeight<=quote.clientHeight) throw Error('Long App excerpt must have a scroll path');
          const book=card.querySelector('.weread-foot');
          book.scrollTop=book.scrollHeight;
          const date=card.querySelector('.weread-date').getBoundingClientRect(),region=book.getBoundingClientRect();
          if(date.top<region.top-1||date.bottom>region.bottom+1||region.bottom>card.getBoundingClientRect().bottom+1) throw Error('Book details cannot reach the mark date');
          book.scrollTop=0;
          const title=card.querySelector('.weread-title'),first=document.createRange();
          first.setStart(title.firstChild,0);first.setEnd(title.firstChild,1);
          if(first.getBoundingClientRect().top<region.top-1) throw Error('Book title start is above its scroll origin: '+JSON.stringify({region:region.toJSON(),first:first.getBoundingClientRect().toJSON(),title:title.getBoundingClientRect().toJSON(),scrollTop:book.scrollTop,align:getComputedStyle(book).alignItems,clientHeight:book.clientHeight,scrollHeight:book.scrollHeight}));
          quote.focus();
          return null;
        } catch(error) {return error.message} })()`)
        assert.equal(stressError,null,theme+' '+width+'x'+height)
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35})
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35})
        await js(`(async()=>{
          const quote=document.querySelector('.reading-excerpt');
          await until(()=>quote.scrollTop>0);
          await odkAppPlatform.closeApp();
        })()`)
      }
    }
    wereadReading=undefined
    console.log('PASS WeRead App: 16 long-excerpt and no-cover layouts retain keyboard access and metadata')
  }
  if (process.argv.includes('--weread-compare')) {
    win.setContentSize(1280,800)
    for (const theme of ['liquid-glass','instrument','pixel','border-beam']) await compareWeRead(theme)
    await comparePortraitCover()
    await stressWeReadApp()
    console.log('WIDGET_NAVIGATION_EVIDENCE '+evidence)
    finish(0)
    return
  }
  const hit = await js(`(() => {
    const launch = document.querySelector('[data-widget="odk.tile.futu"] .widget-launch');
    const rect = launch.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
    if (document.elementFromPoint(x, y) !== launch) throw Error('Widget continuation does not cover its reading');
    return { x, y };
  })()`)
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...hit })
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 1, y: 1 })
  assert.equal(await js('document.getElementById("pages-track").classList.contains("dragging")'), false, 'Releasing outside the pager must cancel a pending tap')
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...hit })
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: hit.x - 60, y: hit.y })
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: hit.x - 60, y: hit.y })
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await js('document.getElementById("app-view").hidden'), true, 'Paging drag must not launch an App')
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...hit })
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...hit })
  await js(`(async () => {
    await until(() => !document.getElementById('app-view').hidden && odkAppPlatform.active()?.sourceWidget === 'odk.tile.futu');
    await odkAppPlatform.closeApp();
  })()`)
  const swipeDistance = await js('document.getElementById("pages-viewport").clientWidth * 0.4')
  await touch('touchStart', [{ ...hit, id: 1 }])
  for (const fraction of [0.1, 0.3, 0.7, 1]) {
    await touch('touchMove', [{ x: hit.x - swipeDistance * fraction, y: hit.y, id: 1 }])
  }
  await touch('touchEnd', [])
  assert.equal(await js('document.querySelectorAll(".dot")[1].classList.contains("active")'), true, 'Touch swipe must survive capture transfer from its Widget button')
  assert.equal(await js('document.getElementById("app-view").hidden'), true, 'Touch paging must not launch an App')
  await js('document.querySelectorAll(".dot")[0].click()')
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await js(`odkTheme.set('${theme}')`)
    await js(`(async () => {
      await until(() => [...document.querySelectorAll('link[rel=stylesheet]')].every(link => link.sheet));
      await document.fonts.ready;
    })()`)
    const widgetIds = await js(`[...document.querySelectorAll('#pages-track .widget')].map(tile => tile.dataset.widget)`)
    for (const widgetId of widgetIds) {
      const point = await js(`(async () => {
        const tile = document.querySelector('[data-widget="${widgetId}"]');
        const page = tile.closest('[data-page-id]');
        const pages = [...document.querySelectorAll('#pages-track > .page')];
        document.querySelectorAll('.dot')[pages.indexOf(page)].click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const launch = tile.querySelector('.widget-launch');
        const rect = launch.getBoundingClientRect();
        const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        if (document.elementFromPoint(point.x, point.y) !== launch) throw Error('Widget is not reachable: ' + tile.dataset.widget);
        return point;
      })()`)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
      await js(`(async () => {
        const tile = document.querySelector('[data-widget="${widgetId}"]');
        const launch = tile.querySelector('.widget-launch');
        await until(() => !document.getElementById('app-view').hidden && odkAppPlatform.active()?.sourceWidget === tile.dataset.widget);
        const pane = document.getElementById('desk-content').getBoundingClientRect();
        const frame = document.getElementById('app-view').getBoundingClientRect();
        if (frame.left < pane.left || frame.right > pane.right || frame.width >= pane.width || frame.top < document.getElementById('status-bar').getBoundingClientRect().bottom - 1) throw Error('App card must remain inside the right pane');
        if (getComputedStyle(tile).visibility !== 'hidden') throw Error('Widget must stay hidden behind its App: ' + JSON.stringify({ theme: odkTheme.get(), widget: tile.dataset.widget, visibility: getComputedStyle(tile).visibility }));
        if (document.getElementById('personal-agent').inert || document.getElementById('status-bar').inert) throw Error('Resident surfaces must stay usable');
        if (document.getElementById('app-view').getAttribute('aria-modal') === 'true') throw Error('Pane App is not modal');
        if (getComputedStyle(tile).borderTopStyle === 'none') throw Error('Widget outline missing');
        if (!await odkAppPlatform.closeApp()) throw Error('Close rejected: ' + tile.dataset.widget + ', info=' + document.getElementById('app-view').textContent);
        await until(() => document.activeElement === launch);
      })()`)
      // Offscreen hosts must present the restored page before a native tap.
      await win.webContents.capturePage()
      await touch('touchStart', [{ ...point, id: 1 }])
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await touch('touchEnd', [])
      await js(`(async () => {
        await until(() => !document.getElementById('app-view').hidden && odkAppPlatform.active()?.sourceWidget === '${widgetId}');
        await odkAppPlatform.closeApp();
        await until(() => document.activeElement === document.querySelector('[data-widget="${widgetId}"] .widget-launch'));
      })()`)
    }
    await js(`(async () => {
      const launch = document.querySelector('[data-widget="odk.tile.pomodoro"] .widget-launch');
      document.querySelectorAll('.dot')[0].click();
      launch.click();
      await until(() => !!document.getElementById('pomodoro-toggle'));
      document.getElementById('pomodoro-toggle').click();
      await odkAppPlatform.closeApp();
      await until(() => document.querySelector('[data-widget="odk.tile.pomodoro"] .pomodoro-state').textContent === 'Focusing');
      launch.click();
      await until(() => !!document.getElementById('pomodoro-toggle'));
      document.getElementById('pomodoro-toggle').click();
      await odkAppPlatform.closeApp();
      await until(() => document.querySelector('[data-widget="odk.tile.pomodoro"] .pomodoro-state').textContent === 'Paused');
      launch.click();
      await until(() => !!document.getElementById('pomodoro-reset'));
      document.getElementById('pomodoro-reset').click();
      await odkAppPlatform.closeApp();
      await until(() => document.querySelector('[data-widget="odk.tile.pomodoro"] .pomodoro-state').hidden === true && document.querySelector('[data-widget="odk.tile.pomodoro"] .ring-mmss').textContent === '25:00');
    })()`)
    console.log('PASS ' + theme + ': Pomodoro Widget follows actual App start, pause, and reset')
    await js(`document.querySelectorAll('.dot')[2].click(); document.getElementById('sb-pi-status').focus()`)
    for (const type of ['keyDown', 'char', 'keyUp']) {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'char' ? { text: '\r' } : {}) })
    }
    await js(`(async () => {
      const launch = document.querySelector('[data-widget="odk.tile.pi-sessions"] .widget-launch');
      await until(() => document.querySelector('#pages-track .page[data-page-id="home"]').getBoundingClientRect().left === document.getElementById('pages-viewport').getBoundingClientRect().left);
      if (document.activeElement !== launch || !document.getElementById('app-view').hidden || odkAppPlatform.active()) throw Error('Status must focus the Home Widget without opening its App: ' + JSON.stringify({ activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id, widget: document.activeElement?.closest('[data-widget]')?.dataset.widget }, appHidden: document.getElementById('app-view').hidden, activeApp: odkAppPlatform.active(), index: [...document.querySelectorAll('#dots .dot')].findIndex(dot => dot.classList.contains('active')), trace: navigationInputTrace }));
      if (document.getElementById('sb-pi-status').title !== 'Show Pi Sessions widget') throw Error('Status action must identify the Widget');
    })()`)
    console.log('PASS ' + theme + ': three display pages and Pi status focuses its sole Widget App entry')
    await js(`(async () => {
      document.querySelectorAll('.dot')[0].click();
      const overview = document.querySelector('#home-summary .dash');
      if (parseFloat(getComputedStyle(overview).borderTopWidth) !== 0) throw Error('Overview must stay borderless');
      if (getComputedStyle(document.getElementById('status-bar'), '::before').backdropFilter === 'none') throw Error('State Bar frost layer must be blurred');
      const tile = document.querySelector('[data-widget="odk.tile.futu"]'); tile.querySelector(".widget-launch").click();
      await until(() => document.querySelectorAll('.futu-app .futu-holding').length === 40);
      const list = document.querySelector('.futu-app .futu-holdings');
      if (list.scrollHeight <= list.clientHeight) throw Error('Complete holdings list must scroll');
      const rowStyle = getComputedStyle(list.children[1]);
      if (parseFloat(rowStyle.borderTopWidth) < 1 || rowStyle.borderTopStyle === 'none') throw Error('App holdings must retain visible row separators');
      const priceHead = document.querySelector('.futu-columns > :nth-child(2)').getBoundingClientRect();
      const firstPrice = list.querySelector('.futu-price').getBoundingClientRect();
      if (Math.abs(priceHead.right - firstPrice.right) > 1) throw Error('Holdings prices must align with their column heading');
      list.scrollTop = 280;
      window.holdingsScroll = list.scrollTop;
      document.querySelector('.futu-app .reading-refresh').click();
      await until(() => !document.querySelector('.futu-app .reading-refresh').disabled);
      if (list.scrollTop !== window.holdingsScroll) throw Error('Refresh must preserve holdings scroll');
      list.scrollTop = list.scrollHeight;
      if (list.lastElementChild.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom + 1) throw Error('Last holding must be reachable');
      await odkAppPlatform.closeApp();
      const reading = document.querySelector('[data-page-id="reading"] .widget-grid');
      const excerpt = reading.querySelector('.w-weread');
      if (getComputedStyle(excerpt).gridColumn !== '1 / 4' || getComputedStyle(excerpt).gridRow !== '1 / 4') throw Error('WeRead must span 3x3');
    })()`)
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved',x:0,y:0})
    // Compare every source and continuation after native launches, not just Futu.
    for (const features of [[], [{name:'prefers-reduced-transparency',value:'reduce'}], [{name:'prefers-contrast',value:'more'}], [{name:'forced-colors',value:'active'}]]) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features})
      await js(`(async()=>{
        const frameStyle=n=>{const s=getComputedStyle(n);return [s.borderTopWidth,s.borderTopStyle,s.borderTopColor,s.borderTopLeftRadius,s.backgroundColor,s.backgroundImage,s.boxShadow,s.backdropFilter]};
        for(const tile of document.querySelectorAll('#pages-track .widget')){
          const pages=[...document.querySelectorAll('#pages-track > .page')];
          document.querySelectorAll('.dot')[pages.indexOf(tile.closest('.page'))].click();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          if(odkTheme.get()==='liquid-glass') await until(()=>['sdk','fallback'].includes(document.documentElement.dataset.liquidGlass));
          const source=frameStyle(tile);
          if(!await odkAppPlatform.openApp({appId:tile.dataset.openApp,widgetId:tile.dataset.widget,route:'home'}))throw Error('Frame fixture App failed to open: '+tile.dataset.widget);
          const card=document.getElementById('app-view');
          if(odkTheme.get()==='liquid-glass') await until(()=>document.documentElement.dataset.liquidGlass==='fallback'||(document.documentElement.dataset.liquidGlass==='sdk'&&card.classList.contains('lg-surface')));
          const app=frameStyle(card);
          if(JSON.stringify(source)!==JSON.stringify(app))throw Error('Frame mismatch '+tile.dataset.widget+': '+JSON.stringify({source,app}));
          await odkAppPlatform.closeApp();
        }
      })()`)
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]})
    await js(`(async () => { await odkAppPlatform.openApp({ appId: 'futu' }); await until(() => document.querySelectorAll('.futu-app .futu-holding').length === 40); })()`)
    await capture(`${theme}-futu`)
    await js(`(async () => { await odkAppPlatform.closeApp(); document.querySelectorAll('.dot')[2].click(); })()`)
    await capture(`${theme}-reading`)
    await compareWeRead(theme)
    await js(`document.querySelectorAll('.dot')[1].click()`)
    await capture(`${theme}-desk`)
    await js(`document.querySelectorAll('.dot')[0].click()`)
    await capture(`${theme}-home`)
    console.log(`PASS ${theme}: native mouse and touch on all Widgets, pane bounds, focus, materials, complete scrolling holdings, 3x3 reading`)
  }
  for (const [width, height] of [[1280, 776], [960, 640], [480, 854], [320, 480]]) {
    win.setContentSize(width, height)
    await js(`window.dispatchEvent(new Event('resize'))`)
    await js(`(async () => {
      await until(() => window.__odkGrid.width === ${width} && window.__odkGrid.height === ${height});
      await odkTheme.set('instrument');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const launch = document.querySelector('[data-widget="odk.tile.futu"] .widget-launch');
      launch.scrollIntoView({ block: 'center' }); launch.focus({ preventScroll: true });
      if (document.activeElement !== launch) throw Error('Compact launch did not focus');
    })()`)
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await js(`(async () => {
      await until(() => document.querySelectorAll('.futu-app .futu-holding').length === 40);
      const frame = document.getElementById('app-view').getBoundingClientRect();
      const pane = document.getElementById('desk-content').getBoundingClientRect();
      if (frame.width >= pane.width || frame.width > innerWidth) throw Error('Compact App escaped its pane');
      const list = document.querySelector('.futu-app .futu-holdings');
      list.focus(); list.scrollTop = list.scrollHeight;
      const price = list.lastElementChild.querySelector('.futu-price');
      if (getComputedStyle(price).display === 'none') throw Error('App must retain compact prices');
      if (list.scrollWidth > list.clientWidth + 1) throw Error('Compact list overflows horizontally');
    })()`)
    await capture(`instrument-futu-${width}`)
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    assert.equal(await js('document.getElementById("app-view").hidden'), false, 'Escape cannot bypass the Widget App handle')
    await js('document.querySelector("#dots .dot.active").focus()')
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 })
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 })
    await js(`(async () => {
      await until(() => document.getElementById('app-view').hidden);
      await until(() => document.activeElement === document.querySelector('[data-widget="odk.tile.futu"] .widget-launch'));
    })()`)
    console.log(`PASS ${width}x${height}: native Enter/handle return, compact prices and scroll containment`)
  }
  for (const state of ['unconfigured', 'needs-auth', 'unavailable', 'syncing', 'live']) {
    reading = { state, snapshot: state === 'live' ? { totals: {}, positions: [] } : null }
    await js(`(async () => {
      await odkAppPlatform.openApp({ appId: 'futu' });
      document.querySelector('.futu-app .reading-refresh').click();
      await until(() => !document.querySelector('.futu-app .reading-refresh').disabled);
      if (document.querySelectorAll('.futu-app .futu-holding').length) throw Error('Missing positions must not be fabricated');
      if (!document.querySelector('.futu-app .futu-note').textContent.trim()) throw Error('Missing state label');
      await odkAppPlatform.closeApp();
    })()`)
  }
  reading = { state: 'unavailable', updatedAt: Date.now(), snapshot: { totals: { plRatio: 0.01 }, positions: Array.from({ length: 40 }, (_, i) => ({ code: 'US.' + 'LONGOPTION'.repeat(8) + i, price: i + 1, dayRatio: 0.01 })) } }
  win.setContentSize(960, 640)
  await js(`(async () => {
    await odkAppPlatform.openApp({ appId: 'futu' });
    await until(() => document.querySelectorAll('.futu-app .futu-holding').length === 40);
    const list = document.querySelector('.futu-app .futu-holdings');
    list.scrollTop = 240; const scroll = list.scrollTop;
    document.querySelector('.futu-app .reading-refresh').click();
    await until(() => !document.querySelector('.futu-app .reading-refresh').disabled);
    if (list.scrollTop !== scroll) throw Error('Stale refresh reset scroll');
    if ([...list.querySelectorAll('.futu-price')].some(price => getComputedStyle(price).display === 'none')) throw Error('Long App symbols hide prices');
    if (!document.querySelector('.futu-app .futu-note').textContent.includes('Stale')) throw Error('Retained holdings must be labelled stale');
    await odkAppPlatform.closeApp();
  })()`)
  console.log('PASS stale refresh preserves scroll and long symbols retain every price')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await js('getComputedStyle(document.getElementById("status-bar")).backdropFilter'), 'none')
  assert.equal(await js('getComputedStyle(document.getElementById("status-bar"), "::before").backdropFilter'), 'none')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  console.log('PASS reduced transparency uses solid chrome')
  await js(`(async () => {
    await odkRendererRuntime.setEnabled('odk.tile.futu', false);
    if (document.querySelector('[data-widget="odk.tile.futu"]')) throw Error('Disabled Widget remains mounted');
    await odkRendererRuntime.setEnabled('odk.tile.futu', true);
    const original = odkPlugins.get('odk.tile.futu');
    await odkRendererRuntime.replace({ ...original, opensApp: undefined });
    const tile = document.querySelector('[data-widget="odk.tile.futu"]');
    if (tile.querySelectorAll('.widget-launch').length !== 1) throw Error('Replacement lost its Shell continuation');
    tile.querySelector('.widget-launch').click();
    await until(() => odkAppPlatform.active()?.appId === 'futu');
    await odkAppPlatform.closeApp();
    await odkRendererRuntime.restoreDefault('odk.tile.futu');
    if (document.querySelectorAll('[data-widget="odk.tile.futu"] .widget-launch').length !== 1) throw Error('Recovery duplicated its Shell continuation');
  })()`)
  console.log('PASS disable, replacement, and recovery preserve exactly one App continuation')
  console.log('PASS Futu empty, unconfigured, unauthorized, unavailable, and loading states')
  assert.equal(await js('document.querySelectorAll("#pages-track .widget .widget-launch").length'), 8)
  await comparePortraitCover()
  await stressWeReadApp()
  console.log('WIDGET_NAVIGATION_EVIDENCE ' + evidence)
  finish(0)
}).catch(async error => {
  if (win && !win.isDestroyed()) {
    try { console.error('INPUT_TRACE ' + JSON.stringify(await win.webContents.executeJavaScript('window.navigationInputTrace'))) } catch {}
  }
  finish(1, error)
})
