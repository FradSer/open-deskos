---
name: widget-placement-top-left
description: Grid pages anchor their widgets to the top-left and pin to the page top; never center them
type: public
---

# Widgets Anchor Top-Left and Pin to the Page Top

## Why

Two separate anchoring rules, both required by the user:

1. **Vertical** — grid pages must not float their tiles in the middle of the
   page. `.widget-grid` carries `margin: 0 auto`, so tiles start at the first
   row. An earlier `margin: auto` left the Reading page's two-row content
   vertically centred, which the user rejected outright.
2. **Horizontal** — tiles fill from the top-left, row-major. A single-tile page
   anchors its tile at column line 1 / row line 1. On the Reading page WeRead
   owns the top-left 3x2 and the pre-order countdown takes the free 2x2 to its
   right, so the *new* tile landed top-right while the page still fills from
   the top-left.

`tests/layout-harness.mjs` enforces both: `single tile anchors top-left`
asserts the start lines, and `every grid pins to top` asserts the base rule
applies to multi-tile pages too, not only single-tile ones.

## How to apply

- Place a new tile at the first free slot scanning left-to-right, top-to-bottom;
  pin its span explicitly in `config/desktop_layout.js`.
- Never reintroduce `margin: auto` on `.widget-grid`, and never rely on the
  `:has(> .widget:only-child)` exception to cover multi-tile pages.
- Address pages by layout id in harnesses (`tests/helpers/pages.js`), not by
  numeric position: inserting a page shifts every later index and silently
  retargets positional selectors onto the wrong surface.

## Related

- [[cerberus-os-top-spec]]
- [[cm5-staging-needs-display]]
