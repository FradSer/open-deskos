'use strict'
// Isolated design preview. All accounts and quota readings are synthetic.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { capturePaintedPage } = require('./helpers/native-page-capture')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-quota-accounts-'))
const output = process.env.ODK_QUOTA_PREVIEW || path.join(temp, 'captures')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(temp, 'profile'))
const renderer = path.resolve(__dirname, '../src/renderer')
const url = file => pathToFileURL(path.join(renderer, file)).href
fs.writeFileSync(path.join(temp, 'preview.html'), `<!doctype html><html><head><meta charset="utf-8">
${['uno.css', 'shell.css', 'card-frame.css', 'plugins/quota-page.css', 'themes/pixel.css', 'themes/border-beam.css', 'themes/liquid-glass.css'].map(file => `<link rel="stylesheet" href="${url(file)}">`).join('')}
<style>body {display:block;padding:32px;background:var(--odk-bg)} #app {height:calc(100vh - 64px);--grid-w:100%;--grid-h:100%;--odk-app-inset:24px} #widgets {display:none;gap:24px;align-items:start} .preview-tile {flex:none;border:1px solid var(--odk-stroke);border-radius:var(--radius);background:var(--odk-surface)} .preview-note {font-size:14px;color:var(--odk-secondary-strong);margin-bottom:24px} </style>
</head><body><div id="note" class="preview-note" hidden>Design preview · example accounts and quotas · rotation at 0s, 6s, 12s</div><main id="app" class="page-app"></main><div id="widgets"></div>
<script>window.plugins={};window.odkPlugins={register(p){window.plugins[p.id]=p}}</script>
<script src="${url('icons/pixelarticons.js')}"></script><script src="${url('core/icons.js')}"></script><script src="${url('plugins/quota-page.js')}"></script></body></html>`)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show:false, width:1920, height:1280, useContentSize:true, webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false, offscreen:true, backgroundThrottling:false} })
  win.webContents.on('console-message', event => console.log(event.message))
  await win.loadFile(path.join(temp, 'preview.html'))
  await win.webContents.executeJavaScript(`
    window.ticks=[]; window.cleanups=[];
    const reset = new Date(Date.now() + 36 * 3600000).toISOString();
    const quota=(label,remainingPct,horizon)=>({label,remainingPct,horizon,resetAt:reset});
    window.previewState={state:'available',snapshot:{accounts:[
      {id:'personal',provider:'codex',account:'fradser@gmail.com',fileName:'codex-personal.json',plan:'Plus',groups:[{title:'Codex limits',quotas:[quota('5 hour limit',86,'short'),quota('Weekly limit',58,'long')]}]},
      {id:'work',provider:'codex',account:'fradser@work.example',fileName:'codex-work.json',plan:'Pro',groups:[{title:'Codex limits',quotas:[quota('5 hour limit',94,'short'),quota('Weekly limit',82,'long')]}]},
      {id:'google',provider:'antigravity',account:'fradser@gmail.com',fileName:'antigravity-personal.json',plan:'Google AI Pro',groups:[{title:'Claude models',quotas:[quota('5 hour limit',64,'short'),quota('Weekly limit',18,'long')]},{title:'Gemini models',quotas:[quota('5 hour limit',92,'short'),quota('Weekly limit',76,'long')]}]}
    ]}};
    window.ctx={trackCleanup(fn){cleanups.push(fn)},onTick(fn){ticks.push(fn)},subscription:{status:()=>window.previewState,lastCheck:()=> 'Updated just now',subscribe(fn){fn(window.previewState);return()=>{}},refresh:async()=>window.previewState}};
    plugins['odk.page.quota'].mount(document.querySelector('#app'),ctx);
    document.fonts.ready;
  `)
  for (const theme of ['pixel', 'instrument', 'border-beam', 'liquid-glass']) {
    for (const [width,height] of [[1920,1280],[480,854]]) {
      win.setContentSize(width,height)
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'; document.fonts.ready;`)
      await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      const geometry = await win.webContents.executeJavaScript(`(() => ({accounts:document.querySelectorAll('.provider-quota-card').length, overflow:[...document.querySelectorAll('.provider-quota-card, .provider-quota-identity')].some(el=>el.scrollWidth>el.clientWidth+2),identity:document.querySelector('.provider-quota-identity').textContent}))()`)
      assert.equal(geometry.accounts,3)
      assert.equal(geometry.overflow,false,`${theme} ${width} account overflow`)
      assert.match(geometry.identity,/Codex.*fradser@gmail.com/s)
      fs.writeFileSync(path.join(output,`app-${theme}-${width}.png`),(await capturePaintedPage(win)).toPNG())
    }
  }
  const widgetResults = []
  const widgetErrors = []
  for (const theme of ['pixel', 'instrument', 'border-beam', 'liquid-glass']) {
    for (const cell of [348, 186]) {
      win.setContentSize(cell * 3 + 112, cell + 160)
      await win.webContents.executeJavaScript(`
        document.documentElement.dataset.theme=${JSON.stringify(theme)};
        document.documentElement.style.setProperty('--cell-dim', '${cell}px');
        document.querySelector('#app').hidden=true; document.querySelector('#app').style.display='none';
        document.querySelector('#note').hidden=false; document.querySelector('#widgets').style.display='flex';
        cleanups.splice(0).forEach(fn=>fn()); ticks.length=0;
        document.querySelector('#widgets').replaceChildren();
        for(let index=0;index<3;index++){
          const tile=document.createElement('section');
          tile.className='preview-tile widget widget-display-only w-quota';
          tile.style.width='${cell}px'; tile.style.height='${cell}px';
          document.querySelector('#widgets').append(tile);
          plugins['odk.tile.quota'].mount(tile,ctx);
          // The actual shared Tick advances the three snapshots from the tightest account.
          ticks.at(-1)(new Date(Date.now()+[6100,12100,0][index]));
        }
        document.fonts.ready;
      `)
      await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      await win.webContents.executeJavaScript(`Promise.all([...document.querySelectorAll('.preview-tile .quota-tile-meter-fill')].flatMap(fill=>fill.getAnimations().filter(animation=>animation.transitionProperty==='width'&&Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished)))`)
      const readings = await win.webContents.executeJavaScript(`(() => {
        const selectors=['.widget-heading','.quota-state','.quota-tile-value','.quota-tile-context','.quota-tile-secondary','.quota-tile-account','.quota-tile-position'];
        return [...document.querySelectorAll('.preview-tile')].map(tile=>{
          const frame=tile.getBoundingClientRect(), style=getComputedStyle(tile);
          const inside=rect=>rect.left>=frame.left+parseFloat(style.paddingLeft)-1 && rect.right<=frame.right-parseFloat(style.paddingRight)+1 && rect.top>=frame.top+parseFloat(style.paddingTop)-1 && rect.bottom<=frame.bottom-parseFloat(style.paddingBottom)+1;
          const nodes=selectors.flatMap(selector=>{
            const node=tile.querySelector(selector);
            if(!node.textContent.trim()) return [];
            const range=document.createRange(); range.selectNodeContents(node);
            const rects=[...range.getClientRects()].filter(rect=>rect.width>0 && rect.height>0);
            const computed=getComputedStyle(node);
            return [{selector,text:node.textContent,fontSize:parseFloat(computed.fontSize),visible:computed.visibility==='visible' && computed.display!=='none' && rects.length>0,contained:rects.length>0 && rects.every(inside)}];
          });
          const meter=tile.querySelector('.quota-tile-meter'), fill=meter.querySelector('.quota-tile-meter-fill');
          const meterBounds=meter.getBoundingClientRect(), fillBounds=fill.getBoundingClientRect();
          const meterStyle=getComputedStyle(meter), fillStyle=getComputedStyle(fill);
          const meterReading={hidden:meter.hidden,role:meter.getAttribute('role'),now:Number(meter.getAttribute('aria-valuenow')),min:meter.getAttribute('aria-valuemin'),max:meter.getAttribute('aria-valuemax'),label:meter.getAttribute('aria-label'),spoken:meter.getAttribute('aria-valuetext'),height:meterBounds.height,width:meterBounds.width,fillHeight:fillBounds.height,fillWidth:fillBounds.width,visible:meterStyle.display!=='none'&&meterStyle.visibility==='visible'&&fillStyle.display!=='none'&&fillStyle.visibility==='visible',contained:inside(meterBounds)&&inside(fillBounds)};
          return {account:tile.querySelector('.quota-tile-account').textContent,value:tile.querySelector('.quota-tile-value').textContent,position:tile.querySelector('.quota-tile-position').textContent,nodes,meter:meterReading};
        });
      })()`)
      const record = { theme, cell, readings }
      widgetResults.push(record)
      try {
        assert.deepEqual(readings.map(reading=>reading.account), ['fradser@gmail.com','fradser@work.example','fradser@gmail.com'])
        assert.deepEqual(readings.map(reading=>reading.value), ['58%','82%','18%'])
        assert.deepEqual(readings.map(reading=>reading.position), ['1 / 3','2 / 3','3 / 3'])
      } catch (error) { widgetErrors.push(`${theme} ${cell}: ${error.message}`) }
      for (const reading of readings) for (const node of reading.nodes) {
        const label = `${theme} ${cell} ${reading.position} ${node.selector}`
        if (!node.visible) widgetErrors.push(`${label} must remain visible`)
        if (node.fontSize < 14) widgetErrors.push(`${label} ${node.fontSize}px must be at least 14px`)
        if (cell === 186 && node.selector === '.quota-tile-value' && node.fontSize !== 40) widgetErrors.push(`${label} compact primary percentage must remain 40px in every theme: ${node.fontSize}px`)
        if (!node.contained) widgetErrors.push(`${label} must fit the Widget content inset without clipping`)
      }
      for(const reading of readings){
        const label=`${theme} ${cell} ${reading.position} meter`,meter=reading.meter;
        if(meter.hidden||!meter.visible)widgetErrors.push(`${label} must remain visible`);
        if(meter.role!=='meter'||meter.min!=='0'||meter.max!=='100'||meter.now!==Number.parseFloat(reading.value)||meter.label!==reading.nodes.find(node=>node.selector==='.quota-tile-context').text||meter.spoken!==reading.value+' remaining')widgetErrors.push(`${label} accessible reading must match its percentage`);
        if(Math.abs(meter.height-6)>0.5||Math.abs(meter.fillHeight-6)>0.5)widgetErrors.push(`${label} track and fill must retain 6px height: ${meter.height}/${meter.fillHeight}`);
        if(!meter.contained)widgetErrors.push(`${label} must remain inside the Widget content inset`);
        if(meter.width<=0||Math.abs(meter.fillWidth-meter.width*meter.now/100)>1)widgetErrors.push(`${label} fill width must represent its percentage`);
      }
      fs.writeFileSync(path.join(output,`widget-${theme}-${cell}.png`),(await capturePaintedPage(win)).toPNG())
    }
  }
  const visibilityChecks = await win.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('#widgets');
    const results = [];
    for (const state of ['offscreen', 'hidden', 'inert', 'aria-hidden']) {
      cleanups.splice(0).forEach(fn=>fn()); ticks.length=0; host.replaceChildren();
      const tile = document.createElement('section');
      tile.className='preview-tile widget widget-display-only w-quota';
      tile.style.width='186px'; tile.style.height='186px'; host.append(tile);
      plugins['odk.tile.quota'].mount(tile,ctx);
      const start=Date.now();
      const account=()=>tile.querySelector('.quota-tile-account').textContent;
      const position=()=>tile.querySelector('.quota-tile-position').textContent;
      ticks.at(-1)(new Date(start+3000));
      const before=position();
      if(state==='offscreen') tile.style.transform='translateX(3000px)';
      else host.setAttribute(state, state==='aria-hidden' ? 'true' : '');
      ticks.at(-1)(new Date(start+9000)); ticks.at(-1)(new Date(start+12000));
      const paused=position();
      tile.style.transform=''; host.removeAttribute(state);
      ticks.at(-1)(new Date(start+15000));
      results.push({state,before,paused,resumed:position(),account:account()});
    }
    return results;
  })()`)
  for (const check of visibilityChecks) {
    assert.equal(check.before, '3 / 3', check.state)
    assert.equal(check.paused, check.before, check.state + ' consumes no visible time')
    assert.equal(check.resumed, '1 / 3', check.state + ' resumes accumulated visible time')
    assert.equal(check.account, 'fradser@gmail.com', check.state)
  }
  fs.writeFileSync(path.join(output,'widget-geometry.json'),JSON.stringify({synthetic:true,results:widgetResults,visibilityChecks,errors:widgetErrors},null,2))
  assert.deepEqual(widgetErrors, [], 'All account readings must remain readable and contained')
  win.destroy()
  console.log('QUOTA_PREVIEW_PASS '+JSON.stringify({output,synthetic:true,captures:16}))
}).then(()=>{fs.rmSync(temp,{recursive:true,force:true});app.exit(0)},error=>{console.error(error);fs.rmSync(temp,{recursive:true,force:true});app.exit(1)})
