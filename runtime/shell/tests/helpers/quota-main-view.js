'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { resolveConfigPath } = require('../../src/plugin-config')
const { runCommand } = require('./hydra-wire-lifecycle')
const { quotaPagePlacementSource } = require('./quota-page-placement')

function prepareQuotaMainView(BrowserWindow, mode) {
  assert.ok(['default', 'selected', 'incorrect', 'missing'].includes(mode))
  const loadFile = BrowserWindow.prototype.loadFile
  BrowserWindow.prototype.loadFile = async function (...args) {
    await this.loadURL('about:blank')
    this.webContents.debugger.attach('1.3')
    await this.webContents.debugger.sendCommand('Page.enable')
    const source = `(()=>{
      window.quotaMainDefaultMounts=0;window.quotaMainAllowDefault=${mode === 'default'};
      window.quotaMainSubscriptions=new Set();
      ${quotaPagePlacementSource}
      let services,registry;
      Object.defineProperty(window,'odkServices',{configurable:true,get(){return services},set(value){
        services=value;const sub=value.subscription,subscribe=sub.subscribe.bind(sub);
        sub.subscribe=callback=>{const cancel=subscribe(callback);quotaMainSubscriptions.add(callback);
          return()=>{cancel();quotaMainSubscriptions.delete(callback)}};
      }});
      Object.defineProperty(window,'odkPlugins',{configurable:true,get(){return registry},set(value){
        registry=value;const register=value.register;
        value.register=function(definition){
          if(definition.id==='odk.page.quota'&&definition.manifest?.version!=='2.0.0'){
            const mount=definition.lifecycle?.mount||definition.mount;
            const guarded=function(...args){
              if(!quotaMainAllowDefault){quotaMainDefaultMounts++;throw Error('Packaged Quota mount refused')}
              return mount.apply(this,args);
            };
            definition={...definition,mount:guarded,lifecycle:{...definition.lifecycle,mount:guarded}};
          }
          return register.call(this,definition);
        };
      }});
    })()`
    new vm.Script(source)
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source })
    return loadFile.apply(this, args)
  }
  return { async exercise(win, host, responses, measuring) {
    const js = source => win.webContents.executeJavaScript(source)
    assert.equal(await js('quotaMainDefaultMounts'), 0, 'Production Quota page fallback guard triggered')
    const settle = () => js(`(async()=>{const deadline=performance.now()+3000;
      if (!document.querySelector('#quota-refresh') && window.odkAppPlatform) {
        await window.odkAppPlatform.openApp({ appId: 'quota' });
      }
      while(!document.querySelector('#quota-refresh')||document.querySelector('#quota-refresh').disabled){
        if(performance.now()>deadline)throw Error('Production Quota refresh did not settle');await new Promise(resolve=>setTimeout(resolve,10))}
    })()`)
    await settle()
    await js('window.quotaMainDocument=document;window.quotaMainPage=document.querySelector(".page[data-page-id=quota], #app-runtime .quota-card")')
    const source = host.get('odk:source/quota/v1')
    const records = host.list()
    const saved = fs.existsSync(resolveConfigPath(process.env)) ? fs.readFileSync(resolveConfigPath(process.env)) : null
    const phases = []
    for (const phase of mode === 'default' ? ['default'] : ['selected', 'restored', 'reactivated']) {
      if (phase !== 'selected' && phase !== 'default') {
        measuring(false)
        await js(`window.quotaMainAllowDefault=${phase === 'restored'}`)
        const action = phase === 'restored' ? 'restore-default' : 'activate'
        const receipt = JSON.parse((await runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/odk-plugin-cli.js'), action, 'odk.page.quota', '--runtime'],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 65536 })).stdout)
        assert.equal(receipt.version, phase === 'restored' ? '1.0.0' : '2.0.0')
        assert.equal(receipt.state, 'running')
        await settle()
      }
      assert.equal(await js("odkPlugins.get('odk.page.quota').manifest.version||'1.0.0'"), ['default', 'restored'].includes(phase) ? '1.0.0' : '2.0.0')
      assert.equal(await js('quotaMainSubscriptions.size'), 1)
      measuring(true)
      const observations = []
      for (let index = 0; index < responses.length; index++) {
        const status = await js('odkServices.subscription.refresh()')
        assert.deepEqual(status, responses[index])
        const view = await js(`(()=>{const page=quotaMainPage;
          for(const meter of page.querySelectorAll('[role=meter]')){
            const fill=meter.querySelector('.provider-quota-fill');
            const expected=meter.clientWidth*Number(meter.getAttribute('aria-valuenow'))/100;
            if(meter.clientWidth<=0||Math.abs(fill.getBoundingClientRect().width-expected)>1)throw Error('Production quota fill does not match its percentage');
          }
          return{heading:page.querySelector('h1').textContent,count:page.querySelector('#quota-count').textContent,
            feedback:page.querySelector('#quota-feedback').textContent,
            readings:[...page.querySelectorAll('.provider-plan,.provider-quota-account,.provider-quota-availability,.provider-quota-label,.provider-quota-value,.provider-quota-reset')].map(node=>node.textContent.trim()),
            values:[...page.querySelectorAll('.provider-quota-value')].map(node=>node.textContent),
            meters:[...page.querySelectorAll('[role=meter]')].map(node=>node.getAttribute('aria-valuenow')),
            empty:page.querySelector('.provider-quota-empty')?.textContent||null};})()`)
        if (index === 0) {
          assert.deepEqual(view.values, ['12%', '0%'], 'Production Quota page reading changed')
          assert.deepEqual(view.meters, ['12.345', '0'])
        }
        observations.push({ status, view })
      }
      measuring(false)
      phases.push(observations)
      assert.equal(host.get('odk:source/quota/v1'), source)
      assert.deepEqual(host.list(), records)
      assert.deepEqual(fs.existsSync(resolveConfigPath(process.env)) ? fs.readFileSync(resolveConfigPath(process.env)) : null, saved)
      assert.equal(await js('document===quotaMainDocument&&quotaMainPage===document.querySelector(".page[data-page-id=quota], #app-runtime .quota-card")&&quotaMainPage.isConnected'), true)
      assert.equal(await js('quotaMainDefaultMounts'), 0, 'Production Quota page fallback guard triggered')
    }
    return { phases, entries: await js('(window.quotaMainEntries||[]).length') }
  }, async assertReleased(win) {
    assert.equal(await win.webContents.executeJavaScript('quotaMainSubscriptions.size'), 0)
  } }
}

module.exports = { prepareQuotaMainView }
