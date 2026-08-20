# dashboard_layout

Shared adaptive Dashboard layout engine used by the launcher and the runnable
native-SDL host harness.

## Purpose

The daily-plan Dashboard is a measured layout, not a fixed screenshot. Every
refresh starts with current values, measures real TTF glyphs, and creates a
small render plan that keeps every visible line inside the 480px P4 canvas.
Every Dashboard narrative line preserves the same large 26-unit reference type
scale. A continuous measured semantic flow fills each row before moving to the
next; no row changes size.

## Data model

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

## Adaptive planning contract

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

## API

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

## Baseline and icon geometry

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
