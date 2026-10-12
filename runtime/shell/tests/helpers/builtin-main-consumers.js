'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runCommand } = require('./hydra-wire-lifecycle')

async function exerciseBuiltinMainViews(win, host, { version, configPath }) {
  const ids = ['calendar', 'clock', 'pomodoro', 'year', 'app-manager']
  const js = source => win.webContents.executeJavaScript(source)
  assert.deepEqual(await js(`${JSON.stringify(ids)}.map(id=>odkPlugins.get('odk.app.'+id).manifest.version||'1.0.0')`), ids.map(() => version))
  if (version !== '1.0.0') assert.deepEqual(await js(`${JSON.stringify(ids)}.map(id=>viewExecutedVersions['odk.app.'+id])`), ids.map(() => version))
  const records = host.list()
  const ports = records.flatMap(plugin => plugin.manifest.provides.map(port => [port.interface, host.get(port.interface)]))
  await js('window.builtinMainDocument=document;window.builtinMainPeers=[...document.querySelectorAll("[data-widget],[data-status-plugin],[data-built-by=composer]")]')
  const consume = async () => {
    const readings = {}
    for (const id of ids) {
      assert.equal(await js(`odkAppPlatform.openApp({appId:${JSON.stringify(id)}})`), true)
      if (id === 'app-manager') await js(`(async()=>{const deadline=performance.now()+3000;while(!document.querySelector('#app-runtime .app-list li')){if(performance.now()>deadline)throw Error('Production catalog did not render');await new Promise(resolve=>setTimeout(resolve,10))}})()`)
      readings[id] = await js(`(()=>{const el=document.querySelector('#app-runtime .runtime-app');const value=el.querySelector('.runtime-value,.runtime-date');return{heading:el.querySelector('h2').textContent,value:value?.textContent||null,date:value?.getAttribute('datetime')||null,state:el.querySelector('.runtime-state')?.textContent||'',rows:[...el.querySelectorAll('.app-list li')].map(row=>row.textContent)}})()`)
      if (id === 'clock') assert.equal(readings[id].value, '12:34', 'Production built-in Clock reading changed')
      if (id === 'calendar') assert.equal(readings[id].date, '2026-01-01')
      if (id === 'year') assert.equal(readings[id].value, '0%')
      if (id === 'pomodoro') assert.equal(readings[id].state, 'Timer unavailable')
      if (id === 'app-manager') {
        assert.equal(readings[id].rows.length, 6)
        await js("(()=>{const input=document.querySelector('#app-search');input.value=' CLOCK ';input.dispatchEvent(new Event('input'))})()")
        assert.equal(await js("document.querySelectorAll('#app-runtime .app-list li').length"), 1)
        assert.equal(await js("document.querySelector('#app-runtime .app-list strong').textContent"), 'Clock')
      }
      assert.equal(await js('odkAppPlatform.closeApp()'), true)
      assert.equal(host.get('odk:system/app-manager/v1').foreground(), null)
      assert.equal(await js('document===builtinMainDocument&&builtinMainPeers.length>0&&builtinMainPeers.every(node=>node.isConnected)'), true)
    }
    return readings
  }
  const startup = await consume()
  let transitions = 0
  if (version !== '1.0.0') {
    const saved = fs.readFileSync(configPath)
    for (const action of ['restore-default', 'activate']) {
      await js(`window.builtinAllowDefaults=${action === 'restore-default'}`)
      for (const appId of ids) {
        const id = `odk.app.${appId}`
        const executions = await js('viewExternalEntries.length')
        const receipt = JSON.parse((await runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), action, id, '--runtime'],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000 })).stdout)
        assert.equal(receipt.scope, 'electron-renderer')
        assert.equal(receipt.pluginId, id)
        assert.equal(receipt.state, 'running')
        assert.equal(receipt.version, action === 'restore-default' ? '1.0.0' : version)
        assert.equal(await js('viewExternalEntries.length'), executions + (action === 'activate' ? 1 : 0))
        assert.deepEqual(fs.readFileSync(configPath), saved)
        assert.deepEqual(host.list(), records)
        for (const [name, value] of ports) assert.equal(host.get(name), value)
        transitions++
      }
      assert.deepEqual(await consume(), startup)
    }
    assert.equal(await js('builtinDefaultMounts'), 0)
  }
  return { version, startup, phases: version === '1.0.0' ? 1 : 3, transitions }
}

module.exports = { exerciseBuiltinMainViews }
