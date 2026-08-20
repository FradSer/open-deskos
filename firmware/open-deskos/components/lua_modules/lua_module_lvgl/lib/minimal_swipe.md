# minimal_swipe

Isolated horizontal-pager swipe cost demo for the Open DeskOS shell.

## Purpose

Measures the raw cost of scrolling the launcher's pager geometry on the current
LVGL build + panel, WITHOUT the launcher's page content (SVG icons, big fonts,
~100 widgets, rounded corners). It builds 3 full-screen pages, each a single
flat colored container with one small label, using the launcher's exact scroll
config (flex-row container, `dir=hor`, `snap_x=start`, `elastic`, `momentum`,
`scrollbar=off`).

If this demo scrolls at full speed, launcher jank is in its page content; if it
also janks, the bottleneck is in the scroll container / render path itself.

## Usage

On device: `cerb ui "swipe"`

In sim: `./build/open_deskos_sim "@lib/minimal_swipe.lua"`

## Output

Logs `[minimal-swipe] duration=Nms frames=N avg=X.Xms/frame` on each `scroll_end`
— real wall-clock telemetry, same format as the launcher's `[swipe]`.
