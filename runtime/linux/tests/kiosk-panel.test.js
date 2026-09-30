const test = require('node:test')
const assert = require('node:assert/strict')

const { enterPanel, resolvePanelBounds, KIOSK_WINDOW_LOCK } = require('../src/panel')

const DISPLAY = { x: 0, y: 0, width: 1280, height: 800 }
// What a Windows host reports at logon: the taskbar is taller before the shell
// has settled, so a window created for the display comes back the size of the
// work area, and 728 is a strip of desktop left under the desk.
const WORK_AREA = { x: 0, y: 0, width: 1280, height: 728 }

// A Windows host drops a fullscreen request by leaving the window where it is;
// a window move it drops the same way. The two drops are counted separately
// because they are two different requests.
function fakeWindow({ bounds = WORK_AREA, maximized = false, dropFullscreen = 0, dropBounds = 0 } = {}) {
  const calls = []
  const drops = { fullscreen: dropFullscreen, bounds: dropBounds }
  return {
    calls,
    state: { bounds: { ...bounds }, maximized, fullscreen: false, kiosk: false },
    getBounds() { return { ...this.state.bounds } },
    isMaximized() { return this.state.maximized },
    unmaximize() { calls.push('unmaximize'); this.state.maximized = false },
    setFullScreen(flag) {
      calls.push('setFullScreen')
      this.state.fullscreen = flag
      if (drops.fullscreen > 0) { drops.fullscreen -= 1; return }
      this.state.bounds = { ...DISPLAY }
    },
    setBounds(next) {
      calls.push('setBounds')
      if (drops.bounds > 0) { drops.bounds -= 1; return }
      this.state.bounds = { ...next }
    },
    setKiosk(flag) { calls.push('setKiosk'); this.state.kiosk = flag },
  }
}

function fakeSchedule() {
  const queue = []
  const schedule = (fn, ms) => queue.push({ fn, ms })
  schedule.runs = 0
  schedule.drain = () => {
    while (queue.length > 0) {
      if (schedule.runs >= 50) throw new Error('the panel kept asking for its geometry instead of settling')
      queue.shift().fn()
      schedule.runs += 1
    }
  }
  return schedule
}

test('a panel request the host drops is asked again until the desk covers the display', () => {
  // Measured on a Windows Shell Host: at logon the fullscreen request is dropped
  // and the desk stays the height of the work area, with the desktop showing
  // under it. The geometry the desk needs is a plain window move, so the panel
  // asks for both and keeps asking while the window is still short of the
  // display.
  const win = fakeWindow({ dropFullscreen: 2, dropBounds: 2 })
  const schedule = fakeSchedule()
  enterPanel(win, DISPLAY, 'win32', schedule)
  assert.equal(schedule.runs, 0, 'the first attempt waits: a request made in the show tick is dropped')

  schedule.drain()
  assert.deepEqual(win.state.bounds, DISPLAY, 'the desk ends up covering the display')
  assert.equal(win.calls.filter((c) => c === 'setBounds').length, 2, 'a dropped fullscreen request falls back to the window geometry')
  assert.equal(win.calls.filter((c) => c === 'setFullScreen').length, 3, 'a dropped request is asked again, not given up on')
  assert.equal(schedule.runs, 3, 'and the attempts stop as soon as the desk covers the display')
  assert.equal(win.calls.filter((c) => c === 'setKiosk').length, 0, 'a Windows panel is not the shell kiosk mode')
})

test('the panel stops asking once the window covers the display', () => {
  const win = fakeWindow()
  const schedule = fakeSchedule()
  enterPanel(win, DISPLAY, 'win32', schedule)
  schedule.drain()

  assert.deepEqual(win.getBounds(), DISPLAY)
  assert.equal(win.calls.filter((c) => c === 'setFullScreen').length, 1, 'one request that lands is enough')
  assert.equal(schedule.runs, 1, 'and nothing is scheduled after it')
})

test('a panel window that the host maximized is restored before the panel geometry', () => {
  const win = fakeWindow({ maximized: true })
  const schedule = fakeSchedule()
  enterPanel(win, DISPLAY, 'win32', schedule)
  schedule.drain()

  assert.ok(win.calls.indexOf('unmaximize') >= 0, 'the maximized state is left')
  assert.ok(win.calls.indexOf('unmaximize') < win.calls.indexOf('setFullScreen'), 'and left before the panel is applied')
  assert.deepEqual(win.getBounds(), DISPLAY)
})

test('the reference host enters the shell kiosk mode instead of the panel geometry loop', () => {
  const win = fakeWindow()
  const schedule = fakeSchedule()
  enterPanel(win, DISPLAY, 'linux', schedule)

  assert.ok(win.calls.includes('setKiosk'), 'the reference host keeps its kiosk mode')
  assert.equal(schedule.runs, 0, 'kiosk mode is its own geometry, so nothing is retried')
})

test('only a Windows kiosk launch takes the display bounds as its window size', () => {
  const primary = () => ({ bounds: DISPLAY })

  assert.deepEqual(resolvePanelBounds({ kiosk: true }, 'win32', primary), DISPLAY)
  assert.equal(resolvePanelBounds({ kiosk: false }, 'win32', primary), null, 'a windowed launch is left alone')
  assert.equal(resolvePanelBounds({ kiosk: true }, 'linux', primary), null, 'the reference host keeps the configured content size')
})

test('a panel window is not a window the user can move', () => {
  assert.deepEqual(KIOSK_WINDOW_LOCK, { movable: false, resizable: false, maximizable: false, minimizable: false })
})
