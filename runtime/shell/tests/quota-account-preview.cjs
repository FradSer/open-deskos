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
<style>body {display:block;padding:32px;background:var(--odk-bg)} #app {height:calc(100vh - 64px);--grid-w:100%;--grid-h:100%;--odk-app-inset:24px} #widgets {display:none;gap:24px;align-items:start} .preview-tile {width:348px;height:348px;container-type:inline-size;padding:24px;display:flex;flex-direction:column;border:1px solid var(--odk-stroke);border-radius:var(--radius);background:var(--odk-surface)} .preview-note {font-size:14px;color:var(--odk-secondary-strong);margin-bottom:24px} </style>
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
  win.setContentSize(1200,520)
  await win.webContents.executeJavaScript(`
    document.querySelector('#app').hidden=true; document.querySelector('#app').style.display='none';
    document.querySelector('#note').hidden=false; document.querySelector('#widgets').style.display='flex';
    // Mount each captured rotation position through the actual Widget definition.
    for(let index=0;index<3;index++){
      const tile=document.createElement('section');tile.className='preview-tile w-quota';document.querySelector('#widgets').append(tile);
      const accounts=previewState.snapshot.accounts;
      const ordered=accounts;
      const view={...ctx,subscription:{...ctx.subscription,status:()=>({...previewState,snapshot:{accounts:ordered}})}};
      // Force a deterministic initial account, then advance via the shared Tick.
      plugins['odk.tile.quota'].mount(tile,view);
      ticks.at(-1)(new Date(Date.now()+[6000,12000,0][index]));
    }
  `)
  for(const theme of ['pixel','instrument']) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}';document.fonts.ready`)
    await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    const readings=await win.webContents.executeJavaScript(`[...document.querySelectorAll('.preview-tile')].map(el=>({account:el.querySelector('.quota-tile-account').textContent,value:el.querySelector('.quota-tile-value').textContent}))`)
    assert.ok(readings.every(reading=>reading.account.includes('@') && /%$/.test(reading.value)))
    assert.deepEqual(readings.map(reading=>reading.value),['58%','82%','18%'])
    fs.writeFileSync(path.join(output,`widget-${theme}.png`),(await capturePaintedPage(win)).toPNG())
  }
  win.destroy()
  console.log('QUOTA_PREVIEW_PASS '+JSON.stringify({output,synthetic:true,captures:10}))
}).then(()=>{fs.rmSync(temp,{recursive:true,force:true});app.exit(0)},error=>{console.error(error);fs.rmSync(temp,{recursive:true,force:true});app.exit(1)})
