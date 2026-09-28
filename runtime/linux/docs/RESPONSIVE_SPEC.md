# A desk that stays readable on the panel it is drawn on

## Problem Statement

The desk is owned on two panels that are nothing alike, and the owner sees the
difference every time they walk up to it. A Futu holdings tile on the handheld
showed all three positions as `T…` — the same first letter, clipped by an
ellipsis — so a glance could not say which positions were held. A Pi Sessions
tile clips a long goal outright: 148px of it disappears on the reference panel
and 81px on the handheld. Hydra's `Live` label renders at 10.64px, below the
design system's own floor. None of this is visible to the current gates, because
the density gate measures ink coverage and nothing in the desk asserts that every
character is drawn, that nothing hidden is out of reach, or that type stays
readable.

The cause is a wrong unit. Widgets are adapted to the window, but the window does
not determine the space a Widget actually gets: the layout model gives 348px
cells at 1920×1280, 186px at 1280×776, 282px at 636×1087, and 360px at 400×700,
because a small window lays out fewer columns. A rule keyed to window width is
therefore measuring nothing real, and it is why a 636px window with 282px cells
loses the multi-cell composition that the handheld keeps at 186px.

The owner asks for the whole desk to be responsive on any screen, and for that to
be a standing property of the product rather than something re-derived by hand
whenever a panel changes.

## Solution

The Cell — the square region the layout model gives a Widget — becomes the only
unit of adaptation. A Widget measures the Cell it is drawn in and re-composes
inside it; no Widget names a Shell Host, a panel, or a window width. A glanceable
Widget never scrolls and never shrinks type below the readable floor: it lays out
what fits in a different shape, and only then does it drop whole items in a
declared order, stating the count of what it is not showing. A grid page honors a
declared multi-cell span only when the resulting Cell meets the Widget's declared
Minimum Readable Cell, which is what protects the instruments that cannot
re-compose — a camera frame, a chart, a cover image. The viewport rule that
dropped every span below 1000px is retired.

Responsiveness then becomes a promise with a gate behind it. The desk is
responsible at exactly two sizes, 1920×1280 and 1280×776, and a standing
responsive-matrix gate asserts at both, across all themes and all pages, that no
text is clipped, that nothing is hidden beyond reach, and that no type falls below
the floors. Other window sizes remain best-effort and are not promised.

## User Stories

1. As the owner of the handheld, I want every reading on my desk to be drawn in
   full, so that I can trust what I see at a glance.
2. As the owner of the handheld, I want holdings to be told apart by name, so that
   I know which positions I hold without opening a detail.
3. As the owner of the reference panel, I want a long session goal to wrap and be
   bounded rather than vanish, so that I know what the session is for.
4. As the owner of the reference panel, I want the same goal intact on the
   handheld, so that the two desks tell me the same thing.
5. As the owner, I want no label rendered below the readable floor anywhere on my
   desk, so that nothing is technically present and practically unreadable.
6. As the owner, I want a tile to show me fewer things rather than show me broken
   things, so that what remains on screen is always true.
7. As the owner, I want to know when a tile is showing me a subset, so that a
   short list is never mistaken for the whole list.
8. As the owner, I want the price of a position to remain reachable when a narrow
   cell leaves it out of the row, so that nothing is dropped silently.
9. As the owner, I want a camera frame or a chart to keep a cell large enough to
   be read, so that instruments which cannot shrink stay intact.
10. As the owner, I want a tile to adapt to the space it is actually given, so that
    the same tile works on both panels without a second version.
11. As the owner, I want a windowed desk on the reference panel to keep its
    composition, so that a smaller window is not a worse desk.
12. As the owner, I want the desk to behave the same whichever panel it is drawn
    on, so that muscle memory transfers between them.
13. As the owner, I want the desk's layout to be predictable from its geometry, so
    that I can predict what I will see before I look.
14. As a maintainer, I want the responsive property to be asserted automatically,
    so that it cannot be traded away by an unrelated change.
15. As a maintainer, I want the gate to fail on the reason the desk is actually
    wrong, so that a red gate is trustworthy.
16. As a maintainer, I want one fixture set shared by every geometry gate, so that
    the density gate and the responsive gate cannot disagree about what content
    looks like.
17. As a maintainer, I want the geometry gate to run on both Shell Hosts, so that
    a Windows-only regression cannot hide behind a development-machine pass.
18. As a maintainer, I want each Widget's readable minimum to be a declared number
    rather than an emergent accident, so that a layout decision is reviewable.
19. As a maintainer, I want the retired viewport rule gone, so that there is one
    adaptation rule in the Shell rather than two that disagree.
20. As the owner, I want an interactive App page to keep scrolling, so that a long
    list is still reachable by touch on a small panel.

## Scenarios

The executable specification is `runtime/linux/tests/features/responsive-shell.feature`,
verified by the responsive matrix gate and the per-Widget composition harnesses.

## Implementation Decisions

- **The Cell is the only adaptation unit.** A Widget measures the Cell it is drawn
  in. Window, panel, and host names are absent from Widget code by rule, not by
  convention, because the Cell is not a function of the window.
- **Re-composition before removal.** A glanceable Widget that cannot hold its full
  composition lays out a different shape first. Whole items are dropped only when
  no shape fits, in an order the Widget declares, and the count of what is not
  shown is stated in the Widget's own text.
- **Floors are never traded for space.** Type stops at the design system's readable
  floor; a Widget does not scale below it to keep an item on screen. Container-query
  type ramps keep their ramp but gain a floor, so a small Cell yields larger type
  rather than smaller type.
- **No scrolling in a glanceable Widget.** An interactive App page keeps scrolling,
  since it is a surface the owner acts in rather than an instrument they glance at.
- **Minimum Readable Cell is declared, and the grid honors it.** A Widget declares
  the smallest Cell at which it reads at full composition. A grid page keeps a
  declared span above one cell only when the resulting Cell meets that minimum; a
  one-cell span is always honored, because one cell is the floor the layout model
  can give.
- **The viewport span rule is retired.** The narrow-screen media query that forced
  every grid item to a single cell is removed; a page keeps its declared composition
  whenever the grid can satisfy it and the Cell is at least the Widget's minimum.
- **Responsiveness is promised at two sizes and gated there.** 1920×1280 and
  1280×776, every theme, every page. Other sizes are best-effort.
- **The gate asserts four things per run**: no clipped text, no content hidden
  beyond reach, no type below the floors, and every declared multi-cell span
  honored at the promised sizes.
- **One fixture set for every geometry gate.** The density gate and the responsive
  gate install the same feed content, including the widest values each feed can
  carry — four-figure prices, long CJK titles, long prompts, long source labels —
  so that a gate cannot pass on thin content.

## Testing Decisions

- **A good test here measures what the owner can see.** It asserts that characters
  are drawn, that hidden content is reachable, and that type stays readable. It does
  not assert a Widget's internal shape, its class names, or which branch it took.
- **Test at the highest seam available.** The primary seam is one Electron harness
  driving the real shell with real fixtures across both promised sizes, all themes,
  and all pages, asserting through the live DOM. Per-Widget composition keeps its
  own existing DOM-level harness, since a Widget's internal re-composition is only
  observable from inside its cell.
- **Prior art**: the density gate's fixture and measurement machinery, the
  Futu composition harness for a single Widget's internal re-composition, and the
  layout harness for the geometry model. The responsive gate reuses the first
  rather than reimplementing it.
- **The gate is a gate, not a report.** A clipped character or a sub-floor label
  fails the run; the audit that found these defects is the same code the gate runs.
- **Content is the stress case, not the happy case.** Every run uses the widest
  values a feed can carry, because a responsive contract proven on thin content
  proves nothing.
- **Both hosts run it.** The gate is host-agnostic, including its temporary
  directory, so the handheld and the reference host verify the same property.

## Out of Scope

- Guaranteeing sizes other than 1920×1280 and 1280×776. The layout model continues
  to produce cells at other sizes; nothing promises a result there.
- Redesigning any Widget's visual language, palette, or information hierarchy. The
  pass changes what fits, not what is said.
- Making a Widget's data adapt — for example, choosing fewer holdings because the
  Cell is small. The rows shown stay the rows the feed supplies.
- Scrolling or paging inside a glanceable Widget.
- Per-host or per-panel layout configuration. Nothing declares a host.
- The desktop page inventory itself: which Widgets exist and on which pages.

## Further Notes

`CONTEXT.md` gained **Cell** and **Minimum Readable Cell**; the decision and its
evidence are recorded in ADR-0028, including the measured cell per size that
shows why window width is not a usable proxy.
