'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const {
  installHomePreviewFixtures,
} = require('./helpers/home-preview-fixtures')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), 'odk-app-gallery-profile-'),
)
const evidence = fs.mkdtempSync(
  path.join(os.tmpdir(), 'odk-app-gallery-evidence-'),
)
app.setPath('userData', profile)
let win
const timer = setTimeout(() => finish(1, Error('App gallery timed out')), 90000)
function finish(code, error) {
  clearTimeout(timer)
  if (error) console.error(error)
  win?.destroy()
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {}
  app.exit(code)
}
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_w, _p, done) =>
      done(false),
    )
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_r, done) => done({ cancel: true }),
    )
    installHomePreviewFixtures(ipcMain)
    const sourceState =
      process.argv.find((arg) => arg.startsWith('--state='))?.split('=')[1] ||
      'live'
    const stress = process.argv.includes('--stress')
    const zoom = process.argv.includes('--zoom') ? 2 : 1
    const replace = (channel, value) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => value)
    }
    if (sourceState !== 'live') {
      replace('odk-weather-status', {
        status: sourceState,
        current: null,
        daily: null,
      })
      replace('odk-weread-highlight', { status: sourceState, highlight: null })
      replace('odk-hydra-status', {
        configured: sourceState !== 'unconfigured',
        connected: false,
        nodes: [],
        env: null,
      })
      replace('odk-futu-holdings', { state: sourceState })
    }
    if (stress) {
      replace('odk-weather-status', {
        status: 'live',
        place: '臺北市大安區 / Würzburg am Main',
        current: {
          temperature: -123.45,
          unit: '°C',
          condition: 'Long weather condition / 持續雷雨與強陣風',
        },
        daily: { low: -123.45, high: 123.45 },
      })
      replace('odk-weread-highlight', {
        status: 'live',
        highlight: {
          markText:
            '把每一次微小的改變累積起來。 Keep each meaningful detail readable. '.repeat(
              30,
            ),
          title: 'A very long book title / 習慣的力量與微小改變'.repeat(4),
          author: 'Author / 作者'.repeat(8),
        },
      })
    }
    const endpoint = createAppManagerEndpoint()
    ipcMain.handle('odk-app-manager-intent', (_event, intent) =>
      endpoint.dispatch(intent),
    )
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      useContentSize: true,
      webPreferences: {
        preload: path.join(__dirname, '../src/preload.js'),
        sandbox: true,
        contextIsolation: true,
        offscreen: true,
        backgroundThrottling: false,
      },
    })
    const js = (s) => win.webContents.executeJavaScript(s)
    // Offscreen capturePage can return the previous compositor surface. Stamp
    // this document, observe its paint, then capture the paint after removal.
    const markerColor = [237, 19, 181, 255]
    const isMarker = (frame) => {
      const pixel = frame.crop({ x: 0, y: 0, width: 1, height: 1 }).toBitmap()
      return markerColor.every((channel, index) => pixel[index] === channel)
    }
    const paint = (marked, change) =>
      new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(deadline)
          win.webContents.off('paint', observe)
        }
        const observe = (_event, _dirty, frame) => {
          if (isMarker(frame) !== marked) return
          cleanup()
          resolve(frame)
        }
        const deadline = setTimeout(() => {
          cleanup()
          reject(Error('Document paint did not settle'))
        }, 5000)
        win.webContents.on('paint', observe)
        js(change)
          .then(() => win.webContents.invalidate())
          .catch((error) => {
            cleanup()
            reject(error)
          })
      })
    const paintedFrame = async () => {
      try {
        await paint(
          true,
          `(()=>{const marker=document.createElement('div');marker.id='gallery-frame-marker';marker.style.cssText='position:fixed;top:0;left:0;width:2px;height:2px;z-index:2147483647;background:rgb(181,19,237);pointer-events:none';document.body.append(marker)})()`,
        )
        const frame = await paint(
          false,
          `document.getElementById('gallery-frame-marker').remove()`,
        )
        assert.equal(
          await js(`!!document.getElementById('gallery-frame-marker')`),
          false,
        )
        return frame
      } finally {
        await js(`document.getElementById('gallery-frame-marker')?.remove()`)
      }
    }
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
    await js('window.odkShellReady')
    win.webContents.setZoomFactor(zoom)
    await js(
      `window.galleryUntil=async f=>{const end=performance.now()+5000;while(!f()){if(performance.now()>end)throw Error('Gallery readiness: '+f);await new Promise(r=>setTimeout(r,20))}};void 0`,
    )
    const report = []
    const failures = []
    const customSize = process.argv
      .find((arg) => arg.startsWith('--size='))
      ?.slice(7)
      .split(',')
      .map(Number)
    const widths = customSize
      ? [customSize]
      : process.argv.includes('--single')
        ? [[1280, 800]]
        : process.argv.includes('--compact')
          ? [
              [960, 640],
              [480, 854],
              [320, 480],
            ]
          : [
              [1280, 800],
              [1920, 1280],
            ]
    const themes = process.argv.includes('--all-themes')
      ? ['instrument', 'pixel', 'border-beam', 'liquid-glass']
      : ['instrument', 'liquid-glass']
    for (const [width, height] of widths) {
      win.setContentSize(width, height)
      for (const theme of themes) {
        await js(
          `(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));await galleryUntil(()=>__odkGrid.width===innerWidth&&__odkGrid.height===innerHeight);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`,
        )
        const widgets = await js(
          `[...document.querySelectorAll('#pages-track .widget')].map(n=>({id:n.dataset.widget,appId:n.dataset.openApp,page:n.closest('[data-page-id]').dataset.pageId}))`,
        )
        assert.deepEqual(widgets.map(widget => widget.id).sort(), [
          'odk.tile.futu', 'odk.tile.hydra', 'odk.tile.pi-sessions',
          'odk.tile.pomodoro', 'odk.tile.quota', 'odk.tile.weather',
          'odk.tile.weread', 'odk.tile.year',
        ].sort())
        for (const widget of widgets) {
          await js(
            `(async()=>{const page=document.querySelector('[data-page-id="${widget.page}"]'),pages=[...document.querySelectorAll('#pages-track>.page')];document.querySelectorAll('.dot')[pages.indexOf(page)].click();document.querySelector('[data-widget="${widget.id}"] .widget-launch').click();await galleryUntil(()=>odkAppPlatform.active()?.sourceWidget==='${widget.id}'&&!document.getElementById('app-view').hidden);await galleryUntil(()=>!document.querySelector('#app-runtime .reading-refresh:disabled, .weread-app[aria-busy="true"]'));await document.fonts.ready;document.getElementById('app-view').scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`,
          )
          const state = await js(
            `(()=>{const card=document.getElementById('app-view'),r=card.getBoundingClientRect(),root=document.querySelector('#app-runtime > *');return {bounds:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},text:root?.innerText,vertical:(()=>{const q=document.querySelector('#app-view .runtime-app');const r=q.getBoundingClientRect();return {root:[r.y,r.bottom],card:[card.getBoundingClientRect().y,card.getBoundingClientRect().bottom],client:q.clientHeight,scroll:q.scrollHeight,last:q.lastElementChild?.getBoundingClientRect().toJSON(),body:[document.querySelector('.app-body').clientHeight,document.querySelector('.app-body').scrollHeight]}})(),controls:[...root.querySelectorAll('button,input,select,summary')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {name:n.getAttribute('aria-label')||n.textContent.trim(),width:r.width,height:r.height,font:parseFloat(s.fontSize)}}),overflow:root.scrollWidth>root.clientWidth+1,header:document.querySelector('#app-view>.app-header').getBoundingClientRect().height}})()`,
          )
          if (process.argv.includes('--verify')) {
            const checks = await js(`(()=>{
      const frame=document.getElementById('app-view').getBoundingClientRect(),root=document.querySelector('#app-view .runtime-app'),r=root.getBoundingClientRect(),s=getComputedStyle(root),app='${widget.appId}';
      const result={inset:r.left+parseFloat(s.paddingLeft)-frame.left<=33,header:document.querySelector('#app-view>.app-header').getBoundingClientRect().height===0,handle:frame.bottom<=document.querySelector('#dots .dot.active').getBoundingClientRect().top};
      if(app==='pi-sessions'){result.detailHidden=getComputedStyle(document.querySelector('#app-view .pi-detail')).visibility==='hidden';const main=document.querySelector('#app-view .pi-main').getBoundingClientRect();result.height=main.height>=frame.height*.55;if(innerWidth>=1280)result.filters=document.querySelector('#app-view .pi-overview-filters').getBoundingClientRect().height<=62;}
      if(app==='pomodoro')result.hasTimer=!!root.querySelector('.pomodoro-dial')&&!!root.querySelector('button');
      if(app==='year')result.progress=!!root.querySelector('progress');
      if(app==='weather')result.hero=!!root.querySelector('.weather-reading');
      if(app==='hydra')result.plants=!!root.querySelector('.plant-readings');
      if(app==='weread'){const q=root.querySelector('blockquote'),source=document.querySelector('.widget.w-weread .weread-text');const leading=n=>{const s=getComputedStyle(n);return parseFloat(s.lineHeight)/parseFloat(s.fontSize)};result.reading=${JSON.stringify(sourceState)}==='live'?!!q&&leading(q)>=1.34&&Math.abs(leading(q)-leading(source))<0.02:root.querySelector('.reading-status').textContent.length>0;}
      if(app==='futu')result.returnLabel=root.querySelector('.reading-head h2')?.textContent==='Daily return';
      if(app==='quota')result.hasQuota=!!root.querySelector('.quota-card');
      return result;
     })()`)
            for (const [name, ok] of Object.entries(checks))
              if (!ok)
                failures.push(
                  theme + ' ' + width + ' ' + widget.appId + ': ' + name,
                )
          }
          const name = `${theme}-${width}-${widget.appId}`
          const bounds = Object.fromEntries(
            Object.entries(state.bounds).map(([key, value]) => [
              key,
              Math.round(Math.max(0, value) * zoom),
            ]),
          )
          bounds.width = Math.min(bounds.width, width - bounds.x)
          bounds.height = Math.min(bounds.height, height - bounds.y)
          assert(bounds.width > 0 && bounds.height > 0)
          const frame = await paintedFrame()
          fs.writeFileSync(
            path.join(evidence, name + '.png'),
            frame.crop(bounds).toPNG(),
          )
          if (widget.appId === 'futu')
            fs.writeFileSync(
              path.join(evidence, `${theme}-${width}-shell.png`),
              frame.toPNG(),
            )
          if (process.argv.includes('--verify') && state.overflow)
            failures.push(
              theme +
                ' ' +
                width +
                ' ' +
                widget.appId +
                ': horizontal overflow',
            )
          report.push({
            widget: widget.id,
            app: widget.appId,
            theme,
            width,
            height,
            zoom,
            sourceState,
            stress,
            paintVerified: true,
            fixtureControlsRestored: true,
            ...state,
            file: name + '.png',
          })
          await js('odkAppPlatform.closeApp()')
        }
      }
    }
    fs.writeFileSync(
      path.join(evidence, 'report.json'),
      JSON.stringify(
        { synthetic: true, liveProviders: false, runs: report },
        null,
        2,
      ),
    )
    assert.deepEqual(failures, [], 'App gallery regressions')
    console.log('APP_GALLERY_PASS ' + evidence)
    finish(0)
  })
  .catch((error) => finish(1, error))
