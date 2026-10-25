'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')
if (process.platform === 'darwin') app.dock.hide()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-status-style-'))
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-status-evidence-'))
app.setPath('userData', profile)
let win
const deadline = setTimeout(() => finish(1, Error('State Bar style timed out')), 60000)
function finish(code, error) {
  clearTimeout(deadline)
  if (error) console.error(error)
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
function capturePaintedFrame() {
  return new Promise((resolve, reject) => {
    const [width, height] = win.getContentSize()
    const contents = win.webContents
    const cleanup = () => { clearTimeout(timer); contents.removeListener('paint', painted) }
    const painted = (_event, _dirty, frame) => {
      const size = frame.getSize()
      if (frame.isEmpty() || size.width !== width || size.height !== height) return
      cleanup()
      resolve(frame.toPNG())
    }
    const timer = setTimeout(() => { cleanup(); reject(Error('State Bar frame did not paint')) }, 5000)
    contents.on('paint', painted)
    contents.invalidate()
  })
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  installHomePreviewFixtures(ipcMain)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true } })
  const js = expression => win.webContents.executeJavaScript(expression)
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  await js('window.odkShellReady')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    for (const [width, height] of [[1920, 1280], [960, 640], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      await js(`(async () => {
        await odkTheme.set('${theme}');
        const deadline=performance.now()+5000;
        window.dispatchEvent(new Event('resize'));
        while(innerWidth!==${width} || innerHeight!==${height} || window.__odkGrid.width!==${width} || window.__odkGrid.height!==${height}
          || [...document.querySelectorAll('link[rel=stylesheet]')].some(link=>!link.sheet)) {
          if(performance.now()>deadline) throw Error('Theme stylesheet did not load');
          await new Promise(resolve=>requestAnimationFrame(resolve));
        }
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`)
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
      const state = await js(`(() => {
        const bar = document.getElementById('status-bar');
        const rect = bar.getBoundingClientRect();
        const material = getComputedStyle(bar);
        const frost = getComputedStyle(bar,'::before');
        const tint = material.backgroundColor;
        const tintAlpha = tint.includes('/') ? parseFloat(tint.split('/').at(-1))
          : tint.startsWith('rgba(') ? parseFloat(tint.split(',').at(-1)) : 1;
        const pi = document.getElementById('sb-pi-status');
        pi.focus({preventScroll:true});
        const piRect=pi.getBoundingClientRect();
        const agentRect=document.getElementById('personal-agent').getBoundingClientRect();
        const deskRect=document.getElementById('desk-content').getBoundingClientRect();
        const widget=document.querySelector('.widget');
        const devices = bar.querySelector('button[aria-label="Open Devices"]');
        const devicesRect = devices.getBoundingClientRect();
        const controls = [...bar.querySelectorAll('#sb-pad, .sb-devices, #sb-pi-status, #sb-net, .sb-time')].filter(node=>node.getClientRects().length);
        return { viewport:[innerWidth,innerHeight,devicePixelRatio], theme:document.documentElement.dataset.theme, barBottom:rect.bottom,
          material: {
            borders:[material.borderTopWidth,material.borderRightWidth,material.borderBottomWidth,material.borderLeftWidth],
            radius:material.borderTopLeftRadius,background:material.backgroundImage,shadow:material.boxShadow,
            blur:material.backdropFilter,tintAlpha},
          frost: {content:frost.content,blur:frost.backdropFilter,mask:frost.maskImage,
            insets:[frost.top,frost.right,frost.bottom,frost.left],
            border:frost.borderTopWidth,radius:frost.borderTopLeftRadius,shadow:frost.boxShadow,pointer:frost.pointerEvents},
          widgetFill:getComputedStyle(document.querySelector('.widget')).backgroundImage,
          sdk:document.documentElement.dataset.liquidGlass==='sdk'&&widget.classList.contains('lg-surface'),
          sharedMaterial:getComputedStyle(bar).getPropertyValue('--odk-glass-material').trim(),
          panesCorrect:innerWidth>=640?Math.abs(agentRect.left)<1&&Math.abs(deskRect.left-agentRect.right)<1&&Math.abs(deskRect.top-agentRect.top)<1:deskRect.top>=agentRect.bottom-1,
          bodyFill:getComputedStyle(document.body).backgroundImage,
          backdropFill:getComputedStyle(document.getElementById('liquid-glass-backdrop')).backgroundImage,
          devicesTarget:devicesRect.width>=44&&devicesRect.height>=44&&devices.contains(document.elementFromPoint(devicesRect.x+devicesRect.width/2,devicesRect.y+devicesRect.height/2)),
          piHeight:piRect.height, focused:document.activeElement===pi,
          hit:pi.contains(document.elementFromPoint(piRect.x+piRect.width/2,piRect.y+piRect.height/2)),
          focusOutline:getComputedStyle(pi).outlineStyle,
          inside:controls.every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=rect.top&&r.bottom<=rect.bottom+1}),
          overlap:controls.some((a,i)=>controls.slice(i+1).some(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1})) };
      })()`)
      assert.deepEqual(state.viewport, [width,height,1])
      assert.equal(state.theme, theme)
      assert.equal(state.devicesTarget, true, 'Devices retains a reachable touch target')
      assert.equal(state.panesCorrect,true,'Backdrop must not displace the Agent or desk pane')
      assert.equal(state.frost.content, '""')
      assert.deepEqual(state.frost.insets, ['0px','0px','0px','0px'], 'The frost covers the full bar without an inset card')
      assert.equal(state.frost.border, '0px')
      assert.equal(state.frost.radius, '0px')
      assert.equal(state.frost.shadow, 'none')
      assert.equal(state.frost.pointer, 'none')
      assert.equal(state.frost.blur, 'blur(24px)')
      assert.notEqual(state.frost.mask, 'none', 'Frost must fade before its lower edge')
      assert.deepEqual(state.material.borders, ['0px','0px','0px','0px'])
      assert.equal(state.material.radius, '0px')
      assert.equal(state.material.shadow, 'none')
      assert.equal(state.material.background, 'none')
      assert.equal(state.material.blur, 'none')
      assert.equal(state.material.tintAlpha, 0, 'The State Bar adds no independent tint to the shared backdrop')
      assert.equal(state.inside, true, `${theme} ${width}: status readings escaped the bar`)
      assert.equal(state.overlap, false, `${theme} ${width}: status readings overlap`)
      assert.equal(state.piHeight, 44)
      assert.equal(state.focused, true)
      assert.equal(state.hit, true, 'The glass surface must not intercept the Pi button')
      assert.notEqual(state.focusOutline, 'none')
      if (theme === 'liquid-glass') {
        assert.notEqual(state.sharedMaterial,'')
        assert.equal(state.widgetFill==='none',state.sdk,'Widget fill still belongs to its existing SDK or static material')
        assert.equal(state.bodyFill, state.backdropFill, 'The desk backdrop must continue into the State Bar')
        assert.notEqual(state.bodyFill, 'none')
      }
      await js('document.activeElement.blur()')
      await capturePaintedFrame()
      const frame=await win.webContents.capturePage()
      const bitmap=frame.getSize()
      const backingScale=bitmap.width/width
      assert.ok(backingScale>=1&&backingScale<=2, 'Capture backing scale must be recorded without clipping')
      assert.equal(bitmap.height/height,backingScale)
      if (theme === 'liquid-glass' && width >= 960) {
        const pixels = frame.toBitmap()
        const edge = Math.round(state.barBottom * backingScale)
        const steps = [0.08,0.3,0.7,0.92].map(fraction => {
          const x = Math.round(bitmap.width * fraction)
          const above = ((edge - 1) * bitmap.width + x) * 4
          const below = (edge * bitmap.width + x) * 4
          return Math.max(...[0,1,2].map(channel => Math.abs(pixels[above+channel] - pixels[below+channel])))
        })
        assert.ok(Math.max(...steps) <= 2, `State Bar lower edge must keep a continuous backdrop: ${JSON.stringify(steps)}`)
        console.log(`PASS State Bar pixel continuity ${width}: RGB edge steps=${steps.join(',')}`)
      }
      fs.writeFileSync(path.join(evidence, `${theme}-${width}.png`), frame.toPNG())
      console.log(`PASS ${theme} ${width}: direct frost without a card, contained single row, keyboard focus; viewport=${width}x${height}, backingScale=${backingScale}`)
    }
  }
  for (const feature of [{name:'prefers-reduced-transparency',value:'reduce'}, {name:'forced-colors',value:'active'}]) {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[feature]})
    const fallback = await js(`(() => {const bar=document.getElementById('status-bar');const surface=getComputedStyle(bar);const frost=getComputedStyle(bar,'::before');return {blur:surface.backdropFilter,frostBlur:frost.backdropFilter,frostDisplay:frost.display,fill:surface.backgroundImage,shadow:surface.boxShadow}})()`)
    assert.equal(fallback.blur, 'none')
    assert.equal(fallback.frostBlur, 'none')
    assert.equal(fallback.frostDisplay, 'none')
    assert.equal(fallback.fill, 'none')
    assert.equal(fallback.shadow, 'none')
  }
  console.log('STATUS_BAR_EVIDENCE ' + evidence)
  finish(0)
}).catch(error => finish(1, error))
