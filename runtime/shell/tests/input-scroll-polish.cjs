const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { personalAgentIdentityScript } = require('./helpers/live-fixtures')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const { capturePaintedPage } = require('./helpers/native-page-capture')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-input-scroll-profile-'))
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-input-scroll-evidence-'))
app.setPath('userData', profile)
let win
const failures = []
const report = []
const timer = setTimeout(() => finish(1, Error('Input/scroll checks timed out')), 90000)
function finish(code, error) {
  clearTimeout(timer)
  if (error) console.error(error)
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
function check(name, result) {
  if (!result) failures.push(name)
}
const js = source => win.webContents.executeJavaScript(source).catch(error => { console.error('Renderer check failed:', source); throw error })
async function capture(name) {
  const frame = await capturePaintedPage(win)
  assert.equal(frame.isEmpty(), false)
  fs.writeFileSync(path.join(evidence, name + '.png'), frame.toPNG())
}

async function glassControls() {
  await js(`(async()=>{await odkTheme.set('liquid-glass');await document.fonts.ready;await polishUntil(()=>['sdk','fallback'].includes(document.documentElement.dataset.liquidGlass))})()`)
  for (const [width,height] of [[1280,800],[1920,1280],[320,480]]) {
    win.setContentSize(width,height)
    await js(`(async()=>{
      await odkRendererRuntime.setEnabled('odk.page.personal-agent',false);
      await odkRendererRuntime.setEnabled('odk.page.personal-agent',true);
      await polishUntil(()=>document.querySelector('.agent-composer')?.dataset.mode==='voice'&&document.querySelector('.agent-mic-label')?.textContent==='Tap to talk');
    })()`)
    await js(`document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`)
    await js(`polishUntil(()=>['sdk','fallback'].includes(document.documentElement.dataset.liquidGlass))`)
    const inspect = async label => {
      await js(`polishUntil(()=>{const n=document.querySelector('.agent-composer'),s=getComputedStyle(n);return s.backgroundImage!=='none'||n.classList.contains('lg-surface')&&document.documentElement.dataset.liquidGlass==='sdk'})`).catch(async error=>{console.error(await js(`(()=>{const n=document.querySelector('.agent-mic'),s=getComputedStyle(n);return {width:innerWidth,style:n.style.cssText,classes:n.className,mode:document.documentElement.dataset.liquidGlass,background:s.background,material:s.getPropertyValue('--odk-glass-control-material'),media:matchMedia('(prefers-contrast: more)').matches}})()`));throw error})
      const result=await js(`(()=>{
        const widget=document.querySelector('.widget[data-interaction="display-only"]'),edge=getComputedStyle(widget).borderTopColor;
        return [...document.querySelectorAll('button,input,textarea,select,summary,[role="button"],.agent-composer,.agent-capsule')].filter(n=>n.getClientRects().length && !n.matches('.widget-launch,.dot,.agent-session-open,.agent-composer textarea,.agent-composer button,input[type="checkbox"],input[type="radio"],input[type="range"]')).map(n=>{const s=getComputedStyle(n);return {name:n.className||n.id||n.tagName,border:s.borderTopWidth,style:s.borderTopStyle,color:s.borderTopColor,edge,image:s.backgroundImage,shadow:s.boxShadow,foreground:s.color,radius:s.borderTopLeftRadius,sdk:n.classList.contains('lg-surface')&&document.documentElement.dataset.liquidGlass==='sdk'}})
      })()`)
      for (const row of result) {
        check(`${width} ${label}: ${row.name} glass frame`,row.border==='1px'&&row.style==='solid'&&(row.image!=='none'||row.sdk)&&row.shadow.includes('inset'))
      }
      report.push({width,height,label,controls:result})
    }
    await inspect('voice')
    await capture('glass-voice-'+width)
    await js(`document.querySelector('.agent-keys').click()`)
    await inspect('keyboard')
    await js(`(()=>{const input=document.querySelector('.agent-composer textarea');input.focus();const s=getComputedStyle(input),c=getComputedStyle(document.querySelector('.agent-composer'));if(s.borderTopWidth!=='0px'||s.outlineStyle!=='none'||c.outlineStyle==='none')throw Error('Integrated text focus must use the composer frame')})()`)
    await capture('glass-keyboard-'+width)
    check('identity is read-only',await js(`document.querySelector('.agent-capsule').tabIndex===-1&&!document.querySelector('.agent-identity summary,.agent-identity form,.agent-identity svg')`))
    await js(`document.querySelector('.agent-composer textarea').value='';document.querySelector('.agent-mic').click()`)
  }
  win.setContentSize(1280,800)
  for (const appId of ['pomodoro','weather','futu','pi-sessions','quota']) {
    await js(`(async()=>{await odkAppPlatform.openApp({appId:${JSON.stringify(appId)}});await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`)
    const missing=await js(`(()=>{return [...document.querySelectorAll('#app-view button,#app-view input,#app-view select')].filter(n=>n.getBoundingClientRect().width>=2&&n.getBoundingClientRect().height>=2&& !n.matches('input[type="checkbox"],input[type="radio"],input[type="range"]')).filter(n=>{const s=getComputedStyle(n);return s.borderTopWidth!=='1px'||s.backgroundImage==='none'||!s.boxShadow.includes('inset')}).map(n=>n.className||n.id)})()`)
    check(appId+': all App controls share glass frames',missing.length===0)
    report.push({appId,missing})
    await capture('glass-app-'+appId)
    await js('odkAppPlatform.closeApp()')
  }
  check('page markers have no enclosing material frame',await js(`(()=>{const n=document.querySelector('#dots'),s=getComputedStyle(n);return s.borderTopWidth==='0px'&&s.backgroundImage==='none'&&s.boxShadow==='none'&&s.backdropFilter==='none'&&getComputedStyle(n,'::before').content==='none'})()`))
  await win.webContents.debugger.sendCommand('DOM.enable')
  await win.webContents.debugger.sendCommand('CSS.enable')
  const {root:dom}=await win.webContents.debugger.sendCommand('DOM.getDocument')
  await js(`odkAppPlatform.openApp({appId:'weather'})`)
  const {nodeId:backId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'#app-back'})
  for(const state of ['hover','active']) {
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:backId,forcedPseudoClasses:[state]})
    await js(`(()=>{const n=document.querySelector('#app-back');getComputedStyle(n).backgroundColor;n.getAnimations().forEach(animation=>animation.finish())})()`)
    const back=await js(`(()=>{const n=document.querySelector('#app-back'),s=getComputedStyle(n),r=n.getBoundingClientRect(),probe=document.createElement('i');probe.style.color=s.getPropertyValue('${state==='active'?'--odk-button':'--odk-stroke-focus'}');document.body.append(probe);const expected=getComputedStyle(probe).color;probe.style.color=s.getPropertyValue('--odk-stroke-focus');const focusedEdge=getComputedStyle(probe).color;probe.remove();return {visible:r.width>0&&r.height>0&&n.offsetWidth>=44&&n.offsetHeight>=44,edge:s.borderTopColor,fill:s.backgroundColor,material:s.backgroundImage,expected,focusedEdge,fine:matchMedia('(hover: hover) and (pointer: fine)').matches}})()`)
    report.push({appReturnState:state,...back})
    check('App return '+state+' retains shared glass feedback',back.visible&&back.material!=='none'&&(state==='active'?back.fill===back.expected&&back.edge===back.focusedEdge:!back.fine||back.edge===back.expected))
  }
  await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:backId,forcedPseudoClasses:[]})
  await js(`odkAppPlatform.closeApp()`)
  const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'.agent-mic'})
  await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]})
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0})
  await js(`polishUntil(()=>!document.querySelector('.agent-mic').matches(':hover'))`)
  const pointer=await js(`(()=>{
    const n=document.querySelector('.agent-mic'),s=getComputedStyle(n),probe=document.createElement('i');
    probe.style.color=s.getPropertyValue('--odk-stroke-focus');document.body.append(probe);
    const result={hover:matchMedia('(hover: hover)').matches,fine:matchMedia('(pointer: fine)').matches,coarse:matchMedia('(pointer: coarse)').matches,hovered:n.matches(':hover'),edge:s.borderTopColor,focus:getComputedStyle(probe).color};
    probe.remove();return result;
  })()`)
  const normal=pointer.edge
  report.push({pointer})
  for (const state of ['hover','active','focus-visible']) {
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[state]})
    const result=await js(`(()=>{const s=getComputedStyle(document.querySelector('.agent-mic'));return {edge:s.borderTopColor,outline:s.outlineStyle,frame:getComputedStyle(document.querySelector('.agent-composer')).borderTopWidth}})()`)
    const expectedEdge=state==='hover'&&!(pointer.hover&&pointer.fine)?normal:pointer.focus
    check('voice '+state+' matches pointer capabilities',state==='focus-visible'?result.outline==='solid':result.frame==='1px')
  }
  await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']})
  win.webContents.send('odk-personal-agent-status',{state:'recording'})
  await js(`polishUntil(()=>!document.querySelector('.agent-cancel').hidden)`)
  check('recording has cancel, a measured meter, and the fixed Send',await js(`document.querySelector('.agent-mic').hidden&&!document.querySelector('.agent-recording-feedback').hidden&&document.querySelector('.agent-send').getAttribute('aria-label')==='Send voice request'`))
  await capture('glass-recording')
  await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]})
  win.webContents.send('odk-personal-agent-status',{state:'thinking'})
  await js(`polishUntil(()=>document.querySelector('.agent-mic').disabled)`)
  check('busy voice retains the shared composer material',await js(`(()=>{const s=getComputedStyle(document.querySelector('.agent-composer'));return s.borderTopWidth==='1px'&&(s.backgroundImage!=='none'||document.querySelector('.agent-composer').classList.contains('lg-surface'))})()`))
  check('busy voice is disabled while thinking',await js(`document.querySelector('.agent-mic').disabled&&document.querySelector('.agent-state').textContent==='Thinking...'`))
  win.webContents.send('odk-personal-agent-status',{state:'idle'})
  await js(`polishUntil(()=>!document.querySelector('.agent-mic').disabled)`)
  await js(`odkAppPlatform.openApp({appId:'app-manager'})`)
  check('invalid field retains its red semantic edge',await js(`(()=>{const n=document.querySelector('#app-search');n.setAttribute('aria-invalid','true');void getComputedStyle(n).borderTopColor;for(const a of n.getAnimations())if(a instanceof CSSTransition)a.finish();const s=getComputedStyle(n),probe=document.createElement('i');probe.style.color=s.getPropertyValue('--odk-accent-red');document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();const result=s.borderTopColor===expected&&s.backgroundImage!=='none';n.removeAttribute('aria-invalid');return result})()`))
  await js(`odkAppPlatform.closeApp()`)
  for (const feature of ['prefers-reduced-transparency','prefers-contrast','forced-colors']) {
    const value=feature==='prefers-contrast'?'more':feature==='forced-colors'?'active':'reduce'
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:feature,value}]})
    await js(`polishUntil(()=>matchMedia('(${feature}: ${value})').matches&&document.documentElement.dataset.liquidGlass==='fallback')`)
    const readable=await js(`(()=>{return [...document.querySelectorAll('.agent-composer,.agent-composer button,.agent-identity .agent-capsule')].filter(n=>n.getClientRects().length).every(n=>{const s=getComputedStyle(n);return s.backdropFilter==='none'&&s.boxShadow==='none'&&s.backgroundImage==='none'&&(n.matches('.agent-composer button')||s.borderTopWidth==='1px'&&s.backgroundColor!=='rgba(0, 0, 0, 0)')})})()`)
    check(feature+': controls have opaque accessible frames',readable)
    await capture('glass-'+feature)
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]})
  fs.writeFileSync(path.join(evidence,'glass-controls.json'),JSON.stringify({report,failures,webGpuFixture:process.argv.includes('--static-glass-fixture')?'unavailable':'native'},null,2))
  console.log('GLASS_CONTROLS_EVIDENCE '+evidence)
  assert.deepEqual(failures,[])
  console.log('GLASS_CONTROLS_PASS')
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, done) => done(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_r, done) => done({ cancel: true }))
  installHomePreviewFixtures(ipcMain)
  const endpoint = createAppManagerEndpoint()
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
  ipcMain.removeHandler('odk-futu-holdings')
  ipcMain.handle('odk-futu-holdings', () => ({ state: 'live', updatedAt: Date.now(), snapshot: {
    totals: { plRatio: 0.0123 }, positions: Array.from({ length: 24 }, (_, i) => ({ code: `US.HOLD${i + 1}`, price: 1234.56, dayRatio: -0.0123 })),
  } }))
  win = new BrowserWindow({ width: 1280, height: 800, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  await js('window.odkShellReady')
  await js(`window.polishUntil=async f=>{const end=performance.now()+4000;while(!f()){if(performance.now()>end)throw Error('Readiness: '+f);await new Promise(r=>setTimeout(r,20))}};void 0`)
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (process.argv.includes('--glass-controls-only')) {
    if(process.argv.includes('--static-glass-fixture')) await js(`Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});void 0`)
    await glassControls()
    await js("odkTheme.set('instrument')")
    finish(0)
    return
  }
  check('composer opens on the voice field', await js(`(()=>{const box=document.querySelector('.agent-composer');return box.dataset.mode==='voice'&&document.querySelector('.agent-composer textarea').hidden&&!document.querySelector('.agent-keys').hidden&&document.querySelector('.agent-composer .agent-mic-label').textContent==='Tap to talk'})()`))
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    for (const [width, height] of [[1280, 800], [480, 854], [320, 480]]) {
      const where = `${theme}-${width}`
      win.setContentSize(width, height)
      await js(`(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));await polishUntil(()=>innerWidth===${width}&&innerHeight===${height});await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelector('.agent-composer .agent-mic').focus()})()`)
      check(where + ': microphone control keeps its own focus ring', await js(`(()=>{const field=document.querySelector('.agent-composer .agent-mic'),s=getComputedStyle(field);return field.matches(':focus-visible')&&s.outlineStyle==='solid'&&s.outlineWidth==='2px'})()`))
      await js(`(async()=>{const box=document.querySelector('.agent-composer');if(box.dataset.mode==='voice')document.querySelector('.agent-keys').click();await polishUntil(()=>box.dataset.mode==='keyboard');document.querySelector('.agent-composer textarea').focus()})()`)
      const identity = await js(`(()=>{const name=document.querySelector('.agent-name'),pill=document.querySelector('.agent-identity .agent-capsule');return {height:pill.getBoundingClientRect().height,nameHeight:name.getBoundingClientRect().height,nameLine:parseFloat(getComputedStyle(name).lineHeight),nameWhole:name.scrollWidth<=name.clientWidth+1}})()`)
      check(where + ': default name is whole on one line', identity.nameHeight <= identity.nameLine + 1 && identity.nameWhole)
      check(where + ': identity capsule keeps control height', identity.height >= 44 && identity.height <= 84)
      const focus = await js(`(()=>{const input=document.querySelector('.agent-composer textarea'),box=input.closest('form'),s=getComputedStyle(box),t=getComputedStyle(input);return {focused:input.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor,radius:s.borderTopLeftRadius,inputOutline:t.outlineStyle}})()`)
      check(where + ': outer composer focus follows theme shape', focus.focused && focus.outline === 'solid' && focus.width === '2px' && (theme === 'pixel' ? focus.radius === '0px' : parseFloat(focus.radius) >= 32))
      check(where + ': no rectangular input outline', focus.inputOutline === 'none')
      if (theme === 'instrument' && width === 1280) await capture('composer-focused')
      for (const button of ['.agent-mic', '.agent-send']) {
        check(where + ': button focus ' + button, await js(`(()=>{const n=document.querySelector('${button}');n.focus();return n.disabled||getComputedStyle(n).outlineStyle==='solid'})()`))
      }
      await js(`(async()=>{document.querySelector('[data-widget="odk.tile.futu"] .widget-launch').click();await polishUntil(()=>odkAppPlatform.active()?.appId==='futu');await polishUntil(()=>document.querySelectorAll('#app-runtime .futu-holding').length===24);document.getElementById('app-view').scrollIntoView({block:'center'});await document.fonts.ready})()`)
      const idle = await js(`(()=>{const list=document.querySelector('#app-runtime .futu-holdings'),head=document.querySelector('#app-runtime .futu-columns'),row=list.firstElementChild;window.polishList=list;const thumb=getComputedStyle(list,'::-webkit-scrollbar-thumb'),button=getComputedStyle(list,'::-webkit-scrollbar-button'),s=getComputedStyle(list);return {overflow:list.scrollHeight>list.clientHeight,thumb:thumb.backgroundColor,button:button.display,gutter:s.scrollbarGutter,padding:parseFloat(s.paddingInlineEnd),columnsAligned:Math.abs(head.lastElementChild.getBoundingClientRect().right-row.lastElementChild.getBoundingClientRect().right)<1,rightSafe:list.getBoundingClientRect().right-row.lastElementChild.getBoundingClientRect().right>=12,scrollWidth:list.scrollWidth,clientWidth:list.clientWidth}})()`)
      check(where + ': idle transparent thumb', idle.thumb === 'rgba(0, 0, 0, 0)')
      check(where + ': arrows removed', idle.button === 'none')
      check(where + ': reserved safe space and alignment', idle.overflow && idle.gutter === 'stable' && idle.padding >= 8 && idle.columnsAligned && idle.rightSafe && idle.scrollWidth <= idle.clientWidth + 1)
      if (theme === 'instrument' && width === 1280) await capture('futu-idle')
      await js(`polishList.focus()`)
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
      await js(`polishUntil(()=>polishList.scrollTop>0)`)
      const scrolling = await js(`(()=>{const s=getComputedStyle(polishList,'::-webkit-scrollbar-thumb');return {active:polishList.dataset.scrolling,thumb:s.backgroundColor,radius:s.borderTopLeftRadius}})()`)
      check(where + ': keyboard reveals theme-shaped thumb', scrolling.active === 'true' && scrolling.thumb !== 'rgba(0, 0, 0, 0)' && (theme === 'pixel' ? scrolling.radius === '0px' : parseFloat(scrolling.radius) > 0))
      if (theme === 'instrument' && width === 1280) await capture('futu-scrolling')
      // A missing implementation must still report the remaining RED cases.
      if (scrolling.active === 'true') await js(`polishUntil(()=>!polishList.hasAttribute('data-scrolling'))`)
      check(where + ': thumb hides without moving columns', await js(`getComputedStyle(polishList,'::-webkit-scrollbar-thumb').backgroundColor==='rgba(0, 0, 0, 0)'&&polishList.clientWidth===${idle.clientWidth}`))
      const wheel = await js(`(()=>{const r=polishList.getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2,before:polishList.scrollTop}})()`)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheel.x, y: wheel.y, deltaX: 0, deltaY: 40 })
      await js(`polishUntil(()=>polishList.scrollTop>${wheel.before})`)
      check(where + ': wheel reveals thumb', await js(`polishList.dataset.scrolling==='true'`))
      await js(`(async()=>{const handle=document.querySelector('#dots .dot.active');handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));await polishUntil(()=>!odkAppPlatform.active())})()`)
      check(where + ': release clears scroll state and listener', await js(`(()=>{polishList.dispatchEvent(new Event('scroll'));return !polishList.hasAttribute('data-scrolling')})()`))
      const longName = '长名字 Personal Agent '.repeat(3).slice(0, 40)
      await js(personalAgentIdentityScript(longName))
      win.webContents.send('odk-personal-agent-status', { state: 'idle', proposalError: 'Provider response unavailable. '.repeat(30) })
      await js(`polishUntil(()=>document.querySelector('.agent-state').textContent==='Suggestions unavailable')`)
      const longIdentity = await js(`(()=>{const pill=document.querySelector('.agent-identity .agent-capsule'),panel=document.querySelector('.agent-panel'),r=pill.getBoundingClientRect(),p=panel.getBoundingClientRect();return {height:r.height,contained:r.left>=p.left&&r.right<=p.right,below:pill.querySelector('.agent-state').getBoundingClientRect().top>=pill.querySelector('.agent-name').getBoundingClientRect().bottom,oneLine:[...pill.querySelectorAll('.agent-name,.agent-state')].every(n=>n.getBoundingClientRect().height<=parseFloat(getComputedStyle(n).lineHeight)+1),accessible:pill.getAttribute('aria-label').includes(${JSON.stringify(longName)})&&pill.getAttribute('aria-label').includes('Suggestions unavailable')}})()`)
      check(where + ': long identity stays compact and accessible', longIdentity.height >= 44 && longIdentity.height <= 84 && longIdentity.contained && longIdentity.below && longIdentity.oneLine && longIdentity.accessible)
      await js(personalAgentIdentityScript('Personal Agent'))
      win.webContents.send('odk-personal-agent-status', { state: 'idle', jev: {status:'verified'} })
      await js(`polishUntil(()=>document.querySelector('.agent-state').hidden&&document.querySelector('.agent-state').textContent==='')`)
      const restingHistoryTop = await js(`document.querySelector('.agent-conversation').getBoundingClientRect().top`)
      win.webContents.send('odk-personal-agent-status', { state: 'thinking', jev: {status:'verified'} })
      await js(`polishUntil(()=>!document.querySelector('.agent-state').hidden&&document.querySelector('.agent-state').textContent==='Thinking...')`)
      check(where + ': thinking keeps conversation position', await js(`Math.abs(document.querySelector('.agent-conversation').getBoundingClientRect().top-(${restingHistoryTop}))<1`))
      win.webContents.send('odk-personal-agent-status', { state: 'idle', jev: {status:'verified'} })
      await js(`polishUntil(()=>document.querySelector('.agent-state').hidden)`)

      report.push({ theme, width, height, identity, longIdentity, focus, idle, scrolling })
    }
  }
  await glassControls()
  await js("odkTheme.set('instrument')")
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ report, failures }, null, 2))
  console.log('INPUT_SCROLL_EVIDENCE ' + evidence)
  assert.deepEqual(failures, [])
  console.log('INPUT_SCROLL_POLISH_PASS: 4 themes x 3 sizes; capsule focus, native keyboard/wheel scroll, auto-hide, safe gutter, cleanup')
  finish(0)
}).catch(error => finish(1, error))
