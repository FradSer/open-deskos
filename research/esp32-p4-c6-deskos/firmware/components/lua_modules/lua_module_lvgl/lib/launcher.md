# launcher

The AIODI Shell is the resident home UI for Open DeskOS. It owns the home pages,
App registry, App Manager, State Store, bottom Peek, and the single foreground
UI App. It runs inside the Shell Lua state and is driven by the C Runner's
canonical `on_start(ctx)` / `on_tick(ctx)` / `on_stop(ctx)` callbacks.

The user-facing App lifecycle follows the reference Shell/App Flow:

```text
Shell resident -> App on_start -> App on_tick -> App on_pause/on_resume
               -> App on_stop -> App runtime and frame/screen destroyed
```

An App opens directly from a home widget or Peek. The Shell stays resident and
mounts a full-size App screen above it; the App is revealed with a native
LVGL screen-load slide (move_left at app_open duration). No screenshot, image
clone, scaled App tree, widget reparenting, or per-frame geometry is used.
On Back the navigator drains the dismissal request on the next tick, slides the
Shell back in (move_right at app_close duration) with auto-delete of the App
screen, and refreshes the home page snapshot so the next drag blits fresh
content.

## Home

The three home pages use a center-snapped, one-page pager. A single horizontal
gesture can settle only on the adjacent page; elastic overscroll and release
momentum are bounded to that page. The release snap eases for a bounded 180 ms
from the current drag position to its target, yielding at least six visual
positions at the P4's measured bitmap-frame cadence. New pointer movement
cancels that snap at its current offset, so a reverse gesture continues rather
than jumping or waiting for the old animation to end. Each page is pre-rendered
while idle; its snapshot is visible only while the page moves. The selected live
tree is renderer-visible at rest and becomes transparent for the drag, while
the immutable bitmap and its small dynamic overlay become visible. That removes
the costly full-page redraw from finger-following frames. A replacement animated
navigation command retains the bitmap surface across the old snap's completion,
and the Shell's indicator/quota `scroll_end` work runs only after the replacement
has settled.

The Pomodoro ring remains mounted after the home screen is built. Its larger
160/208 reference diameter preserves the instrument scale, while AIODI's
construction-time layout harness measures the widest `88:88` target-font probe
inside the ring's fixed text box before selecting its deliberately restrained
font. This prevents renderer-specific clipping of the colon or seconds. Its
countdown updates the arc angles and label in place, so a second-boundary update
cannot rebuild pager children or force a full pager-layout pass during a drag.

While a cached page moves, the calendar and Pomodoro patches reuse the exact
fixed glyph bounds of their resting widgets. The cached Pomodoro bitmap omits
its countdown glyphs entirely, so its moving label is a transparent overlay
rather than a colour-matched mask; this prevents a target-only dark rectangle
around the current value.

On ESP32-P4 those immutable, opaque 1:1 RGB565 snapshots are written back to
PSRAM when captured, then composited by PPA during the drag. This removes the
software per-pixel bitmap blend from the finger-following path. PPA rejection
falls back to LVGL software rendering, so a failed hardware operation never
turns into a blank pager or changes the interruptible gesture lifecycle.

The home screen has a top status bar, a three-page horizontal pager, and a
bottom fullscreen-App Peek clipped to the remaining strip. Geometry comes from
`aiodi.grid_metrics()` and the same 3x4 grid is used by all fixed home pages.

- Homepage #1 contains the date, clock, Chat, Pomodoro ring, Num Pad, year
  progress, and Settings widgets.
- Homepage #2 contains the OpenCode Go subscription usage tile (rolling 5-hour
  window, weekly, monthly, Zen credit), pushed from the host Mac over USB via
  `cerb sub push`. Both the remaining percentage and rolling-window reset copy
  share the card's fixed left content edge; neither is centered as a separate
  hero metric. Without a snapshot it shows a "connect Mac" placeholder and
  requests a fresh push
  (`sub_request_fresh`).

The Peek is Shell-owned. It displays the last opened App's live compact UI and
opens that App by `app_id`; it does not own an App runtime. Peek and home
widgets read the same State Store namespace as the App body.

## App model

Every registered App has a stable `app_id`, a `kind`, and an App module. The
manager permits multiple service runtimes but only one foreground UI App. The
UI runtime is created on open and destroyed on Back. App code never calls
`lvgl.init`, `lvgl.deinit`, creates a screen, or adds the shared Back button.

Built-in and catalog Apps use the same module contract. A Lua entry chunk
returns a table with the required `on_start(ctx)` callback:

```lua
local aiodi = require("aiodi")

local App = {}

function App.on_start(ctx)
    aiodi.title(ctx.root, { text = ctx.app_id })
    ctx.state.opens = (ctx.state.opens or 0) + 1
end

function App.on_pause(ctx) end
function App.on_resume(ctx) end
function App.on_tick(ctx) end
function App.on_stop(ctx) end

return App
```

`on_pause`, `on_resume`, and `on_tick` are optional. `on_stop` must release
App-local callbacks and references to widgets. The manager owns ordering and
failure handling; an App must not start its own task or event loop.

The context contains:

| field | meaning |
|---|---|
| `app_id` | stable App identifier |
| `root` | App content column, already mounted in the common App frame |
| `state` | Shell-owned State Store namespace for this App |
| `width`, `height` | display dimensions |

## Shared State Store

`require("state_store").namespace(app_id)` is the only shared-data seam. The
namespace survives `on_stop` and is available to home and Peek after Back;
widgets and callbacks do not. State is in memory and is not flash persistence.

The namespace supports `get(key, default)`, `set(key, value)`, `delete(key)`,
and `version()`. For Lua App ergonomics, `state.key` reads and writes the same
backing namespace; it is not a second table.

## Sandbox

Catalog Lua Apps receive an allowlisted `lvgl` module, an App-safe `aiodi`
facade, `ICONS`, display dimensions, basic standard-library functions, and
their App context. The `aiodi` facade contains tokens and widget builders only;
its `screen`, `app`, `app_frame`, `load_anim`, and transition controls remain
Shell-private. Token tables are copied per App. Apps can only require `lvgl`
and `aiodi`. Screen creation, LVGL initialization, event-loop ownership, raw
filesystem access, and arbitrary module loading remain Shell responsibilities.

## Verification

Host tests:

```sh
cmake -S research/esp32-p4-c6-deskos/firmware/tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```

The native SDL simulator can exercise the three home pages and direct App
opening with `ODK_SIM_HOME_PAGE`, `ODK_SIM_TAP`, and `ODK_SIM_SHOT`.
