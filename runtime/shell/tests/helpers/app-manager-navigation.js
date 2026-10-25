'use strict'
const assert = require('node:assert/strict')
const { SYSTEM_PORTS } = require('../../src/plugins/system-channels')
exports.exerciseNavigation = async (win, host) => {
  const js = source => win.webContents.executeJavaScript(source)
  const result = await js(`(async () => {
    const platform = window.odkAppPlatform;
    const out = window.appManagerResult = { catalog: await window.odkPlatform.listApps() };
    const origin = document.createElement('button');
    origin.id = 'app-manager-focus-origin';
    origin.textContent = 'Navigation fixture';
    document.body.append(origin);
    origin.focus();
    out.clock = await platform.openApp({ appId: 'year', widgetId: 'fixture', route: 'home' });
    out.pomodoro = await platform.openApp({ appId: 'pomodoro' });
    out.title = document.querySelector('#app-title').textContent;
    out.clockState = await window.odkPlatform.getAppState('year');
    return out;
  })()`)
  const waitClosed = () => js(`(async () => {
    const deadline = performance.now() + 3000;
    while (window.odkAppPlatform.active() || !document.querySelector('#app-view').hidden) {
      if (performance.now() > deadline) throw Error('App close did not complete');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (document.activeElement.id !== 'app-manager-focus-origin') throw Error('App close did not restore focus');
  })()`)
  const back = await js(`(() => {
    const box = document.querySelector('#app-back').getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) throw Error('Back has no pointer target');
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...back })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...back })
  await waitClosed()
  await js(`(async () => {
    appManagerResult.backState = await window.odkPlatform.getAppState('pomodoro');
    appManagerResult.reopened = await window.odkAppPlatform.openApp({ appId: 'year' });
  })()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitClosed()
  Object.assign(result, await js(`(async () => {
    const platform = window.odkAppPlatform;
    const out = appManagerResult;
    out.escapeState = await window.odkPlatform.getAppState('year');
    out.managerOpened = await platform.openApp({ appId: 'app-manager' });
    const search = document.querySelector('#app-runtime .app-manager .app-search');
    const list = document.querySelector('#app-runtime .app-manager .app-list');
    const listDeadline = performance.now() + 3000;
    while (!list.children.length) {
      if (performance.now() > listDeadline) throw Error('App catalog did not render');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    out.managerRows = list.querySelectorAll('li').length;
    search.value = 'Pomodoro';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    out.filteredRows = list.querySelectorAll('li').length;
    out.filteredName = list.textContent.trim();
    await platform.closeApp();
    await platform.openApp({ appId: 'year' });
    const target = window.odkPlugins.byKind('app').find(plugin => plugin.appId === 'pomodoro');
    const mount = target.lifecycle.mount;
    target.lifecycle.mount = () => { throw Error('fixture mount failure'); };
    try {
      out.failedOpen = await platform.openApp({ appId: 'pomodoro' });
      out.restored = platform.active()?.appId;
      out.rollbackClock = await window.odkPlatform.getAppState('year');
      out.rollbackTarget = await window.odkPlatform.getAppState('pomodoro');
    } finally { target.lifecycle.mount = mount; }
    await platform.closeApp();
    return out;
  })()`))
  assert.equal(result.clock, true)
  assert.equal(result.pomodoro, true)
  assert.equal(result.title, 'Pomodoro')
  assert.equal(result.clockState.state, 'stopped')
  assert.equal(result.backState.state, 'stopped')
  assert.equal(result.reopened, true)
  assert.equal(result.escapeState.state, 'stopped')
  assert.equal(result.managerOpened, true)
  assert.equal(result.managerRows, 10)
  assert.equal(result.filteredRows, 1)
  assert.match(result.filteredName, /Pomodoro/)
  assert.equal(result.failedOpen, false)
  assert.equal(result.restored, 'year')
  assert.equal(result.rollbackClock.state, 'running', 'App Manager recovery did not restore prior running state')
  assert.equal(result.rollbackTarget.state, 'stopped')
  assert.equal(host.get(SYSTEM_PORTS.appManager).foreground(), null)

  return result
}
