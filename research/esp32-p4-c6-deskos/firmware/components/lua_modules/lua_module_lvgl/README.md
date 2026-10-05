# Lua UI and display API

This is the preserved research API. Read the applicable section before you call a module. Load its listed Lua name with require(). Use documented options. Release handles when the section requires cleanup. Test hardware operations only in an authorized device task.

## Contents

- [lua_module_display/README.md](#lua-module-display-readme)
- [lua_module_lcd/README.md](#lua-module-lcd-readme)
- [lua_module_lcd_touch/README.md](#lua-module-lcd-touch-readme)
- [lua_module_lvgl/README.md](#lua-module-lvgl-readme)
- [lua_module_lvgl/lib/aiodi.md](#lua-module-lvgl-lib-aiodi)
- [lua_module_lvgl/lib/almanac.md](#lua-module-lvgl-lib-almanac)
- [lua_module_lvgl/lib/config/desktop_layout.md](#lua-module-lvgl-lib-config-desktop-layout)
- [lua_module_lvgl/lib/core/dashboard_engine.md](#lua-module-lvgl-lib-core-dashboard-engine)
- [lua_module_lvgl/lib/core/desktop_composer.md](#lua-module-lvgl-lib-core-desktop-composer)
- [lua_module_lvgl/lib/core/hero_navigator.md](#lua-module-lvgl-lib-core-hero-navigator)
- [lua_module_lvgl/lib/core/pager.md](#lua-module-lvgl-lib-core-pager)
- [lua_module_lvgl/lib/core/plugin_registry.md](#lua-module-lvgl-lib-core-plugin-registry)
- [lua_module_lvgl/lib/core/widget_engine.md](#lua-module-lvgl-lib-core-widget-engine)
- [lua_module_lvgl/lib/dashboard_layout.md](#lua-module-lvgl-lib-dashboard-layout)
- [lua_module_lvgl/lib/launcher.md](#lua-module-lvgl-lib-launcher)
- [lua_module_lvgl/lib/minimal_swipe.md](#lua-module-lvgl-lib-minimal-swipe)
- [lua_module_lvgl/lib/plugins/almanac.md](#lua-module-lvgl-lib-plugins-almanac)
- [lua_module_lvgl/lib/plugins/breath.md](#lua-module-lvgl-lib-plugins-breath)
- [lua_module_lvgl/lib/plugins/calendar.md](#lua-module-lvgl-lib-plugins-calendar)
- [lua_module_lvgl/lib/plugins/chat.md](#lua-module-lvgl-lib-plugins-chat)
- [lua_module_lvgl/lib/plugins/clock.md](#lua-module-lvgl-lib-plugins-clock)
- [lua_module_lvgl/lib/plugins/dice.md](#lua-module-lvgl-lib-plugins-dice)
- [lua_module_lvgl/lib/plugins/hydrate.md](#lua-module-lvgl-lib-plugins-hydrate)
- [lua_module_lvgl/lib/plugins/init.md](#lua-module-lvgl-lib-plugins-init)
- [lua_module_lvgl/lib/plugins/mantra.md](#lua-module-lvgl-lib-plugins-mantra)
- [lua_module_lvgl/lib/plugins/pomodoro.md](#lua-module-lvgl-lib-plugins-pomodoro)
- [lua_module_lvgl/lib/plugins/quota.md](#lua-module-lvgl-lib-plugins-quota)
- [lua_module_lvgl/lib/plugins/settings.md](#lua-module-lvgl-lib-plugins-settings)
- [lua_module_lvgl/lib/plugins/stars.md](#lua-module-lvgl-lib-plugins-stars)
- [lua_module_lvgl/lib/plugins/year.md](#lua-module-lvgl-lib-plugins-year)
- [lua_module_lvgl/lib/state_store.md](#lua-module-lvgl-lib-state-store)

<!-- doc: lua_module_display/README.md -->
<a id="lua-module-display-readme"></a>

## Lua Display

`display` is a low-level drawing module. It can:
- Initialize and deinitialize the LCD drawing context
- Draw text, lines, rectangles, circles, arcs, ellipses, triangles, and round rectangles
- Draw raw RGB565 pixel buffers
- Draw RGB565 buffers obtained from `image.frame` values through the `image` module
- Manage frame-based rendering and partial screen flushes

### Typical setup

In this project, `display` is usually used together with `board_manager`:

```lua
local board_manager = require("board_manager")
local display = require("display")

local panel_handle, io_handle, width, height, panel_if =
    board_manager.get_display_lcd_params("display_lcd")

display.init(panel_handle, io_handle, width, height, panel_if)
```

After `display.init(...)` succeeds:
- `display.width` returns the current screen width
- `display.height` returns the current screen height
- Most drawing APIs can be used
- The display arbiter automatically grants Lua foreground ownership for the lifetime of the display session

When finished:

```lua
pcall(display.end_frame)
pcall(display.deinit)
```

### Important rules

- All coordinates and sizes are integer arguments unless noted otherwise.
- Most numeric drawing arguments are validated as integers in the Lua binding.
- Passing floating-point values such as `10.5`, `32.2`, or `tilt / 2` to coordinates, widths, heights, radii, crop rectangles, or `font_size` can raise a Lua error instead of being rounded automatically.
- If a computed value is meant to be a pixel coordinate or size, convert it to an integer first before passing it to the display API. Prefer integer division `//` when the value comes from a division expression.
- Colors are passed as one value: a hex string, a named color string, or a `{ r, g, b [, a] }` table.
- Supported hex forms are `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`.
- Supported named colors include `black`, `white`, `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`, and `transparent`.
- Text drawing only supports ASCII text.
- For Chinese or other Unicode text, render or load an image through the `image` module, convert it to `image.RGB565`, then draw the RGB565 buffer.
- Image file loading, saving, decoding, and format conversion belong to the `image` module. `display` only draws raw RGB565 buffers.
- This is critical: screen display duration must be considered. Do not deinitialize or exit immediately after `present()`, or the image may only flash briefly. Keep the display session alive long enough, and handle that hold time asynchronously when appropriate.

### Screen lifecycle

#### `display.init(panel_handle, io_handle, lcd_width, lcd_height[, panel_if])`

Initializes the drawing context.

- `panel_handle`: lightuserdata, usually from `board_manager.get_display_lcd_params(...)`
- `io_handle`: lightuserdata or `nil`
- `lcd_width`: integer
- `lcd_height`: integer
- `panel_if`: optional interface constant, usually returned by `board_manager.get_display_lcd_params(...)`
- Common values come from `board_manager.PANEL_IF_IO`, `board_manager.PANEL_IF_RGB`, and `board_manager.PANEL_IF_MIPI_DSI`
- Returns `true` on success
- Raises a Lua error on failure

#### `display.deinit()`

Deinitializes the drawing context.

- Returns `true` on success
- Raises a Lua error on failure

#### `display.width`

Returns the current screen width.

#### `display.height`

Returns the current screen height.

### Frame rendering

The module supports frame-based rendering. This is the preferred mode when a script draws a full screen or updates multiple primitives together.

#### `display.begin_frame([options])`

Starts a frame.

`options` is an optional table:
- `clear`: boolean, default `true`
- `color`: background color, default `"black"`

Example:

```lua
display.begin_frame({ clear = true, color = "#0c1220" })
```

#### `display.present()`

Flushes the current dirty rectangle to the panel. If no drawing operation changed the framebuffer since the last present, this returns without refreshing.

#### `display.present_full()`

Flushes the full current frame to the panel and clears the dirty state.

#### `display.end_frame()`

Ends the current frame.

#### `display.frame_active()`

Returns a boolean indicating whether a frame is currently active.

#### `display.animation_info()`

Returns a table with runtime rendering information:
- `framebuffer_count`
- `double_buffered`
- `frame_active`
- `flush_in_flight`

### Backlight

#### `display.backlight(on)`

Turns the display backlight on or off.

- `on`: boolean

Example:

```lua
display.backlight(true)
```

### Text APIs

#### `display.draw_text(x, y, text [, options])`

Draws ASCII text at the given position.

`options` is an optional table:
- `color`: text color, default `"white"`
- `font_size`: integer, default `24`; floating-point values are rejected
- `bg`: optional background color
- Text color and background can include alpha when drawing inside an active frame.

Example:

```lua
display.draw_text(16, 24, "hello", {
    color = "white",
    font_size = 24,
})
```

Restrictions:
- `text` must be ASCII
- Non-ASCII text raises an error
- Semi-transparent text or background requires `begin_frame(...)` before drawing.

#### `display.measure_text(text [, options])`

Measures text without drawing it.

`options` currently supports:
- `font_size` as an integer

Returns:
- `width`
- `height`

Example:

```lua
local tw, th = display.measure_text("hello", { font_size = 24 })
```

#### `display.draw_text_aligned(x, y, width, height, text [, options])`

Draws ASCII text inside a rectangle with alignment.

`options` supports:
- `color`
- `font_size` as an integer
- `bg`
- `align`: `"left"`, `"center"`/`"centre"`, or `"right"`
- `valign`: `"top"`, `"middle"`/`"center"`, or `"bottom"`

Example:

```lua
display.draw_text_aligned(0, 0, display.width, 32, "status", {
    color = "white",
    font_size = 16,
    align = "center",
    valign = "middle",
})
```

### Basic drawing primitives

#### `display.clear(color)`

Clears the screen or current frame buffer to a solid color.

#### `display.set_clip_rect(x, y, width, height)`

Sets a clipping rectangle. Subsequent drawing is restricted to that region until cleared.

#### `display.clear_clip_rect()`

Removes the active clipping rectangle.

#### `display.fill_rect(x, y, width, height, color)`

Draws a filled rectangle.

#### `display.draw_rect(x, y, width, height, color)`

Draws a rectangle outline.

#### `display.draw_pixel(x, y, color)`

Draws one pixel.

#### `display.draw_line(x0, y0, x1, y1, color)`

Draws a line.

### Shape drawing

#### `display.fill_circle(cx, cy, radius, color)`

Draws a filled circle.

#### `display.draw_circle(cx, cy, radius, color)`

Draws a circle outline.

#### `display.draw_arc(cx, cy, radius, start_deg, end_deg, color)`

Draws an arc.

- `start_deg` and `end_deg` are numeric values, not limited to integers

#### `display.fill_arc(cx, cy, inner_radius, outer_radius, start_deg, end_deg, color)`

Draws a filled ring segment.

#### `display.draw_ellipse(cx, cy, radius_x, radius_y, color)`

Draws an ellipse outline.

#### `display.fill_ellipse(cx, cy, radius_x, radius_y, color)`

Draws a filled ellipse.

#### `display.draw_round_rect(x, y, width, height, radius, color)`

Draws a rounded rectangle outline.

#### `display.fill_round_rect(x, y, width, height, radius, color)`

Draws a filled rounded rectangle.

#### `display.draw_triangle(x1, y1, x2, y2, x3, y3, color)`

Draws a triangle outline.

#### `display.fill_triangle(x1, y1, x2, y2, x3, y3, color)`

Draws a filled triangle.

### Raw pixel APIs

These APIs draw RGB565 pixel buffers. Prefer `display.draw_image(...)` when the source is already an `image.frame`, because it borrows the image buffer during the C call and avoids creating a large Lua string.

#### `display.draw_pixels(x, y, data, opts)`

Draws a raw RGB565 pixel buffer.

- `data` is either a Lua string containing at least `opts.width * opts.height * 2` bytes, or a `lightuserdata` pointer to a buffer of that size
- `opts` is required because raw buffers do not carry width or height metadata
- `opts.format`: `"rgb565"` or `"rgb565le"`; default is `"rgb565"`
- `opts.width`, `opts.height`: full source buffer size
- `opts.mode`: `"raw"`, `"fit"`, `"cover"`, `"stretch"`, or `"crop"`; default is `"raw"`
- `opts.dst_width`, `opts.dst_height`: destination size for stretch/cover/crop modes
- `opts.max_width`, `opts.max_height`: fit box; accepted as aliases for fit destination size
- `opts.source`: `{ x, y, width, height }` source rectangle. In raw mode this draws the source rectangle without scaling.
- Returns `output_w, output_h`

Examples:

```lua
display.draw_pixels(0, 0, rgb565_bytes, {
    format = "rgb565",
    width = 320,
    height = 240,
})

display.draw_pixels(0, 0, rgb565_bytes, {
    format = "rgb565",
    width = 320,
    height = 240,
    mode = "fit",
    max_width = display.width,
    max_height = display.height,
})

display.draw_pixels(0, 0, rgb565_bytes, {
    format = "rgb565",
    width = 320,
    height = 240,
    mode = "crop",
    source = { x = 40, y = 20, width = 160, height = 120 },
    dst_width = 320,
    dst_height = 240,
})
```

#### `display.draw_image(x, y, frame, opts)`

Draws an `image.frame` directly. The display module requests RGB565 from the
image module and borrows the buffer only during the C call, avoiding the large
Lua string copy caused by `frame:data()`.

`opts` is optional:

- `mode`: `"raw"`, `"fit"`, `"cover"`, `"stretch"`, or `"crop"`; default is `"raw"`
- `width`, `height`: destination size for fit/cover/stretch/crop modes
- `source`: `{ x, y, width, height }` source rectangle for crop/cover modes

Examples:

```lua
display.draw_image(0, 0, frame, {
    mode = "fit",
    width = display.width,
    height = display.height,
})

display.draw_image(0, 0, frame, {
    mode = "crop",
    source = { x = 20, y = 20, width = 160, height = 120 },
    width = 320,
    height = 240,
})
```

- Returns `output_w, output_h`
- The call is synchronous and does not retain the image buffer after returning

### Error behavior and constraints

- Most APIs raise Lua errors directly when arguments are invalid or the HAL returns an error
- Integer-only APIs reject non-integer Lua values
- File path validation is handled by the `image` module when loading or saving image files
- `draw_pixels(...)` rejects buffers that are too short
- `draw_text(...)` and `draw_text_aligned(...)` reject non-ASCII text

### Recommended usage pattern

For normal screen rendering:
1. Use `board_manager.get_display_lcd_params("display_lcd")`
2. Call `display.init(...)`
3. Call `display.begin_frame(...)`
4. Draw text, shapes, or images
5. Call `display.present()` or `display.present_full()`
6. Call `display.end_frame()`
7. Call `display.deinit()` before exit

### Example

```lua
local bm = require("board_manager")
local display = require("display")

local panel_handle, io_handle, width, height, panel_if =
    bm.get_display_lcd_params("display_lcd")

display.init(panel_handle, io_handle, width, height, panel_if)

display.begin_frame({ clear = true, color = "#0c1220" })

display.draw_rect(12, 12, display.width - 24, display.height - 24, { r = 80, g = 120, b = 160 })
display.fill_rect(20, 40, 80, 36, "#48d0eb")
display.draw_text(24, 90, "Lua Display Demo", {
    color = "#f5f4ee",
    font_size = 24,
})
display.draw_text_aligned(0, display.height - 24, display.width, 20, "frame api", {
    color = { r = 210, g = 220, b = 228 },
    font_size = 16,
    align = "center",
    valign = "middle",
})

display.present()
display.end_frame()
display.deinit()
```

<!-- doc: lua_module_lcd/README.md -->
<a id="lua-module-lcd-readme"></a>

## Lua LCD

`lcd` is a panel bring-up module. It can:
- Initialize an SPI or QSPI LCD panel from Lua
- Create and destroy the panel device handle
- Reset the panel
- Return panel metadata for logging and follow-up setup

### How to call

Lua name: `lcd`.
- Create a panel with `lcd.new(config)`
- Use the returned `panel_handle`, `io_handle`, `width`, `height`, and `panel_if` with `display.init(...)`
- Call `lcd.get_info(dev)` to inspect the created device
- Call `lcd.reset(dev)` when the panel needs to be reinitialized
- Call `lcd.delete(dev)` when finished

### Important rules

- `lcd.new(...)` only initializes the LCD bus, panel IO, and panel driver.
- This module does not manage backlight GPIO or brightness.
- If the board uses a dedicated backlight pin, control it separately with `gpio` or another module.
- The panel config must include `controller`, `bus`, `io`, `panel`, and `resolution` tables.
- `bus.mode` must be `"spi"` or `"qspi"`.
- `resolution.width` and `resolution.height` must be positive integers.
- `io.spi_mode` must be an integer in the range `0` to `3`.
- `panel.bits_per_pixel` currently accepts `16`, `18`, or `24`.
- QSPI is only valid for controllers that support it.

### Supported controllers

The current binding supports these `controller` names:
- `"gc9107"`
- `"gc9b71"`
- `"gc9d01"`
- `"nt35510"`
- `"co5300"`
- `"spd2010"`
- `"sh8601"`
- `"st7789"`
- `"st77916"`
- `"st77922"`

### Return values

`lcd.new(config)` returns:
- `dev`: the Lua LCD device userdata
- `panel_handle`: lightuserdata for the panel
- `io_handle`: lightuserdata for the panel IO
- `width`: panel width
- `height`: panel height
- `panel_if`: panel interface constant for `display.init(...)`

### Typical SPI example

```lua
local lcd = require("lcd")
local display = require("display")

local dev, panel_handle, io_handle, width, height, panel_if = lcd.new({
    controller = "st7789",
    bus = {
        host = 2,
        mode = "spi",
        sclk = 4,
        mosi = 5,
        max_transfer_sz = 6400,
    },
    io = {
        cs = 15,
        dc = 7,
        spi_mode = 0,
        pclk_hz = 40000000,
    },
    panel = {
        reset = 6,
        mirror_x = false,
        mirror_y = true,
        swap_xy = true,
        invert_color = true,
    },
    resolution = {
        width = 320,
        height = 240,
    }
})

local info = lcd.get_info(dev)
print(info.controller, info.width, info.height, info.bus_mode)

display.init(panel_handle, io_handle, width, height, panel_if)
```

### Config shape

#### `bus`

- `host`: required SPI host integer
- `mode`: optional, `"spi"` by default
- `sclk`: required clock GPIO
- `mosi`: required for SPI mode
- `data0`, `data1`, `data2`, `data3`: required for QSPI mode
- `max_transfer_sz`: optional; if omitted or `0`, the module derives a full-frame transfer size

#### `io`

- `cs`: required chip select GPIO
- `dc`: required in SPI mode
- `spi_mode`: optional SPI mode, default `0`
- `trans_queue_depth`: optional queue depth, default `10`
- `pclk_hz`: optional pixel clock; defaults depend on controller preset

#### `panel`

- `reset`: optional reset GPIO, default `-1`
- `color_space`: optional `"rgb"` or `"bgr"`
- `bits_per_pixel`: optional, defaults depend on controller preset
- `reset_active_high`: optional boolean, default `false`
- `x_gap`: optional integer, default `0`
- `y_gap`: optional integer, default `0`
- `mirror_x`: optional boolean, default `false`
- `mirror_y`: optional boolean, default `false`
- `swap_xy`: optional boolean, default `false`
- `invert_color`: optional boolean, default `false`
- `disp_on`: optional boolean, default `true`

#### `resolution`

- `width`: required integer
- `height`: required integer

### Device methods

#### `lcd.get_info(dev)`

Returns a table with:
- `controller`
- `width`
- `height`
- `panel_if`
- `bus_mode`
- `host`
- `initialized`

#### `lcd.reset(dev)`

Resets and reinitializes the panel.

#### `lcd.delete(dev)`

Deletes the panel, panel IO, and SPI bus resources owned by this device.

### Backlight note

If a script also needs visible output, initialize the board backlight separately before or after `lcd.new(...)`, depending on the panel wiring. A typical pattern is:

```lua
local gpio = require("gpio")
gpio.set_direction(16, "output")
gpio.set_level(16, 0)
```

That GPIO logic is board-specific and is not part of the `lcd` module itself.

<!-- doc: lua_module_lcd_touch/README.md -->
<a id="lua-module-lcd-touch-readme"></a>

## Lua LCD Touch

### How to call
Lua name: `lcd_touch`.
- Get a touch handle first, typically from `board_manager.get_lcd_touch_handle(...)`
- Call `lcd_touch.sync(touch_handle)` to synchronize the cached touch state
- Call `lcd_touch.read(touch_handle)` to read the current touch state
- Call `lcd_touch.poll(touch_handle)` to get edge-aware touch information such as `just_pressed`, `just_released`, `x`, `y`, `dx`, `dy`, and `held_ms`

### Example
```lua
local board_manager = require("board_manager")
local lcd_touch = require("lcd_touch")

local touch_handle = board_manager.get_lcd_touch_handle("lcd_touch")
lcd_touch.sync(touch_handle)
local touch = lcd_touch.poll(touch_handle)
if touch.just_pressed then
  print(touch.x, touch.y)
end
```

<!-- doc: lua_module_lvgl/README.md -->
<a id="lua-module-lvgl-readme"></a>

## Lua LVGL Usage Guide

This document is written for LLMs and Lua script generation. It explains how
to use the `lvgl` module exposed by `components/lua_modules/lua_module_lvgl`.

### Core Rules

- Import the module with `local lvgl = require("lvgl")`.
- Get display parameters with `board_manager.get_display_lcd_params("display_lcd")`, then call `lvgl.init(...)`.
- All widget operations are userdata methods. Use `btn:set_text("OK")`, not `lvgl.set_text(btn, "OK")`.
- Only one Lua script can own the LVGL runtime at a time. Do not use `display.init(...)` and `lvgl.init(...)` together.
- Call `lvgl.deinit()` before the script exits. The module also cleans up automatically if the owner script exits unexpectedly.
- Object handles become invalid after `obj:delete()`, after a parent object is deleted, or after `lvgl.deinit()`.
- After registering events, call `lvgl.run()` or repeatedly call `lvgl.process_events(...)`; otherwise Lua callbacks will not run.

### Minimal Example

```lua
local board_manager = require("board_manager")
local lvgl = require("lvgl")

local panel_handle, io_handle, width, height, panel_if =
    board_manager.get_display_lcd_params("display_lcd")

lvgl.init(panel_handle, io_handle, width, height, panel_if, {
    buffer_lines = 40,
    tick_ms = 5,
    task_period_ms = 10,
})

local scr = lvgl.create_screen()
scr:set_style({ bg_color = "#101820" })

local label = lvgl.label(scr, {
    text = "LVGL from Lua",
    align = "top_mid",
    y = 20,
    text_color = "#ffffff",
})

local btn = lvgl.button(scr, {
    text = "OK",
    align = "center",
    w = 120,
    h = 44,
    bg_color = "#2f80ed",
    text_color = "#ffffff",
})

btn:on("clicked", function()
    label:set_text("clicked")
end)

scr:load()
lvgl.run()
lvgl.deinit()
```

### Symbols (icons)

Built-in FontAwesome glyphs already embedded in Montserrat are exposed as
`lvgl.SYMBOL.<name>` (UTF-8 strings). Prefer these over emoji — missing
glyphs render as empty boxes ("tofu").

For large 1:1 launcher tiles, prefer `aiodi.svg_icon{name=, size=}` (generates
SVG Tiny under `icons/`, rendered by `lvgl.image`) over SYMBOL glyphs — the
default Montserrat size cannot grow with the cell. Requires `LV_USE_SVG` +
ThorVG.

```lua
local lvgl = require("lvgl")
-- ...
lvgl.label(scr, {
    text = lvgl.SYMBOL.wifi .. " Online",
    text_color = "#ffffff",
})
lvgl.button(scr, {
    text = lvgl.SYMBOL.refresh .. " Refresh",
})
```

Whitelist names: `ok`, `close`, `home`, `settings`, `refresh`, `wifi`,
`warning`, `power`, `play`, `pause`, `stop`, `next`, `prev`, `plus`,
`minus`, `up`, `down`, `left`, `right`, `list`, `bars`, `bell`,
`envelope`, `charge`, `gps`, `bluetooth`, `battery_full` … `battery_empty`,
`mute`, `volume_mid`, `volume_max`, `audio`, `video`, `image`, `tint`,
`eye_open`, `eye_close`, `download`, `upload`, `drive`, `directory`,
`file`, `save`, `edit`, `trash`, `cut`, `copy`, `paste`, `call`,
`keyboard`, `usb`, `sd_card`, `shuffle`, `loop`, `eject`, `backspace`,
`new_line`, `bullet`.

There is no sun/cloud weather glyph in this set — use ASCII labels.

### Init And Deinit

```lua
lvgl.init(panel_handle, io_handle, width, height, panel_if, opts)
```

Common `opts`:
- `buffer_lines`: draw buffer height in lines, default `40`
- `tick_ms`: LVGL tick period, default `5`
- `task_period_ms`: LVGL handler task period, default `10`

Shutdown:

```lua
lvgl.deinit()
```

The Shell-only `lvgl.tick_ms()` helper returns LVGL's monotonic millisecond
clock for frame-timed navigation; App sandboxes do not receive this entry.

### Touch Input

Register a touch panel as an LVGL input device:

```lua
local touch_handle, err = board_manager.get_lcd_touch_handle("lcd_touch")
if touch_handle then
    lvgl.indev_register("touch", touch_handle)
end
```

Unregister it before shutdown when needed:

```lua
lvgl.indev_unregister("touch")
```

`indev_register("touch", ...)` borrows the `esp_lcd_touch_handle_t`; it does
not free the underlying touch handle.

On the Guition P4, the GT911 controller has no usable interrupt GPIO. The
module therefore samples it in a dedicated core-0 polling task and hands
ordered `PRESS` / coalesced `MOVE` / `RELEASE` samples to LVGL through a fixed
queue. The Lua API remains unchanged, but a full display render can no longer
make a short physical swipe disappear before LVGL reads it.

If rendering falls behind far enough for a later physical press to arrive,
the sampler drops only completed, unread gestures and preserves any gesture
that LVGL has already started. This prevents stale input from replaying as an
unexpected second page change. A single failed GT911 I²C transaction holds the
last confirmed contact state for a three-sample (12 ms) grace interval; a
release is synthesized only after sustained failures, so transient bus noise
does not split one drag into two gestures.

### Event Loop

Register callbacks with `obj:on(event, callback)`:

```lua
local handle = btn:on("clicked", function()
    print("clicked")
end)
```

Remove callbacks:

```lua
btn:off(handle)      -- remove one callback handle
btn:off("clicked")  -- remove all callbacks for this event
btn:off()           -- remove all callbacks from this object
```

Supported event names:

`clicked`, `pressed`, `released`, `long_pressed`, `value_changed`,
`focused`, `defocused`, `ready`, `cancel`

Drive the event loop:

```lua
lvgl.run()
```

Or:

```lua
while true do
    lvgl.process_events(50)
    -- run other periodic Lua-side work here
end
```

### Widget Constructors

All constructors follow the same basic shape:

```lua
local obj = lvgl.widget(parent, opts)
```

Basic widgets:

- `lvgl.object(parent, opts)`
- `lvgl.container(parent, opts)`
- `lvgl.label(parent, opts)`
- `lvgl.button(parent, { text = "OK" })`
- `lvgl.bar(parent, { min = 0, max = 100, value = 50 })`
- `lvgl.slider(parent, { min = 0, max = 100, value = 50 })`
- `lvgl.arc(parent, opts)`
- `lvgl.scale(parent, opts)`
- `lvgl.checkbox(parent, { text = "Enable", checked = true })`
- `lvgl.switch(parent, { checked = true })`
- `lvgl.dropdown(parent, { options = {"A", "B"}, selected = 1 })`
- `lvgl.roller(parent, { options = {"A", "B"}, selected = 1 })`
- `lvgl.keyboard(parent, { mode = "text_lower", textarea = textarea })`
- `lvgl.textarea(parent, { text = "..." })`
- `lvgl.list(parent, opts)`
- `lvgl.table(parent, opts)`
- `lvgl.image(parent, { src = "S:/path.bin" })`
- `lvgl.line(parent, { points = {{x=0,y=0}, {x=20,y=20}} })`
- `lvgl.spinner(parent, { anim_ms = 1000, arc_sweep = 60 })`
- `lvgl.buttonmatrix(parent, { map = {"1", "2", "\n", "3"}, one_checked = true })`
- `lvgl.calendar(parent, { today = {2026, 5, 15}, shown = {2026, 5}, highlighted = {{2026, 5, 15}} })`
- `lvgl.canvas(parent, { w = 80, h = 40, color_format = "rgb565" })`
- `lvgl.chart(parent, { type = "line", point_count = 10, min = 0, max = 100, update_mode = "shift" })`
- `lvgl.imagebutton(parent, { src = "S:/path.bin" })`
- `lvgl.led(parent, { color = "#00ff00", brightness = 180, on = true })`
- `lvgl.menu(parent, opts)`
- `lvgl.msgbox(parent_or_nil, { title = "...", text = "...", buttons = {"OK"}, close_button = true })`
- `lvgl.spangroup(parent, { mode = "break", overflow = "ellipsis", spans = {"A", "B"} })`
- `lvgl.spinbox(parent, { min = 0, max = 100, value = 10, step = 1 })`
- `lvgl.tabview(parent, { tab_bar_position = "top", tab_bar_size = 36 })`
- `lvgl.tileview(parent, opts)`
- `lvgl.window(parent, opts)`

Lua index convention:
- dropdown/roller selected indexes are 1-based
- table rows and columns are 1-based
- buttonmatrix selected indexes are 1-based
- tabview active indexes are 1-based
- tileview `col` and `row` are 1-based

### Common Options

Most widgets support:

- Position and size: `x`, `y`, `w`, `h`, `align`
- Text: `text`
- Numeric values: `min`, `max`, `value`
- Style: `bg_color`, `text_color`, `text_align`, `border_color`, `bg_opa`, `opa`, `opa_layered`,
  `radius`, `border_width`, `pad`, `pad_row`, `pad_column`,
  `line_color`, `line_width`, `arc_width`, `font`

`opa_layered` applies opacity to the widget as a render layer. `0` makes LVGL
skip that widget subtree without changing its layout; use it for fixed,
overlapping renderer-only layers rather than using `hidden` when layout must
remain stable.

`text_align` accepts `left`, `center`, or `right`. Combine it with fixed `w`
and `h` on a label whose text changes frequently; LVGL then updates the glyphs
without re-running content-size layout for the whole screen.

Colors can be strings or numbers:

```lua
bg_color = "#2f80ed"
text_color = 0xffffff
```

### Runtime TTF Fonts

When LVGL `tiny_ttf` is enabled, fonts can be loaded from the DATA root at
runtime:

```lua
local storage = require("storage")
local lvgl = require("lvgl")

local font_path = storage.join_path(storage.get_root_dir(), "fonts/NotoSansSC-Regular.ttf")
local font = lvgl.font_load(font_path, { size = 24, cache_size = 128 })
label:set_style({ font = font })
```

- `lvgl.font_load(path, { size = px, cache_size = n })` -> font handle
- `font:set_size(px)`
- `font:is_valid()` -> boolean
- `font:glyph_bounds(one_codepoint)` -> `advance, box_w, box_h, offset_x, offset_y, base_line`
- `font:delete()`

The direct Shell Runner also configures the DATA root before calling
`luaopen_lvgl`, so runtime TTF loading remains available when the optional
`app_claw` startup path is unavailable.

Font paths must be relative to or under the DATA root. The font file must
remain available while any LVGL object uses the font.

### Common Methods

All LVGL object userdata supports:

- `obj:set_pos(x, y)`
- `obj:get_pos()` -> `x, y`
- `obj:get_coords()` -> absolute `x, y, w, h` in display coordinates
- `obj:set_size(w, h)`
- `obj:get_size()` -> `w, h`
- `obj:set_frame(x, y, w, h, radius)` -> atomically updates position, size,
  and rounded clipping; intended for high-frequency transition surfaces
- `obj:set_transform(scale_x, scale_y, pivot_x, pivot_y)` -> applies a 2D
  transform; LVGL scale `256` is identity and the pivot is in local pixels
- `obj:set_clickable(bool)`
- `obj:align(name[, x, y])`
- `obj:is_valid()` -> boolean
- `obj:set_style(opts)`
- `obj:set_flex(opts)`
- `obj:set_grid(opts)`
- `obj:set_grid_cell(opts)`
- `obj:set_scroll(opts)`
- `obj:set_scroll_snapshot_layers({ live = {...}, snapshots = {...}, overlays = {...}, page_width = N[, page_indicators = {...}] })`
- `obj:on(event, callback)`
- `obj:off([handle_or_event])`
- `obj:delete()`
- `obj:clean()`

Common `align` names:

`top_left`, `top_mid`, `top`, `top_right`, `bottom_left`, `bottom_mid`,
`bottom`, `bottom_right`, `left_mid`, `left`, `right_mid`, `right`,
`center`, `centre`

### Layout And Scrolling

Flex:

```lua
obj:set_flex({
    flow = "column",
    main = "start",
    cross = "center",
    track = "start",
})
```

`flow`: `row`, `column`, `row_wrap`, `row_reverse`, `row_wrap_reverse`,
`column_wrap`, `column_reverse`, `column_wrap_reverse`

`main/cross/track`: `start`, `center`, `end`, `space_between`,
`space_around`, `space_evenly`

Grid:

```lua
obj:set_grid({
    cols = {"fr", "fr"},
    rows = {"content", 40},
    col_align = "stretch",
    row_align = "start",
})
```

Scroll:

```lua
obj:set_scroll({
    dir = "ver",
    scrollbar = "auto",
    snap_x = "none",
    snap_y = "none",
})
```

`dir`: `none`, `left`, `right`, `top`, `bottom`, `hor`, `ver`, `all`

`set_scroll_snapshot_layers` is for a prepared pager whose `live`,
`snapshots`, and `overlays` layers each have matching 1..8 entries plus a
`page_width`. At rest, only the selected live layer renders, so dynamic values
stay current without compositing a full bitmap underneath; the selected layer
is moved to the front of its fixed input overlay. Before the first drag delta,
the binding makes `snapshots` and their small moving `overlays` visible while
suppressing the full live page tree.
After the final settle it restores the selected live layer and hides the
overlay. This avoids full-page redraws during motion without taking a new
full-page snapshot for every timer update. A new drag or a replacement animated
scroll continues from its current offset, and Lua `scroll_end` callbacks are
deferred until final completion. All three tables must contain distinct valid
LVGL objects for the pager lifetime.

An optional `page_indicators` table lets this native path animate pager markers
from the exact scroll offset without issuing a Lua callback per frame:

```lua
page_indicators = {
    dots = { dot1, dot2, dot3 }, -- one marker for each page
    pager = marker_container,
    hit_width = 20,
    idle_width = 6,
    active_width = 18,
    height = 6,
    active_color = "#ffffff",
    idle_color = "#666666",
}
```

The binding keeps each marker's layout size fixed and uses a draw-only width
transform plus colour interpolation, so a drag or an interrupted release snap
continues from the current position without making the page layout dirty.

### Type-Specific Methods

Basic methods:

- `label/button/checkbox/dropdown/textarea/list_text/list_button:set_text(text)`
- `bar/slider/arc/scale/dropdown/roller/checkbox/switch/spinbox:set_value(v[, anim])`
- `bar/slider/arc/scale/spinbox:get_value()`
- `bar/slider/arc/scale/spinbox:set_range(min, max)`
- `arc:set_bg_angles(start, end)` updates the decorative arc span in place
- `screen:load()`
- `list:add_text(text)` -> `list_text`
- `list:add_button(text[, symbol])` -> `list_button`
- `table:set_cell(row, col, text)`
- `table:get_cell(row, col)` -> string
- `buttonmatrix:set_map(map)`
- `buttonmatrix:set_selected(index)`
- `buttonmatrix:get_selected()` -> index or nil
- `buttonmatrix:get_button_text(index)` -> string
- `buttonmatrix:set_one_checked(bool)`
- `calendar:set_today(y, m, d)`
- `calendar:set_shown(y, m)`
- `calendar:set_highlighted({{y,m,d}, ...})`
- `calendar:get_pressed_date()` -> `{year, month, day}` or nil
- `canvas:fill_bg(color[, opa])`
- `canvas:set_px(x, y, color[, opa])`
- `canvas:get_px(x, y)` -> `{r, g, b, a}`
- `chart:add_series(color[, axis])` -> series handle
- `chart:set_type(type)`
- `chart:set_point_count(n)`
- `chart:set_range(min, max[, axis])`
- `chart:set_next_value(series, value)`
- `chart:set_series_values(series, values)`
- `chart:refresh()`
- `imagebutton:set_src(state, mid[, left, right])`
- `imagebutton:set_state(state)`
- `led:set_color(color)`
- `led:set_brightness(v)`
- `led:get_brightness()` -> integer
- `led:on()`, `led:off()`, `led:toggle()`
- `menu:page(title)` -> page
- `menu:cont(parent)` -> cont
- `menu:section(page)` -> section
- `menu:separator(page)` -> separator
- `menu:set_page(page)`
- `menu:set_sidebar_page(page)`
- `menu:set_mode_header(mode)`
- `menu:set_root_back_button(bool)`
- `menu:clear_history()`
- `msgbox:add_title(text)`
- `msgbox:add_text(text)`
- `msgbox:add_footer_button(text)`
- `msgbox:add_close_button()`
- `msgbox:close()`
- `msgbox:close_async()`
- `spangroup:add_span(text[, style])` -> span handle
- `spangroup:get_span_count()` -> integer
- `spangroup:refresh()`
- `span:set_text(text)`
- `span:get_text()` -> string
- `span:set_style(opts)`
- `span:delete()`
- `spinbox:set_step(v)`
- `spinbox:get_step()` -> integer
- `spinbox:increment()`
- `spinbox:decrement()`
- `spinbox:step_next()`
- `spinbox:step_prev()`
- `tabview:add_tab(name)` -> tab page
- `tabview:set_active(index[, anim])`
- `tabview:get_active()` -> index
- `tabview:get_tab_count()` -> integer
- `tabview:set_tab_text(index, text)`
- `tileview:add_tile(col, row, dir)` -> tile
- `tileview:set_tile(tile[, anim])`
- `tileview:set_tile_by_index(col, row[, anim])`
- `tileview:get_active_tile()` -> tile or nil
- `window:add_title(text)` -> label
- `window:add_button(icon[, width])` -> button
- `window:get_header()` -> object
- `window:get_content()` -> object
- `canvas.color_format`: `rgb565`, `rgb888`, `xrgb8888`, `argb8888`, `native`
- `chart.type`: `none`, `line`, `curve`, `bar`, `stacked`, `scatter`
- `chart.update_mode`: `shift`, `circular`
- `chart` axis: `primary_y`, `y`, `secondary_y`, `primary_x`, `x`, `secondary_x`
- `imagebutton` state: `released`, `pressed`, `disabled`,
  `checked_released`, `checked_pressed`, `checked_disabled`
- `spangroup.mode`: `fixed`, `expand`, `break`
- `spangroup.overflow`: `clip`, `ellipsis`
- `menu` header mode: `top_fixed`, `top_unfixed`, `bottom_fixed`
- Direction values: `none`, `left`, `right`, `top`, `bottom`, `hor`, `ver`, `all`

### Limitations

- Encoder/keypad indevs are not exposed yet.
- Image decoders and general filesystem setup are not wrapped.
- `lvgl.image(...)` and `lvgl.imagebutton(...)` only pass string `src` values
  to LVGL. Whether those strings load depends on firmware FS/decoder setup.
- Canvas support covers buffer allocation, background fill, and pixel read/write only. Advanced draw layers are not wrapped.
- Chart cursors and other advanced chart APIs are not wrapped.
- Span handles and chart series handles are not LVGL objects; they do not support object base methods such as `set_pos`, `set_style`, or `delete`.
- Non-ASCII text rendering depends on either firmware-enabled fonts or a
  runtime TTF font applied with `font`.

### Test Scripts

Directory: `components/lua_modules/lua_module_lvgl/test/`

- `lvgl_basic.lua`: basic display and widgets
- `lvgl_events.lua`: event callbacks and `process_events`
- `lvgl_indev.lua`: touch indev registration/unregistration
- `lvgl_demos.lua`: demo wrapper
- `lvgl_widgets_test.lua`: full widget test, touch-enabled when available, 60-second interactive window

<!-- doc: lua_module_lvgl/lib/aiodi.md -->
<a id="lua-module-lvgl-lib-aiodi"></a>

## aiodi

`aiodi` is the AIODI design system for the Open DeskOS on-device LVGL/Lua OS
shell: one source of truth for the AIODI palette, spacing, radius, and type
scale, plus reusable component builders on top of `lvgl`.

Load it with:

```lua
local aiodi = require("aiodi")
local lvgl = require("lvgl")
```

Design reference: Figma "AIODI / OS - Final" (file `aCjWcJawjHWCqXXxFVckjS`).
Target panel: Guition JC4880P443C, 480x800 portrait.

Two sizing worlds live here, deliberately:

- `space` / `radius` / `text` are authored **directly in device px** for
  480x800 (no implicit @2x).
- The **widget grid** (`ref` / `scale` / `px` / `grid_metrics` / `tile`) is
  authored on the Figma **320x480 reference canvas** and scaled onto whatever
  panel is running. Nothing in it is a device constant.

Every builder returns the created `lvgl` widget so you can chain, wire events
(`widget:on(...)`), or style it further.

### Tokens

#### `aiodi.colors`

Lowercase `#rrggbb` strings (what the `lvgl` style parser expects).

- `bg` `#000000` — screen background (Figma token).
- `surface` `#171717` — card / tile / row fill (Figma token, measured off
  `Homepage / #1`).
- `elevated` `#1f1f1f` — raised tiles / widgets (derived; currently unused).
- `button` `#383838` — neutral button / chip / num-pad key (Figma token).
- `stroke` `#383838` — Card Stroke: every AIODI tile is outlined (Figma token).
- `stroke_focus` `#b5b5b5` — focused tile ring (Figma token).
- `primary` `#ffffff` — primary text (Figma token).
- `secondary` `#706f70` — secondary / caption text (Figma token).
- `red` `#eb5757`, `green` `#34c759`, `blue` `#025bc2` — accents (Figma tokens).

> These values are the single source for the voice-UI system prompt and its
> linter palette. `scripts/gen_tokens.lua` requires `aiodi.lua` and emits
> `aiodi_tokens.h` (C macros consumed byte-identically by `odk_voice_ui.c`
> and `sim_voice_ui.c`) plus `aiodi_tokens.css` (web). Re-run the generator
> after changing a color - the three no longer drift by hand.

#### `aiodi.space` / `aiodi.radius` / `aiodi.text`

- `space` = `{ xs=4, sm=8, md=16, lg=24, xl=40 }`
- `radius` = `{ sm=8, md=16, lg=24, pill=999 }`
- `text` = `{ caption=20, body=28, title=40, display=96, mega=180 }` (px)
- `chrome` = `{ header_h=56, back_w=136, back_h=48 }` - device-px frame
  dimensions for `aiodi.app` (header height, back button size). Named, not
  magic.

Only `text.body` (28) renders with the built-in font — and only because the
board pins `CONFIG_LV_FONT_DEFAULT_MONTSERRAT_28`. Every other size needs a
font object loaded via `aiodi.font(size)` and passed as `opts.font`.

1:1 launcher tiles and status-bar glyphs use `aiodi.icon_label{name=, size=}`
— a label rendered from the **Font Awesome 6 Free Solid** subset font
(`fonts/fa-icons.ttf`, hb-subset of 13 glyphs), one solid colour each
(`opts.color`, default `primary`). Size ≈ 50% of the cell on home tiles
(user-tuned: 88% → 60% → 50%). SVG icons are NOT used: the LVGL
SVG→ThorVG software vector path (`lv_draw_sw_vector`) renders blank on the
P4 (decoder parses/sizes correctly, drawing is empty), and `<g transform>`
scaling is ignored by the parser. `aiodi.svg_icon` remains for compatibility
but launcher no longer calls it.
Mapped `name`s → FontAwesome codepoints: `mail`=F0E0 envelope,
`calendar`/`events`=F133, `settings`=F013 gear, `tasks`=F046 check square,
`hourglass`/`focus`=F254, `bell`=F0F3, `bolt`=F0E7 lightning, `dice`=F522,
`droplet`=F043, `star`=F005, `leaf`=F06C, `habit`=F0C2 cloud, `link`=F0C1,
`radar`=F0E7 (bolt), `arrow-big-left`=F060, `caret-left`=F0D9.
Adding a new icon: add the glyph to `fa-icons.ttf` with hb-subset (never
fontTools — it emits broken TTFs on macOS), then extend `FA_GLYPHS` in
`aiodi.lua`.

### Reference canvas — `aiodi.ref` / `scale` / `px` / `grid_metrics`

`aiodi.ref` holds every number measured off the Figma home screen at 320x480:
`w/h`, `cell` 96, `gutter` 16, `bar_h` 48, `radius` 20, `stroke` 2, plus
`ring`, `text` and `bar` sub-tables. The `bar` group includes the indicator
dot, active-pill, gap, and touch-slot metrics. Nothing else in the grid is a
constant.

- `aiodi.scale(w, h)` — uniform **fit** scale onto the live panel (defaults to
  `_G.WIDTH`/`_G.HEIGHT`). Takes the smaller of the two ratios, so a short
  panel never overflows; used by `px()` for fonts/splash/ring. The home grid
  does **not** use this for layout — see `grid_metrics`.
- `aiodi.px(v, w, h)` — scale one reference number to device px.
- `aiodi.grid_metrics(w, h)` — the whole grid geometry. The standard portrait
  panel uses `cols`/`rows` 3x4; compact panels at or below 320px on either axis
  use 2x2 and reject layouts that require larger spans.
  `cell` (always 1:1), `gutter` (identical on both axes), `status_h` (top
  bar), `peek_h` / `peek_pad` / `peek_inset` (bottom fullscreen-app peek
  strip + in-card margin), `w`, `h`, `radius`, `stroke`, and `x`/`y` (grid
  origin under the status bar). Leftover height goes into the peek strip.
  Memoized for the default panel size. In landscape (`w > h`, e.g. 928×262
  touch bar) returns a provisional 4-slot row with a 28px status bar
  (`orientation = "landscape"`); portrait is the only live path today
  (landscape panel not yet available, sim dual-target NT-2 pending).

At 480x800 this yields cell ~131, gutter 24, status_h 72, peek_h 108,
peek_pad 24. At 320x480 it collapses to 1:1 with the Figma board.

### `aiodi.font(size, opts)` / `aiodi.font_bold(size, opts)`

Load a TTF at `size` px, relative to the writable data root. Returns the font
object, or `nil` if font loading is unavailable — callers should fall back to
the inherited default font. `opts` is merged into the load config (e.g.
`{ cache_size = 16 }` for a digits-only label; the default is 256 glyphs).

- `font` → `aiodi.font_path`, `fonts/NotoSansSC-Regular.ttf`: CJK-capable but
  **Regular only**, and carries no FontAwesome glyphs.
- `font_bold` → `aiodi.font_bold_path`, `fonts/Montserrat-Bold.ttf`: the heavy
  weight the AIODI numerals are drawn in, **Latin/digits only** — never pass
  Chinese text to a label styled with it.

Handles are cached per `path:size`, so both faces can coexist at one size.

### Component builders

All `opts` are optional and override the AIODI defaults. Layout is done with an
`opts.flex = { flow=, main=, cross=, track= }` sub-table where supported.

- `aiodi.screen(opts)` — full-screen root painted with `colors.bg`. Override
  with `opts.bg_color`.
- `aiodi.load_anim(screen, anim, ms[, delay, auto_del])` — animated screen load
  (wraps the
  binding's `screen:load_anim`); falls back to a hard `screen:load()` if the
  anim binding is absent or errors, so navigation never dead-ends. `anim`
  defaults to `"fade"`; `ms` defaults to 250. `auto_del` asks LVGL to delete
  the previous screen after the transition.
- `aiodi.transition` — `{ splash=350, app_open=140, app_close=100, hero_open=180,
  hero_close=180 }` (ms). `app_open`/`app_close` drive the native App slide
  transitions; the `hero_*` tokens are retained for compatibility but unused by
  the current slide-only navigator.
- `aiodi.card(parent, opts)` — rounded surface container: `surface` fill,
  `radius.lg`, `space.md` padding, outlined (`colors.stroke` at the tile stroke
  weight, matching Figma Card Stroke). Pass `opts.flex` to lay out children.
- `aiodi.meter(parent, opts)` — Year / quota progress meter: ash track,
  clipped fill (square trailing edge), overlaid `label` + `value`. Required
  `w`/`h`/`pct`; optional `fill`, `font`, `radius` (default pill),
  `chrome` (`center`|`space_between`), `pad_x`. Returns
  `{ fill, value, track_w, bar_h }` for live updates.
- `aiodi.tile(parent, opts)` — the outlined rounded surface the home widget
  grid is built from: `surface` fill, `radius`/`border_width` from
  `grid_metrics()`, `colors.stroke` outline. `opts.col`/`opts.row` are
  **1-based** grid cells and `opts.col_span`/`opts.row_span` default to 1 —
  the size is derived, so never hand-compute a spanned width. Pass
  `opts.on_click` to make it tappable (it then becomes a button: the binding
  cannot clear `LV_OBJ_FLAG_CLICKABLE`, so a container's clickability is not
  worth betting navigation on). Requires a parent with `set_grid`.
- `aiodi.grid(parent, metrics)` — home grid using the supplied
  `grid_metrics()` result. Use this for every grid-based home page so spans,
  and let the board-sized metrics select the compact 2x2 geometry on S3.
  gutters, and overflow behavior stay identical to Homepage/#1. The supplied
  metrics are 3x4 on the P4 and 2x2 on the compact S3 panel.
- `aiodi.statusbar(parent, opts)` — transparent row, `space_between` / center by
  default; for a top/bottom dock of icons + time in secondary text.
- `aiodi.clock(parent, opts)` — big-numeral label (`primary`, default text
  `"00:00"`, default `text_align = "left"` so numerals hug the left edge of
  their flex cell like meter-row labels). Pass `opts.font =
  aiodi.font(aiodi.text.display)` for real size; pass `text_align = "center"`
  for a full-tile clock (e.g. the status-bar time).
- `aiodi.fit_bold_text{ text=, width=, padding=, max_size=, min_size= }` —
  construction-time text-layout harness for fixed numeric boxes. It measures
  the real loaded Montserrat Bold glyphs, selecting a cached font that fits the
  available width; use a widest representative probe such as `"88:88"`.
  It returns `{ font, size, width, line_height, available_width }` and must not
  be called from per-frame or per-second paint paths.
- `aiodi.title(parent, opts)` — primary-color text label.
- `aiodi.caption(parent, opts)` — secondary-color text label.
- `aiodi.app_icon(parent, opts)` — square launcher tile (button). `opts.size`
  sets both edges (default 88); `opts.text` is the glyph (use `ICONS.*`);
  `opts.accent` overrides the tile fill.
- `aiodi.app_frame(parent, opts)` — full-screen black App shell attached to an
  existing screen. Returns `(frame, content)`; `opts.title`/`opts.on_back` own
  the shared header. Its Back control uses a Tabler filled leading arrow, a
  geometrically centered label, and a fill-only native press acknowledgement.
  The Shell keeps this frame full-size and uses a solid
  surface cover to expand from a home Tile or Peek rectangle, so live text and
  controls are never visibly compressed.
- `aiodi.app(opts)` — creates a screen, mounts one `app_frame`, and returns
  `(screen, content)`. The Shell presents that screen with `load_anim`.
- `aiodi.list_row(parent, opts)` — full-width rounded surface row (`radius.md`,
  height 64). If `opts.text` is given a primary label is embedded and the row
  is returned; otherwise add children to the returned handle.
- `aiodi.empty(parent, opts)` / `aiodi.loading(parent, opts)` /
  `aiodi.error(parent, opts)` - centered state placeholder: an optional
  `opts.icon` (an SVG `name`) above `opts.text`. `error` uses accent red; the
  others secondary grey. Pass `opts.w`/`opts.h` (the content area) so the
  placeholder centers within it. Replaces ad-hoc error captions.
- `aiodi.button(parent, opts)` — pill button (`radius.pill`). `opts.accent`
  picks the fill (default the neutral `button` token); `opts.text` is the label.
  Its `pressed_bg_opa` defaults to `176`, a fill-only press state that preserves
  button geometry; callers may override it for a different acknowledgement.

### Typical pattern

```lua
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local scr = aiodi.screen()
local bar = aiodi.statusbar(scr, { w = WIDTH, h = 40 })
aiodi.caption(bar, { text = ICONS.wifi .. " AIODI" })
aiodi.caption(bar, { text = ICONS.battery_3 .. " 73%" })
aiodi.clock(scr, { text = "22:32", font = aiodi.font(aiodi.text.display),
                   align = "center" })
scr:load()
```

### Practical rules

- Use the tokens (`aiodi.colors` / `space` / `radius` / `text`) instead of
  inline hex or magic numbers, so every screen stays on-system.
- Do not double-lock sizes: let a card size to its flex parent rather than
  fixing both. Pass `w`/`h` only where a fixed size is intentional.
- Big numerals (`text.title` and up) require a loaded font — never assume the
  default 28 px font scales.
- `opts` tables are consumed in place (helper keys like `size`, `accent`,
  `text`, `flex` are stripped before reaching `lvgl`); pass fresh table
  literals rather than reusing one table across builders.

<!-- doc: lua_module_lvgl/lib/almanac.md -->
<a id="lua-module-lvgl-lib-almanac"></a>

## almanac

This library calculates the Hong Kong Chinese almanac. It converts Gregorian dates to lunar dates. It supplies stems, branches, zodiac, activity tables and solar terms.

### API

- `almanac.today()` — full almanac for today
- `almanac.almanac(year, month, day)` — full almanac for a given date
- `almanac.lunar_date(year, month, day)` — lunar date info only
- `almanac.year_ganzhi(year, month, day)` — year stem/branch/zodiac (lichun-aware)
- `almanac.month_ganzhi(year, month, day, year_stem)` — month stem/branch
- `almanac.day_ganzhi(year, month, day)` — day stem/branch
- `almanac.yi_ji(branch)` — auspicious and avoided activities for a day branch
- `almanac.chong(branch)` — conflicting zodiac animal
- `almanac.get_solar_term(year, month, day)` — solar term name or nil
- `almanac.weekday_name(year, month, day)` — Chinese weekday name
- `almanac.is_leap_year(year)` — Gregorian leap year check

### Almanac table fields

| field | description |
|---|---|
| `gregorian` | `{year, month, day}` |
| `lunar.year` | lunar year number |
| `lunar.month` | lunar month number (1-12) |
| `lunar.day` | lunar day number (1-30) |
| `lunar.leap` | boolean, is leap month |
| `lunar.month_name` | e.g. `"正月"`, `"閏二月"` |
| `lunar.day_name` | e.g. `"初一"`, `"十五"` |
| `lunar.year_ganzhi` | e.g. `"丙午"` |
| `lunar.month_ganzhi` | e.g. `"丁酉"` |
| `lunar.day_ganzhi` | e.g. `"壬子"` |
| `lunar.zodiac` | e.g. `"馬"` |
| `solar_term` | string or nil |
| `chong` | e.g. `"沖馬"` |
| `yi` | array of auspicious activities |
| `ji` | array of inauspicious activities |

### Coverage

Lunar data covers 2024-2043. The activity table uses a simplified day-branch rule.
Solar terms use approximate dates.

<!-- doc: lua_module_lvgl/lib/config/desktop_layout.md -->
<a id="lua-module-lvgl-lib-config-desktop-layout"></a>

## config.desktop_layout

Declarative configuration specification for Open DeskOS desktop pages and widgets.

<!-- doc: lua_module_lvgl/lib/core/dashboard_engine.md -->
<a id="lua-module-lvgl-lib-core-dashboard-engine"></a>

## core.dashboard_engine

Dynamic Dashboard flow composer collecting narrative metrics from registered plugins.

### Methods

- `render_page(parent, g, host_ctx)`: Builds natural-language left-aligned dashboard stream.

<!-- doc: lua_module_lvgl/lib/core/desktop_composer.md -->
<a id="lua-module-lvgl-lib-core-desktop-composer"></a>

## core.desktop_composer

Declarative desktop layout composer and page-scoped tick dispatcher.

### Methods

- `compose(pages_list, layout_spec, host_ctx)`: Assembles all pages and multi-size widgets from declarative layout specification.

<!-- doc: lua_module_lvgl/lib/core/hero_navigator.md -->
<a id="lua-module-lvgl-lib-core-hero-navigator"></a>

## core.hero_navigator

Geometric hero transition and App Runtime lifecycle manager.

### Methods

- `init(shell_root)`: Initialize navigator with shell screen.
- `open_app(app_id, source_rect)`: Animate hero expansion and load fullscreen App.
- `request_dismiss()`: Queue app dismiss for next tick.
- `go_home()`: Reverse hero animation back to home widget.
- `on_tick(now_ms)`: Drive transition interpolation and active app ticks.
- `is_active()`: Check if transition or app is currently active.
- `is_in_app()`: Check if fully inside an App.
- `get_active_app()`: Get currently active App ID.

<!-- doc: lua_module_lvgl/lib/core/pager.md -->
<a id="lua-module-lvgl-lib-core-pager"></a>

## core.pager

Multi-page horizontal container, page indicators, and snapshot scrolling manager.

### Methods

- `create(parent, page_count, dots_parent)`: Create pager root and horizontal pages.
- `paint_page_dots(n)`: Update status-bar dot active indicator.
- `go_page(n, anim)`: Scroll to page index `n`.
- `refresh_page_snapshot(i)`: Pre-render RGB565 snapshot of page `i`.
- `prepare_page_snapshots()`: Pre-render snapshots for all pages.
- `on_scroll_end()`: Scroll settle callback.
- `current()`: Get current page index.
- `count()`: Get total page count.

<!-- doc: lua_module_lvgl/lib/core/plugin_registry.md -->
<a id="lua-module-lvgl-lib-core-plugin-registry"></a>

## core.plugin_registry

Central registry and catalog for Open DeskOS plugins and extensions.

### Methods

- `register(spec)`: Register a plugin table.
- `get(id)`: Lookup a registered plugin by ID.
- `list()`: Returns all registered plugins.
- `get_widget(id, size)`: Retrieve widget builder for plugin and size.
- `get_app(id)`: Retrieve app definition.
- `get_dashboard_providers()`: Return active dashboard metric providers.
- `get_peek_provider(id)`: Return active peek provider.
- `unregister(id)`: Remove a plugin.
- `clear()`: Reset registry.

<!-- doc: lua_module_lvgl/lib/core/widget_engine.md -->
<a id="lua-module-lvgl-lib-core-widget-engine"></a>

## core.widget_engine

Widget layout, sizing calculation, and lifecycle instantiation engine.

### Methods

- `parse_size(size_str)`: Parses size string (e.g. "2x1") into `col_span, row_span`.
- `calculate_rect(g, col, row, col_span, row_span)`: Calculates physical pixel rectangle `{ x, y, w, h }`.
- `create_widget(parent, item, host_ctx)`: Instantiates a multi-size widget and attaches lifecycle callbacks.

<!-- doc: lua_module_lvgl/lib/dashboard_layout.md -->
<a id="lua-module-lvgl-lib-dashboard-layout"></a>

## dashboard_layout

Shared adaptive Dashboard layout engine used by the launcher and the runnable
native-SDL host harness.

### Purpose

The daily-plan Dashboard is a measured layout, not a fixed screenshot. Every
refresh starts with current values, measures real TTF glyphs, and creates a
small render plan that keeps every visible line inside the 480px P4 canvas.
Every Dashboard narrative line preserves the same large 26-unit reference type
scale. A continuous measured semantic flow fills each row before moving to the
next; no row changes size.

### Data model

`runtime_values` is the default daily-plan fixture:

```text
You have 99 events,
[tasks] 99 tasks and
[habit] 99 habits today. You're
mostly free after 4 pm. [focus] 99 focus
```

Every narrative line is naturally left aligned. Its fragments use measured
widths and exactly one measured prose-font word space; unused line width
remains at the end of the line rather than being distributed after commas,
periods, or words. The opening `You have 99 events,` sentence retains its
inline calendar icon and remains on one 480px line at the shared scale.

`events`, `tasks`, `habit`, and `focus` are intentional default placeholders
until their data bridges exist; Focus remains interactive and opens Pomodoro.
Events, tasks, habits, and Focus all retain their inline FontAwesome icons.
The inline symbols use the measured 20-unit icon scale and only consume their
measured glyph bitmap width plus a 2px icon/text gap, not a fixed oversized
slot, so continuous flow retains useful adjacent prose while text remains at
its shared scale. `small_values` keeps the earlier low-count fixture for
preferred-scale coverage;
`extreme_values` exercises semantic reflow and a single unbreakable focus
value.

### Adaptive planning contract

`plan(metrics, values)` appends declared semantic groups to the current line
at `preferred_text_size` (26 reference units). A group moves to the next line
only when appending it would exceed the canvas; it is never word-wrapped or
arbitrarily cut. This avoids template-shaped holes: if `[habit] 99 habits` and
`today. You're` fit together, they share the line. The `and` group stays with
`[tasks] 99 tasks`.

If a single semantic group exceeds the available width, the planner abbreviates
its longest atom with `...` at the same shared size rather than clipping it.
The host harness also proves that every line break is necessary by trying to
append the next group; a break that still fits fails the test.

Small-count, default 99-count, and extreme fixtures all keep the shared
preferred size. The renderer cleans and rebuilds the plan box only when the
data signature changes, so stale row widgets cannot overlap the new structure.

### API

- `build_metrics(aiodi, width, height)` — load icon geometry and initialize
  font caches for a canvas.
- `font_metrics(metrics, size)` — load measured regular/bold typography and
  derive their shared physical baseline.
- `metric_measure(metrics, fonts, key, text)` — measure a metric label at the
  shared scale; callers add an icon slot only when the template requests one.
- `plan(metrics, values)` — flow measured semantic groups into the fewest safe
  lines for current values.
- `inline_icon_frame(metrics, fonts, icon_name)` — calculate the actual glyph
  frame inside a metric.
- `values_signature(values)` — stable signature used to skip unchanged redraws.
- `validate(metrics)` — verify small-count, default 99-count, and extreme
  plans, including shared type scale, line width, vertical budget, icon bounds,
  and baseline geometry.

### Baseline and icon geometry

Regular prose and bold inline metrics each use their font's actual
`line_height` and `base_line`; their label y positions are derived so their
physical baselines match. The host harness creates real floating LVGL labels,
reads `get_pos()`, verifies every rendered prose/metric baseline, and
confirms adjacent sentence fragments remain naturally packed from the left
edge and every row retains the shared scale across small-count, default
99-count, and extreme plans.

FontAwesome icons use real glyph bitmap bounds, then receive the shared
`icon_optical_offset_y = 2` downward visual correction. The same object-level
harness reads each icon label's actual frame and verifies the offset remains
inside its row. SVG is not used because the P4's ThorVG software path renders
it blank.

<!-- doc: lua_module_lvgl/lib/launcher.md -->
<a id="lua-module-lvgl-lib-launcher"></a>

## launcher

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

### Home

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

### App model

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

### Shared State Store

`require("state_store").namespace(app_id)` is the only shared-data seam. The
namespace survives `on_stop` and is available to home and Peek after Back;
widgets and callbacks do not. State is in memory and is not flash persistence.

The namespace supports `get(key, default)`, `set(key, value)`, `delete(key)`,
and `version()`. For Lua App ergonomics, `state.key` reads and writes the same
backing namespace; it is not a second table.

### Sandbox

Catalog Lua Apps receive an allowlisted `lvgl` module, an App-safe `aiodi`
facade, `ICONS`, display dimensions, basic standard-library functions, and
their App context. The `aiodi` facade contains tokens and widget builders only;
its `screen`, `app`, `app_frame`, `load_anim`, and transition controls remain
Shell-private. Token tables are copied per App. Apps can only require `lvgl`
and `aiodi`. Screen creation, LVGL initialization, event-loop ownership, raw
filesystem access, and arbitrary module loading remain Shell responsibilities.

### Verification

Host tests:

```sh
cmake -S research/esp32-p4-c6-deskos/firmware/tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```

The native SDL simulator can exercise the three home pages and direct App
opening with `ODK_SIM_HOME_PAGE`, `ODK_SIM_TAP`, and `ODK_SIM_SHOT`.

### Built-in plugin interface

The built-in plugin modules export manifest, state_defaults and widgets. A manifest contains id, name, version, desc, icon, accent and category. Each widgets size entry is a constructor with parent, spec and ctx. It returns root and optional target_app, on_tick, on_click and destroy fields. State comes from the shared namespace. Register callbacks once and release App-local references on stop. Do not allocate tables on the tick path.

Optional app, peek and dashboard fields supply the corresponding integration. A dashboard provider uses metric_key, get_value(state, now), icon and an optional on_click(ctx). See the [registry API](#lua-module-lvgl-lib-core-plugin-registry) and [Widget API](#lua-module-lvgl-lib-core-widget-engine). Each [plugin document](lib/plugins) lists its source exports.

The reference grid has three columns and four rows. Size codes are 1x1, 2x1, 1x2, 2x2, 3x1, 3x2 and 3x4. The old 480×800 design used 131px cells and 24px gutters. Compute rectangles with grid_metrics and the Widget engine; do not copy reference pixels into another display.

The desktop configuration is an array of page records. A grid page uses type, title and items. Each item supplies plugin, widget, col and row. A dashboard page supplies providers and optional header settings. See [desktop configuration](#lua-module-lvgl-lib-config-desktop-layout). Reject overlaps or out-of-page placement in the applicable validation path.

Generated Lua must return a valid plugin table and use actual aiodi/lvgl bindings. Use aiodi colors, fonts and scaled dimensions. Use supported icon_label glyphs. The P4 SVG path must have its own rendering evidence. The Shell owns initialization, frame and Back. Verify syntax, sizes, text, clicks, Back, shared state and snapshot invalidation in the simulator; verify display and physical touch separately on the target.

<!-- doc: lua_module_lvgl/lib/minimal_swipe.md -->
<a id="lua-module-lvgl-lib-minimal-swipe"></a>

## minimal_swipe

Isolated horizontal-pager swipe cost demo for the Open DeskOS shell.

### Purpose

Measures the raw cost of scrolling the launcher's pager geometry on the current
LVGL build + panel, WITHOUT the launcher's page content (SVG icons, big fonts,
~100 widgets, rounded corners). It builds 3 full-screen pages, each a single
flat colored container with one small label, using the launcher's exact scroll
config (flex-row container, `dir=hor`, `snap_x=start`, `elastic`, `momentum`,
`scrollbar=off`).

If this demo scrolls at full speed, launcher jank is in its page content; if it
also janks, the bottleneck is in the scroll container / render path itself.

### Usage

On device: `cerb ui "swipe"`

In sim: `./build/open_deskos_sim "@lib/minimal_swipe.lua"`

### Output

Logs `[minimal-swipe] duration=Nms frames=N avg=X.Xms/frame` on each `scroll_end`
— real wall-clock telemetry, same format as the launcher's `[swipe]`.

<!-- doc: lua_module_lvgl/lib/plugins/almanac.md -->
<a id="lua-module-lvgl-lib-plugins-almanac"></a>

## plugins.almanac

[Source](lib/plugins/almanac.lua): widgets: 1x1, 3x2. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/breath.md -->
<a id="lua-module-lvgl-lib-plugins-breath"></a>

## plugins.breath

[Source](lib/plugins/breath.lua): widgets: 1x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/calendar.md -->
<a id="lua-module-lvgl-lib-plugins-calendar"></a>

## plugins.calendar

[Source](lib/plugins/calendar.lua): widgets: 1x1, 2x2; dashboard. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/chat.md -->
<a id="lua-module-lvgl-lib-plugins-chat"></a>

## plugins.chat

[Source](lib/plugins/chat.lua): widgets: 1x1, 2x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/clock.md -->
<a id="lua-module-lvgl-lib-plugins-clock"></a>

## plugins.clock

[Source](lib/plugins/clock.lua): widgets: 1x1, 2x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/dice.md -->
<a id="lua-module-lvgl-lib-plugins-dice"></a>

## plugins.dice

[Source](lib/plugins/dice.lua): widgets: 1x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/hydrate.md -->
<a id="lua-module-lvgl-lib-plugins-hydrate"></a>

## plugins.hydrate

[Source](lib/plugins/hydrate.lua): widgets: 1x1, 1x2. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/init.md -->
<a id="lua-module-lvgl-lib-plugins-init"></a>

## plugins.init

Built-in plugin registration list. See [registry contract](#lua-module-lvgl-lib-core-plugin-registry); entries are defined in [init.lua](lib/plugins/init.lua).

<!-- doc: lua_module_lvgl/lib/plugins/mantra.md -->
<a id="lua-module-lvgl-lib-plugins-mantra"></a>

## plugins.mantra

[Source](lib/plugins/mantra.lua): widgets: 1x1, 3x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/pomodoro.md -->
<a id="lua-module-lvgl-lib-plugins-pomodoro"></a>

## plugins.pomodoro

[Source](lib/plugins/pomodoro.lua): widgets: 1x1, 2x2; dashboard. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/quota.md -->
<a id="lua-module-lvgl-lib-plugins-quota"></a>

## plugins.quota

[Source](lib/plugins/quota.lua): widgets: 2x2, 2x1, 3x4. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/settings.md -->
<a id="lua-module-lvgl-lib-plugins-settings"></a>

## plugins.settings

[Source](lib/plugins/settings.lua): widgets: 1x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/stars.md -->
<a id="lua-module-lvgl-lib-plugins-stars"></a>

## plugins.stars

[Source](lib/plugins/stars.lua): widgets: 1x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/plugins/year.md -->
<a id="lua-module-lvgl-lib-plugins-year"></a>

## plugins.year

[Source](lib/plugins/year.lua): widgets: 1x1, 2x1. Shared lifecycle/state rules: [launcher](#lua-module-lvgl-lib-launcher).

<!-- doc: lua_module_lvgl/lib/state_store.md -->
<a id="lua-module-lvgl-lib-state-store"></a>

## state_store

Shell-owned namespaced state for App data shared by Home, peek, and the
fullscreen App. A namespace survives App stop and is released only when the
Shell Lua state exits.

```lua
local store = require("state_store")
local state = store.namespace("pomodoro")
state:set("remaining", 1500)
local remaining = state:get("remaining", 0)
state:delete("remaining")
```

Apps must use `get` and `set`; they must not retain or mutate an internal table
outside the namespace interface. Values are Lua values owned by the Shell
state and are not automatically persisted to flash.
