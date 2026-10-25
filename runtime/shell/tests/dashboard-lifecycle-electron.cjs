'use strict'

const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

const profile = process.env.ODK_DASHBOARD_LIFECYCLE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
let win, finishing
const timer = setTimeout(() => { void finish(1, Error('Dashboard lifecycle acceptance timed out')) }, 45000)
async function release() {
  try {
    if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
  } finally { win?.destroy() }
}
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timer)
  if (error) console.error(error)
  finishing = release().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
    (_request, callback) => callback({ cancel: true }))
  installGeometryFixtures(ipcMain)
  let homeStatus = { state: 'idle', briefing: { state: 'empty', items: [], generatedAt: 0, omittedSources: 0 } }
  ipcMain.removeHandler('odk-personal-agent-status')
  ipcMain.handle('odk-personal-agent-status', () => homeStatus)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let loads = 0
  win.webContents.on('did-finish-load', () => { loads++ })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const js = code => win.webContents.executeJavaScript(code)
  await js('window.odkShellReady')
  await js(`(async () => {
    window.selectedHomeOriginal = window.odkServices.homeBriefing;
    window.selectedHomeRetained = selectedHomeOriginal.snapshot();
    const frame = { state: 'error', items: [], generatedAt: 0, omittedSources: 0 };
    window.odkServices.registerService('homeBriefing', {
      snapshot: () => frame, subscribe(callback) { callback(frame); return () => {}; },
    });
    await window.odkRendererRuntime.setEnabled('odk.page.dashboard', false);
    await window.odkRendererRuntime.setEnabled('odk.page.dashboard', true);
    if (document.querySelector('#dash-narrative').textContent !== ''
      || document.querySelector('.dash-presence').dataset.state !== 'error'
      || !/failed.*retry/i.test(document.querySelector('.dash-presence').getAttribute('aria-label')))
      throw Error('Dashboard bypassed selected Home Briefing service');
    window.homeDelivery = new Promise(resolve => {
      const release = window.odkPersonalAgent.subscribe(() => { release(); resolve(); });
    });
  })()`)
  homeStatus = { state: 'unavailable' }
  win.webContents.send('odk-personal-agent-status', homeStatus)
  await js('homeDelivery')
  assert.equal(await js('selectedHomeOriginal.snapshot() === selectedHomeRetained'), true,
    'Deselected Home Briefing still received actual preload updates')
  await js(`(async () => {
    const current = new Promise(resolve => {
      const release = selectedHomeOriginal.subscribe(frame => {
        if (frame.state === 'unavailable') { release(); resolve(); }
      });
    });
    window.odkServices.registerService('homeBriefing', selectedHomeOriginal);
    await current;
    await window.odkRendererRuntime.setEnabled('odk.page.dashboard', false);
    await window.odkRendererRuntime.setEnabled('odk.page.dashboard', true);
    if (document.querySelector('#dash-narrative').textContent !== ''
      || document.querySelector('.dash-presence').dataset.state !== 'unavailable'
      || !/reconnect/i.test(document.querySelector('.dash-presence').getAttribute('aria-label')))
      throw Error('Dashboard did not restore current Home Briefing');
  })()`)
  const result = await js(`(async () => {
    const check = (value, message) => { if (!value) throw Error(message) };
    const registry = window.odkPlugins, id = 'odk.page.dashboard';
    const originalDocument = document;
    const peer = document.querySelector('[data-widget="odk.tile.year"]');
    check(peer, 'Peer Clock placement absent');
    for (const failUnsubscribe of [false, true]) {
      const element = document.createElement('section'); document.body.append(element);
      const briefings = [], ticks = [], activeBriefings = new Set(), activeTicks = new Set();
      let releases = 0;
      const frame = state => ({ state, items: [], generatedAt: 0, omittedSources: 0 });
      const ui = {
        homeBriefing: { snapshot: () => frame('empty'), subscribe(callback) {
          briefings.push(callback); activeBriefings.add(callback); callback(frame('empty'));
          return () => {
            releases++;
            if (failUnsubscribe && releases === 1) throw Error('Controlled Dashboard unsubscribe failure');
            activeBriefings.delete(callback);
          };
        } },
        onTick(callback) {
          ticks.push(callback); activeTicks.add(callback); callback(new Date(2026, 0, 1));
          return () => activeTicks.delete(callback);
        },
      };
      check(registry.activate(registry.get(id), element, ui), 'Initial Dashboard mount refused');
      const oldYear = element.querySelector('#dash-y');
      const oldStatus = element.querySelector('#dash-narrative');
      await registry.setEnabled(id, false);
      const releasedHTML = element.innerHTML;
      briefings[0](frame('error')); ticks[0](new Date(2099, 0, 1));
      check(element.innerHTML === releasedHTML, 'Released callback changed the container');
      check(oldYear.textContent === '2026', 'Released Tick changed former nodes');
      check(oldStatus.textContent === 'Personal Agent has no new desk briefing.', 'Released briefing changed former nodes');
      if (failUnsubscribe) {
        check(registry.catalog().find(entry => entry.manifest.id === id).state === 'cleanup-failed', 'Cleanup ownership lost');
        check(activeBriefings.size === 1, 'Failed unsubscribe lost its retained resource');
        await registry.setEnabled(id, false);
      }
      check(activeBriefings.size === 0 && activeTicks.size === 0, 'Release did not settle');
      await registry.setEnabled(id, true);
      check(briefings.length === 2 && ticks.length === 2, 'Remount subscriptions absent');
      briefings[1](frame('unavailable')); ticks[1](new Date(2027, 1, 2));
      check(element.querySelector('#dash-narrative').textContent === '', 'Failure text entered the paragraph');
      check(element.querySelector('.dash-presence').dataset.state === 'unavailable', 'Current briefing stopped updating');
      check(/reconnect/i.test(element.querySelector('.dash-presence').getAttribute('aria-label')), 'Current recovery status absent');
      check(element.querySelector('#dash-md').textContent === 'February 2', 'Current date stopped updating');
      check(element.querySelector('#dash-y').textContent === '2027', 'Current year stopped updating');
      const currentHTML = element.innerHTML;
      briefings[0](frame('error')); ticks[0](new Date(2099, 0, 1));
      check(element.innerHTML === currentHTML, 'Old callback overwrote the new placement');
      check(document === originalDocument && peer === document.querySelector('[data-widget="odk.tile.year"]'), 'Document or peer replaced');
      const currentYear = element.querySelector('#dash-y');
      await registry.deactivate(registry.get(id), element, ui);
      check(activeBriefings.size === 0 && activeTicks.size === 0, 'Final surface release leaked subscriptions');
      check(registry.catalog().find(entry => entry.manifest.id === id).state === 'running', 'Individual release disabled the plugin');
      const finalHTML = element.innerHTML;
      briefings[1](frame('error')); ticks[1](new Date(2099, 0, 1));
      check(element.innerHTML === finalHTML && currentYear.textContent === '2027', 'Individual release retained update permission');
      element.remove();
    }
    await window.odkRendererRuntime.stop();
    return { actualPreload: Boolean(window.odkPersonalAgent), scenarios: 2, selectedServices: 1, released: true };
  })()`)
  console.log(JSON.stringify({ ...result, documentLoads: loads }))
  await finish(0)
}).catch(error => { void finish(1, error) })
