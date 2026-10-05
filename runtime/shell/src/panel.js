'use strict'

// What a kiosk panel is, separated from the rest of the Shell so its behavior
// can be read, and tested, without a display: the panel covers the display
// rather than the work area, the desk asks for that geometry again while the
// window is short of it, and the panel window is not one the user can move.
// The decision is recorded in docs/ARCHITECTURE.md#adr-0034.

const electron = require('electron')

// The display bounds a Windows panel covers, or null everywhere else. A kiosk
// window there is created for the display rather than for the configured content
// size (the CM5's 1920x1280): on a Windows Shell Host a frameless window the
// size of the work area comes back maximized when it is shown, and only the
// panel geometry puts the desk on the display. The reference host keeps the
// configured size, and its kiosk mode is what holds the geometry there.
function resolvePanelBounds(options, platform = process.platform, primaryDisplay = () => electron.screen.getPrimaryDisplay()) {
  return options.kiosk && platform === 'win32' ? primaryDisplay().bounds : null
}

// A panel is the desk's whole surface, so the host may not move, resize,
// maximize or minimize it. Measured on a Windows Shell Host: a panel that left
// those options alone followed a hand drag, and Win+Down minimized it — a
// window, not a panel. The geometry only comes back from the panel itself.
const KIOSK_WINDOW_LOCK = { movable: false, resizable: false, maximizable: false, minimizable: false }

// The panel covers the whole display the way a game in fullscreen does: taskbar
// included, while it is the active window, and Windows brings the taskbar back
// when the user switches to another window. Nothing here is topmost and nothing
// hides the shell, because this machine runs other applications.
//
// A fullscreen request made in the same tick as the show is dropped, and at
// logon the request can be dropped outright: the desk then stays the height of
// the work area with a strip of desktop under it. So the geometry is applied
// after the window has settled and then checked, with a bounded number of
// attempts, and a request the host drops is another attempt rather than a panel
// short of the display.
const PANEL_SETTLE_MS = 600
const PANEL_RETRY_MS = 400
const PANEL_ATTEMPTS = 8

function coversDisplay(bounds, display) {
  return bounds.x === display.x
    && bounds.y === display.y
    && bounds.width === display.width
    && bounds.height === display.height
}

function enterPanel(win, panelBounds, platform = process.platform, schedule = setTimeout) {
  if (platform !== 'win32') {
    // The reference host has no other window to switch to, so its kiosk mode is
    // the panel, and kiosk mode is what holds the geometry there.
    win.setFullScreen(true)
    win.setKiosk(true)
    return
  }
  const attempt = (attemptsLeft) => {
    if (!coversDisplay(win.getBounds(), panelBounds)) {
      if (win.isMaximized()) win.unmaximize()
      win.setFullScreen(true)
      // The geometry the desk needs is a window at the display bounds, so it is
      // asked for in those terms too: a dropped fullscreen request still has to
      // leave the desk covering the display.
      if (!coversDisplay(win.getBounds(), panelBounds)) win.setBounds(panelBounds)
    }
    if (attemptsLeft > 1 && !coversDisplay(win.getBounds(), panelBounds)) {
      schedule(() => attempt(attemptsLeft - 1), PANEL_RETRY_MS)
    }
  }
  schedule(() => attempt(PANEL_ATTEMPTS), PANEL_SETTLE_MS)
}

module.exports = {
  KIOSK_WINDOW_LOCK,
  PANEL_ATTEMPTS,
  PANEL_RETRY_MS,
  PANEL_SETTLE_MS,
  coversDisplay,
  enterPanel,
  resolvePanelBounds,
}
