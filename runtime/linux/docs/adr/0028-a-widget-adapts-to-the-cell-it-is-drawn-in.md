# A Widget adapts to the Cell it is drawn in, and declares the smallest Cell it reads at

## Status

Accepted

## Context

The Display Shell's layout model gives every Widget a strictly square Cell, and that Cell is not a function of the window. At 1920×1280 it is 348px; at 1280×776 it is 186px; a 400×700 window gets 360px cells because it lays out one column; a 636×1087 window gets 282px. So a Widget cannot be written against a viewport, and the two Shell Hosts present the same Widget at half the width, which is how Futu holdings came to render all three positions as `T…` on the handheld: the pixel font needs about 207px for symbol, price, and change together, and the narrow cell had 152px to give.

The Shell carried two partial answers. Individual plugins scaled their type with container queries, which helps but silently shrinks text below the readable floor — Hydra's `Live` label measures 10.64px — and one viewport media query dropped every declared multi-cell span below 1000px, so a 636×1087 window with 282px cells lost structure that the handheld keeps at 186px. A rule keyed to window width was measuring nothing real.

A 90-run stress audit over both hosts' sizes, every theme, and every page found what neither existing gate could see. The density gate measures ink, not drawability, so nothing asserted that every character is drawn, that nothing hidden is unreachable, or that type stays above the floor. It found a CJK goal clipped by 148px on the reference panel, the same clip at 81px on the handheld, and the sub-floor label.

## Decision

- **The Cell is the unit of adaptation.** A Widget measures the Cell it is drawn in and re-composes inside it. No Widget names a Shell Host, a panel, or a window width, and the viewport media query that dropped multi-cell spans is retired.
- **A glanceable Widget re-composes; it never scrolls and never shrinks below the readable floor.** When a Cell cannot hold the full composition, the Widget lays out what it can in a different shape, and only then does it drop whole items in a declared order, keeping the count of what it is not showing. An interactive App page may still scroll, because it is a surface the owner acts in rather than a glanceable instrument.
- **A Widget declares its Minimum Readable Cell, and a grid page honors a multi-cell span only when the resulting Cell meets it.** This is what protects the instruments that cannot re-compose — a camera frame, a chart, a cover image. A one-cell span is always honored, since a single cell is the floor the layout model can give.
- **The desk is responsible at exactly two sizes: 1920×1280 and 1280×776.** A standing gate asserts, at both, across all themes and all pages, that no text is clipped, that nothing is hidden beyond reach, and that no type falls below the design system's floors. Other window sizes are best-effort and are not promised.

## Consequences

- Supporting a second Shell Host stops costing the reference host its layout: the same code serves a 348px Cell and a 186px Cell, and a new host needs no branch anywhere in a Widget.
- The cost moves to measurement. Every Widget that holds real content has to measure its own row, and its readable minimum becomes a declared number that can be wrong, so the standing gate is what keeps the declarations honest.
- The responsive audit became a gate rather than a report, which means a Widget that cannot re-compose must declare a Minimum Readable Cell honestly or the gate will refuse the layout it asked for.
- The retired viewport threshold changes behaviour for sizes outside the promise: a windowed desk on the reference panel now keeps its composition instead of collapsing to one cell per Widget.
- Anything hidden to save space must say what it hid. A tile that shows three of twelve holdings states the count, because a silently shortened list reads as the whole list.
