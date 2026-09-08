---
name: Open DeskOS / CM5 Desk Instrument
colors:
  bg: "#000000"
  surface: "#171717"
  elevated: "#1f1f1f"
  button: "#383838"
  stroke: "#383838"
  stroke-focus: "#b5b5b5"
  primary: "#ffffff"
  secondary: "#706f70"
  secondary-strong: "#b5b5b5"
  accent-red: "#eb5757"
  accent-green: "#34c759"
  accent-blue: "#025bc2"
typography:
  body:
    fontFamily: "Noto Sans SC, Montserrat, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  display:
    fontFamily: "Montserrat, sans-serif"
    fontSize: "96px"
    fontWeight: 700
  numeral:
    fontFamily: "Montserrat, sans-serif"
    fontSize: "52px"
    fontWeight: 700
rounded:
  card: "36px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
---

# Open DeskOS CM5 Desk Instrument

## Scope

This is the semantic design system for the active CM5/Linux runtime. It governs the Electron desk display, direct input, and accepted Remote Control interaction. It does not prescribe the preserved P4+C6 LVGL/Lua/AIODI shell; that historical design system is retained at [research/esp32-p4-c6-deskos/docs/AIODI-DESIGN.md](research/esp32-p4-c6-deskos/docs/AIODI-DESIGN.md).

## Visual intent

A CM5 display is a quiet, truthful instrument at a desk. It opens on states the system can substantiate: local time, focus state, network state, configured provider state, and peripheral connection state. The interface should make a status legible at a glance and one next action obvious, without fabricating personal calendar, health, activity, or account data.

The visual vocabulary is a black field, charcoal surfaces, outlined widgets, heavy tabular numerals, and state accents used with deliberate intensity. Live states can carry a stronger red, green, or blue field inside a clearly bounded instrument; inactive surfaces remain quiet. Every control owns a visible rest, focus, and active state, and transitions describe a specific state change instead of adding ambient motion. It must not look like an analytics dashboard, a generic AI interface, or a neon/glassmorphism experiment.

## Token rules

- Black and charcoal establish the inactive field. White is reserved for primary reading and active navigation.
- `accent-red`, `accent-green`, and `accent-blue` express a distinct state or focal action. Never distribute accents decoratively across a page.
- `stroke` separates persistent widgets; `stroke-focus` is the keyboard focus treatment.
- Montserrat Bold serves large numerals and compact labels. Noto Sans SC Regular serves body copy and remains available for future localization.
- Depth is tonal and stroked. Do not add drop shadows or glow effects.
- `secondary-strong` is the readable supporting-text color on charcoal surfaces; `secondary` is reserved for non-text subdued indicators.
- Widget interiors use at least 12px supporting text and tabular primary values. Compact windows retain readable square cells and scroll vertically instead of shrinking all ten instruments into view.
- Widget visual content targets 62% of the inner card frame (54–70% accepted). The density harness measures rendered text line boxes, SVG visual frames, and meters, never empty layout wrappers. Occupied rectangle union must exceed 20%, and no full-width vertical empty band may exceed 28%; merely spreading tiny labels apart does not meet the target. Wider dates and 100% values scale to remain contained.
- App interiors use shared heading, body, and label roles, 44px minimum controls, visible search labels, and wrapping metadata. Desktop App footprints remain aligned with the Home grid; compact Apps use the available width inside the page margins.

## Pixel typography

Pixel uses the unchanged local Zpix v3.2.0 WOFF2 for English, simplified/traditional Chinese, digits, input text, placeholders, and code. Its Regular face is used without synthetic weight/style; hierarchy comes from size and spacing. Pixel-specific numeral sizing accounts for Zpix's narrower Latin advances while retaining the shared Widget density band. Instrument and Border Beam retain Noto Sans SC and Montserrat.

Zpix is free for personal/education projects but requires separate commercial licensing. The source, asset checksum, and upstream terms are recorded in `runtime/linux/src/renderer/fonts/ZPIX-NOTICE.md`; do not convert or subset the font.

## Optional Border Beam theme

The Instrument appearance remains unchanged. The optional `border-beam`
theme references [Libraries.dev border-beam](https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/border-beam),
specifically its mono rotating conic-gradient perimeter masked to a thin edge.
The framework-free adaptation uses existing `--odk-*` neutrals, not additional
state colors or a React dependency. Today, Home widgets, Usage and the Pi outer
surface receive the edge treatment; content and geometry remain unchanged.

This opt-in theme is an explicit exception to the default ban on decorative
motion: a six-second perimeter cycle, no outward bloom, no input interception,
and static edges under reduced motion. Hidden documents pause the animation.
No status-bar theme selector is exposed. The renderer theme API stores the
selection locally. New installations currently use Pixel; an explicit selection is restored on restart.

## Interaction rules

- **Today first.** The initial page reports truthful local and provider-backed status, not a synthetic briefing.
- **Glance first, dive second.** A Widget can open a focused built-in view; Back and Escape restore the source page.
- **Direct input always works.** Touch and keyboard never depend on Remote Link, camera state, Face Agent, or owner recognition.
- **Peripheral state is explicit.** Remote and Camera hardware may be architecturally required, but each has a separate acceptance gate and must expose unavailable or synchronizing states honestly.
- **Reduced motion is respected.** Pointer paging uses a short spatial transition; keyboard and Remote page changes are immediate. Page markers crossfade point/bar opacity without scaling targets or animating layout width. No ambient movement is added to idle Widgets.
- **State Bar capsules align.** Pi status and page navigation share `--odk-status-control-h: 44px` for their visible surfaces and hit heights. Pagination is graphical at every size: points for other pages, a short bar for the current page, with page names exposed only to assistive technology. Instrument/Border Beam use rounded marks; Pixel uses square marks and its semantic active color. Theme changes never resize the targets or replace controls.
- **Information precedes metadata.** Pi Sessions shows status and goals first, with native disclosures for process identifiers and commands. Refresh preserves expanded details, focus, and scroll. Usage keeps refresh actions beside provider state, ahead of optional metric details.
- **Inactive is quiet.** A not-started focus dial uses a neutral outline, not a red progress indication. Today has no decorative active-state dot.
