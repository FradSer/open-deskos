const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RUNTIME = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8')

// The panel is fullscreen the way a game is: it covers the whole display,
// taskbar included, while it is the active window, and Windows brings the
// taskbar back when the user switches to another window. Four facts about that
// are pinned here, each of which was measured on a real Windows host:
//
//   * a fullscreen transition requested before the window is shown can leave the
//     window invisible, so the window is shown first;
//   * Windows maximizes a frameless window that is exactly the work area when
//     it is shown, and a maximized window ignores both setBounds and
//     setFullScreen, so that state is left before the panel is applied;
//   * at logon the fullscreen request can be dropped outright, which leaves the
//     desk the height of the work area with a strip of desktop under it, so the
//     geometry is checked and asked for again rather than assumed;
//   * a panel that left the window movable followed a hand drag, and Win+Down
//     minimized it, so a panel window is locked against all four.
//
// Nothing may be topmost and nothing may hide the taskbar, because this machine
// runs other applications. The retry itself is covered behaviourally in
// kiosk-panel.test.js.
test('the shell shows its window, then applies the panel geometry', () => {
  const main = read(RUNTIME, 'src/main.js')
  const block = main.slice(main.indexOf("win.once('ready-to-show'"))
  const readyBlock = block.slice(0, block.indexOf('})'))

  const showAt = readyBlock.indexOf('win.show()')
  const panelAt = readyBlock.indexOf('enterPanel(')

  assert.ok(showAt >= 0, 'the shell must show its window')
  assert.ok(panelAt > showAt, 'the panel is applied after the window is shown')
  assert.match(main, /\.\.\.\(panelBounds \? KIOSK_WINDOW_LOCK : \{\}\),/, 'a kiosk window is locked, and only a kiosk window')
  assert.doesNotMatch(main, /setAlwaysOnTop/, 'the desk is not topmost')
  assert.doesNotMatch(main, /kiosk: options\.kiosk/, 'kiosk is not requested from the constructor')
  assert.doesNotMatch(main, /fullscreen: options\.kiosk/, 'fullscreen is not requested from the constructor')

  const panel = read(RUNTIME, 'src/panel.js')
  assert.match(panel, /if \(attemptsLeft > 1 && !coversDisplay\(win\.getBounds\(\), panelBounds\)\)/, 'a panel request the host drops is asked again')
  assert.match(panel, /win\.setBounds\(panelBounds\)/, 'the panel geometry is asked for as a window at the display bounds')
  assert.match(panel, /win\.setKiosk\(true\)/, 'the reference host still enters kiosk mode')
})

// The launcher that runs the panel must not take the taskbar away: this host runs
// other applications, and hiding the shell would make them unreachable.
test('the panel launcher leaves the host shell alone', () => {
  const launcher = read(RUNTIME, 'scripts/windows-kiosk.ps1')

  assert.doesNotMatch(launcher, /Shell_TrayWnd/, 'the launcher must not hide or touch the taskbar')
  assert.doesNotMatch(launcher, /ShowWindow/, 'the launcher must not show or hide shell windows')
  assert.match(launcher, /RestartDelaySeconds/, 'the panel restarts after the shell exits')
})
