# A panel covers the display, and the user does not move it

## Status

Accepted. Refines the Windows panel launcher recorded in `docs/WINDOWS_HOST.md`; the reference host's kiosk mode is unchanged.

## Context

A 64-bit Windows handheld is a supported Shell Host (ADR 0023) and boots into the desk as a panel. After a restart the desk did not fill the screen: on a 1280x800 display it came up `0,0 1280x728`, with a strip of desktop wallpaper and the taskbar below it, and a hand drag moved and resized it. A window that can be dragged out of the middle of the screen is a window, not a panel, so the same fact showed up twice: as a gap the user can see, and as geometry the user can take away.

Three things had to be settled rather than assumed.

**What "fullscreen" means on this host.** A fullscreen transition requested before the window is shown can leave the window invisible, and a maximized window ignores both `setBounds` and `setFullScreen`, which is why the window is shown first and the maximized state is left first. But the measurements on a real host showed that Electron's fullscreen is not a state Windows enforces for a frameless window: after `setFullScreen(true)`, `isFullScreen()` was still `false` while `getBounds()` had become the display bounds. On this host fullscreen is geometry, so the geometry is what has to be right.

**A request the host drops.** At logon the fullscreen request was dropped outright: the desk kept the height it was created with, which is the work area (measured: the window was created for the display's 1280x800 and came back 1280x776, and at that moment at logon the work area was 728). Asking once and assuming the request landed made a restart decide whether the desk filled the screen.

**How far "the panel owns the screen" goes.** The panel is deliberately not topmost and the taskbar is deliberately not hidden, because this machine runs other applications and the taskbar must come back with the next window. That decision is not in question; what it does not answer is whether the user may move the panel itself.

## Decision

- The panel's geometry is the display bounds, never the work area. A kiosk window on a Windows Shell Host is created for the display, and the panel geometry is applied after the window is shown.
- The panel is verified, not assumed. The desk compares its own bounds with the display bounds and, while they differ, asks again — as a fullscreen request and as a window at the display bounds — a bounded number of times. A request the host drops costs one more attempt instead of a strip of desktop until the next restart.
- A panel window declares itself not movable, not resizable, not maximizable and not minimizable. Measured on a real host: with those options the window carries neither `WS_THICKFRAME` nor the two box buttons, a hand drag leaves its geometry unchanged, and `Win+Down` does not minimize it (it did minimize the same window without them). Only the panel gives its geometry back.
- The panel is still not topmost and still does not hide the taskbar. It covers the taskbar's pixels while it is the active window, and Windows brings the taskbar back with the next window.
- The reference host is untouched: its kiosk mode is its own geometry, and its content size is still the configured one.

## Consequences

- A restart no longer decides whether the desk fills the screen, and the visible symptom of a dropped request — a strip of desktop under the desk — is bounded by the retry rather than by the next restart.
- On a Windows Shell Host nothing may read "the desk is fullscreen" from `isFullScreen()`; it is `false` for a panel that covers the display. The renderer learns about the panel from the launch query, as before.
- The panel cannot be moved or resized by the user, so a desk that needs different geometry cannot be had by dragging it. A future need for a movable desk is a reversal of this record, not an addition to it.
- The verification costs a bounds comparison a few hundred milliseconds after the window is shown, and at most eight attempts. A panel that never covers the display after those attempts is a defect to report rather than a state to keep retrying forever.
- Windows still decides when the panel gives up the screen. Quitting the desk brings the desktop back, because the taskbar and the other windows are still the host's, and that is the trade this machine makes for running other applications.
