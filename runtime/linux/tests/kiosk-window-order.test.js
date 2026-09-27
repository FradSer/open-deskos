const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The desk is fullscreen the way a game is: it covers the whole display, taskbar
// included, while it is the active window, and Windows brings the taskbar back
// when the user switches to another window. Three facts about that are pinned
// here, each of which was measured on a real Windows host:
//
//   * a fullscreen transition requested before the window is shown can leave the
//     window invisible, so the window is shown first;
//   * Windows maximizes a frameless window that is exactly the work area when it
//     is shown, and a maximized window ignores both setBounds and setFullScreen,
//     so that state is left before fullscreen is applied;
//   * nothing may be topmost and nothing may hide the taskbar, because this
//     machine runs other applications.
test('the shell shows the window, leaves the maximized state, then goes fullscreen', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const block = source.slice(source.indexOf("win.once('ready-to-show'"))
  const readyBlock = block.slice(0, block.indexOf('})'))

  const showAt = readyBlock.indexOf('win.show()')
  const unmaximizeAt = readyBlock.indexOf('win.unmaximize()')
  const panelTimerAt = readyBlock.indexOf('setTimeout(enterPanel')

  assert.ok(showAt >= 0, 'the shell must show its window')
  assert.ok(unmaximizeAt > showAt, 'the maximized state is left after the window is shown')
  assert.ok(panelTimerAt > showAt, 'the panel geometry is applied after the window is shown')
  // Windows ignores a fullscreen request made in the same tick as leaving the
  // maximized state, so the request is deferred rather than sharing the tick.
  assert.match(readyBlock, /const enterPanel = \(\) => \{[\s\S]*win\.setFullScreen\(true\)/, 'the panel request is fullscreen')
  assert.match(source, /getPrimaryDisplay\(\)\.bounds/, 'a Windows kiosk window is created at the display size')
  assert.match(readyBlock, /win\.setKiosk\(true\)/, 'the reference host still enters kiosk mode')
  assert.doesNotMatch(source, /setAlwaysOnTop/, 'the desk is not topmost')
  assert.doesNotMatch(source, /kiosk: options\.kiosk/, 'kiosk is not requested from the constructor')
  assert.doesNotMatch(source, /fullscreen: options\.kiosk/, 'fullscreen is not requested from the constructor')
})

// The launcher that runs the panel must not take the taskbar away: this host runs
// other applications, and hiding the shell would make them unreachable.
test('the panel launcher leaves the host shell alone', () => {
  const launcher = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'windows-kiosk.ps1'), 'utf8')

  assert.doesNotMatch(launcher, /Shell_TrayWnd/, 'the launcher must not hide or touch the taskbar')
  assert.doesNotMatch(launcher, /ShowWindow/, 'the launcher must not show or hide shell windows')
  assert.match(launcher, /RestartDelaySeconds/, 'the panel restarts after the shell exits')
})