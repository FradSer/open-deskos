# Widget and App design

Read this during implementation. Product requirements belong to `PRODUCT.md`, `DESIGN.md`, and `runtime/shell/CONTEXT.md`.

## Information and layout

Define each reading's source, unit, scope, measurement time, and availability.
Preserve these distinctions during responsive changes.
Never replace missing evidence with a plausible value.
Trace defects through parents, shared styles, component constraints, and content before adjusting a local property.
Compare user-approved neighboring surfaces in their actual composition.
Treat minimum sizes as safeguards, not visual targets.

Before creation or redesign, record a short contract in the existing task or feature file.
Include source authority, units, freshness, unavailable states, plugin identity, App entry, lifecycle, layout, and recovery.
State the measured Cell, theme, heading choice, icon choice, and required verification evidence.
For composition changes, record the latest accepted constraints before editing shared geometry.
Distinguish fixed spans, aspect ratios, page membership, outer margins, and internal gaps.
Replace superseded constraints when the user changes them.
Derive the canvas from those constraints and the available pane dimensions.
Check the complete composition before adjusting individual components.
Tests establish constraints and behavior; user feedback establishes subjective acceptance.

Widgets adapt to their measured Cell, not a host name or window width.
Use container queries and content-driven composition.
Honor Minimum Readable Cell and supported spans.
Keep essential content readable in compact cells.
Scroll pages rather than shrink content.
Keep DOM reading order consistent with visual order.
Use logical properties for direction-aware alignment.
Group content with space before adding borders or nested surfaces.
Center primary readings independently of headers and status badges.
Anchor useful headings at the shared top inset; center the reading within the remaining space.
Choose headings per surface rather than adding them to every Widget.
A provider name can identify a quota reading; a year percentage can explain itself.
Keep an accessible App name when omitting a visible heading.
Remove the unused header slot instead of hiding text inside reserved space.
Keep counts, status capsules, and their summaries together.
Check their gaps and containment across Cell sizes before increasing display numerals.
Stack metric labels above the value and unit.

## Typography, color, and copy

Use the current project fonts, semantic tokens, and theme rules.
Keep primary readings and actionable states at least 14px in `secondary-strong` or brighter.
Keep supporting text at least 12px.
Reserve 12px `secondary` for captions without data.
Use tabular numerals for changing values.
Montserrat display numerals may use `letter-spacing: -0.02em`.
Reset Pixel/Zpix tracking to `normal`.
Check actual font support before using OpenType features.
Keep CJK, long words, signs, units, and multi-digit values readable.
Provide access to full values when truncation is necessary.

Use semantic color for state.
Use the selected theme material and its semantic palette.
The baseline uses black/charcoal, transparent rows, and structural outlines.
Liquid Glass keeps its accepted material and a readable fallback.
Avoid unrelated decorative glow, tint, and competing surface treatments.
Measure rendered contrast, including opacity and backgrounds.
Normal text requires 4.5:1 contrast; large text and essential control graphics require 3:1.
Keep a label or icon when color communicates meaning.
Use the same term for the same state.
Name the actual failure and available recovery action.
Distinguish empty, unconfigured, unauthorized, unavailable, stale, malformed, and failed states.

## Controls and motion

Use native controls with accessible names and associated labels.
Provide visible focus and complete keyboard operation.
Restore focus after dialogs and disclosures.
Keep logical tab order without positive `tabindex`.
Use 44px touch targets where possible.
Expose validation errors through the field's programmatic description.
Use stable live regions for meaningful state changes.
Keep rapidly changing counters outside atomic live regions.
Honor `prefers-reduced-motion`.
Keep state understandable without animation.
Avoid continuous decorative animation.
Clean up subscriptions, listeners, animation frames, and resources outside the scoped context.

## Icons

Choose an icon only when it aids recognition or communicates state.
Do not prefix every heading with an icon.
Preserve an accepted meaningful icon unless the user changes that requirement.
Use upstream Pixelarticons artwork for Pixel icons.
Preserve MIT attribution: Copyright (c) 2019 Gerrit Halfmann.
Do not use handmade approximations, another pixel set, raster icons, or stroked fallbacks.
Built-ins author Tabler outline paths in `svg[data-tabler="<name>"]` with `viewBox="0 0 24 24"`.
Register the unmodified Pixelarticons counterpart in `runtime/shell/src/renderer/icons/pixelarticons.js`.
`core/icons.js` performs the theme swap.
Missing mappings fail `tests/pixel-icons.test.js`.
Use an established upstream-artwork composite/`-off` pattern when no direct match exists.
Record its source in `src/renderer/icons/PIXELARTICONS-NOTICE.md`.
Installable packages embed their paths and notices.
They switch at `html[data-theme="pixel"]`; Shell icon paths are unavailable inside their frame.

## Implementation patterns

Register built-in `kind`, composition scripts, and layout placement.
Use scoped styles, `ctx.onTick`, and context-owned subscriptions.
Normalize, bound, and cache provider data in main.
Expose narrow main/preload interfaces.
Use `textContent` for untrusted strings.
Main validates remote images before passing bounded safe assets or data URLs.

Use existing plugin implementations as examples:

| Need | Example | Required distinction |
| --- | --- | --- |
| Retained design examples | Chatbot (`message` icon), Settings (`settings` icon) | Keep each name and icon; show `Pending` and `Integration not available`; add no controls. These examples do not describe packaged Widgets. |
| Focus timer | `plugins/pomodoro.js` | Keep the heading separate from the centered dial; controls belong to the App |
| Provider allowance | `plugins/quota-page.js` | Use the actual provider name; preserve unknown readings |
| Session summary | `plugins/pi-sessions.js` | Keep count, status capsule, and Idle count; retain the accessible App entry |
| Progress | `plugins/year.js` | Rounded text and precise meter; text carries accessible meaning |
| Telemetry | `plugins/hydra.js` | Mount a truthful null snapshot; preserve independent cell failures |

Trace registered alternate surfaces before changing a shared visual contract.
Update affected static markup and harness assertions together.
Keep behavior-owning replacements independent; do not delegate to the default mount.
Confirm that each example still exists before copying it.
Do not restore retired surfaces through outdated examples.
When alternatives are requested, vary a named structural dimension.
Keep each alternative functional and compare it against the same requirements.
Remove the temporary variant selector after selection.
Explain ownership, data flow, layout, tokens, and effects from source evidence when explanation is requested.
