'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const mode = process.env.ODK_PI_TILE_MODE || 'programmatic'
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const profile = process.env.ODK_PI_TILE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile); app.setPath('sessionData', profile)
if (process.platform === 'linux') app.disableHardwareAcceleration()
if (process.platform === 'darwin') app.dock.hide()
let win, host, finishing, rendererReady = false, response, rejectScan = false, comparisons = 0
const deadline = setTimeout(() => { void finish(1, Error('Pi Widget acceptance timed out')) }, 30000)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(deadline); if (error) console.error(error)
  finishing = (async () => {
    try { if (rendererReady && win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
    finally { win?.destroy(); await host?.stop() }
  })().then(() => code ? app.exit(code) : app.quit(), error => { console.error(error); app.exit(1) })
  return finishing
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_win, _permission, done) => done(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }))
  installGeometryFixtures(ipcMain)
  ipcMain.removeHandler('odk-pi-sessions')
  ipcMain.handle('odk-pi-sessions', () => { if (rejectScan) throw Error('Controlled scan rejection'); return response })
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true,
  } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  ipcMain.removeHandler('odk-renderer-development-plugins')
  const entries = mode === 'development' ? loadDevelopmentPlugins(readConfig(resolveConfigPath(process.env)), { host: 'electron-renderer' }) : []
  assert.equal(entries.length, mode === 'development' ? 1 : 0)
  host = createPluginHost({ capabilities: { 'system.renderer-development': {
    ipc: ipcMain, frames: () => [win.webContents], entries: () => entries,
  } } })
  host.register(createRendererDevelopmentPlugin())
  await host.start()
  await win.loadURL('about:blank'); win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
    window.piTileTicks=new Set();let services;Object.defineProperty(window,'odkServices',{configurable:true,get(){return services},set(value){
      services=value;const subscribe=value.onTick;value.onTick=callback=>{const cancel=subscribe(callback);piTileTicks.add(callback);return()=>{piTileTicks.delete(callback);cancel()}};
    }});
  })()` })
  response = { ok: true, sessions: [], summary: { running: 0, workspacesCount: 0 } }
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const js = source => win.webContents.executeJavaScript(source)
  const wait = condition => js(`(async()=>{const until=performance.now()+3000;while(!(${condition})){if(performance.now()>until)throw Error('Pi Widget did not settle');await new Promise(resolve=>setTimeout(resolve,10))}await document.fonts.ready})()`)
  await js('odkShellReady')
  rendererReady = true
  assert.equal(await js('piTileTicks.size>0'), true)
  await js(`(()=>{window.piTileDocument=document;window.piTilePeer=document.querySelector('[data-widget="odk.tile.year"]');
    window.piTileElement=document.querySelector('[data-widget="odk.tile.pi-sessions"]')})()`)
  if (mode === 'development') {
    assert.equal(await js("odkPlugins.get('odk.tile.pi-sessions').manifest.version"), '2.0.0')
    assert.equal(await js('piTileEntryExecutions'), 1, 'Linked browser entry did not execute exactly once')
    assert.equal(await js('piTileEntryMounts'), 1, 'Linked implementation did not mount at startup')
    assert.equal(await js("odkPlugins.isActive(odkPlugins.get('odk.tile.pi-sessions'),piTileElement)"), true)
    await wait("piTileElement.querySelector('.pi-widget-count').textContent==='0'&&piTileElement.querySelector('.pi-widget-tag-label').textContent==='IDLE'")
    await js("void(window.piTileReplacement=odkPlugins.get('odk.tile.pi-sessions'))")
    await js("odkRendererRuntime.restoreDefault('odk.tile.pi-sessions')")
  } else {
    let fixture = fs.readFileSync(path.join(__dirname, 'fixtures/pi-tile-surface-replacement/entry.js'), 'utf8')
    if (process.env.ODK_PI_TILE_INVALID) fixture = fixture.replace("count.textContent = String(running)", "count.textContent = 'wrong'")
    await js(`(()=>{const original=odkRendererDevelopment.define;odkRendererDevelopment.define=definition=>{window.piTileReplacement=definition};try{${fixture}\n}finally{odkRendererDevelopment.define=original}})()`)
  }
  const cases = [
    { count: '2', label: 'Working...', summary: 'Mac / SSH · 中文 · 1 workspace · 2 live', response: { ok: true, source: { label: 'Mac / SSH · 中文' }, summary: { running: 2, workspacesCount: 1 }, sessions: [{ status: 'running', latestGoal: '**Keep** `Pi`\n中文 <tag>', activity: '<skill name="read">ignored</skill> file' }, { status: 'settled' }] } },
    { count: '0', label: 'IDLE', summary: '2 workspaces · 2 live', response: { ok: true, summary: { running: 0, workspacesCount: 2 }, sessions: [{ status: 'settled', updatedAt: '2026-10-01', latestGoal: 'Old' }, { status: 'settled', updatedAt: '2026-10-10', latestGoal: 'Fresh 中文' }, { status: 'exited' }] } },
    { count: '0', label: 'IDLE', summary: '0 workspaces · 0 live', response: { ok: true, sessions: [], summary: { running: 0, workspacesCount: 0 } } },
    { count: '123', label: 'Working...', summary: '1 workspace · 0 live', response: { ok: true, sessions: [], summary: { running: 123, workspacesCount: 1 } } },
    { count: '--', label: 'OFFLINE', summary: 'Disconnected Mac · Retrying automatically', response: { ok: false, source: { label: 'Disconnected Mac' } } },
    { count: '--', label: 'ERROR', summary: 'Retrying automatically', reject: true },
    { count: '1', label: 'Working...', summary: '1 workspace · 1 live', response: { ok: true, sessions: [{ status: 'running', activity: 'Recover <script>unsafe</script>' }], summary: { running: 1, workspacesCount: 1 } } },
  ]
  const baseline = new Map(), tickCount = await js('piTileTicks.size')
  for (const phase of ['default', 'independent', 'restored']) {
    rejectScan = false; response = cases[0].response
    if (phase === 'independent') await js(`(async()=>{odkPlugins.get('odk.tile.pi-sessions').lifecycle.mount=()=>{throw Error('Default Widget delegation refused')};await odkRendererRuntime.replace(piTileReplacement)})()`)
    if (phase === 'restored') await js("odkRendererRuntime.restoreDefault('odk.tile.pi-sessions')")
    assert.equal(await js('piTileTicks.size'), tickCount)
    for (const size of [[1920,1280], [480,854]]) for (const theme of ['instrument', 'pixel', 'border-beam']) {
      win.setContentSize(...size)
      await js(`odkTheme.set(${JSON.stringify(theme)})`)
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
      for (let index = 0; index < cases.length; index++) {
        const value = cases[index]; response = value.response; rejectScan = !!value.reject
        await js('(()=>{for(let i=0;i<3;i++)for(const callback of [...piTileTicks])callback(new Date())})()')
        await wait(`piTileElement.querySelector('.pi-widget-count').textContent===${JSON.stringify(value.count)}&&piTileElement.querySelector('.pi-widget-tag-label').textContent===${JSON.stringify(value.label)}&&piTileElement.querySelector('.pi-widget-summary').textContent===${JSON.stringify(value.summary)}`)
        const snapshot = await js(`(()=>{const el=piTileElement;return {classes:[...el.classList].sort(),nodes:[...el.querySelectorAll('.pi-widget-body,.pi-widget-body *')].map(node=>({
          tag:node.tagName,text:node.textContent,classes:[...node.classList].sort(),html:node.children.length?null:node.innerHTML,hidden:node.hidden,
        })),summaryHidden:el.querySelector('.pi-widget-summary').hidden}})()`)
        const key = `${size.join('x')}/${theme}/${index}`
        if (phase === 'default') baseline.set(key, snapshot)
        else { assert.deepEqual(snapshot, baseline.get(key), `${phase} Pi Widget behavior changed: ${key}`); comparisons++ }
        assert.equal(await js("piTileElement.querySelectorAll('button:not(.widget-launch),a,input,script').length"), 0)
      }
    }
    assert.equal(await js("document===piTileDocument&&piTileElement===document.querySelector('[data-widget=\"odk.tile.pi-sessions\"]')&&piTilePeer===document.querySelector('[data-widget=\"odk.tile.year\"]')"), true)
  }
  await js('odkRendererRuntime.stop()'); assert.equal(await js('piTileTicks.size'), 0)
  await host.stop()
  assert.equal(host.list()[0].state, 'stopped')
  assert.equal(await js('odkRendererPluginBridge.list().then(()=>false,()=>true)'), true, 'Discovery handler remained available after release')
  console.log(JSON.stringify({ actualPreload: true, mode, externalEntry: mode === 'development', discoveryReleased: true, themes: 3, sizes: 2, states: cases.length, comparisons, retainedPlacement: true, subscriptionsReleased: true }))
  await finish(0)
}).catch(error => { void finish(1, error) })
