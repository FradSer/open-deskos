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

The visual vocabulary is a black field, charcoal surfaces, outlined widgets, heavy tabular numerals, and scarce state accents. It must not look like an analytics dashboard, a generic AI interface, or a neon/glassmorphism experiment.

## Token rules

- Black and charcoal establish the inactive field. White is reserved for primary reading and active navigation.
- `accent-red`, `accent-green`, and `accent-blue` express a distinct state or focal action. Never distribute accents decoratively across a page.
- `stroke` separates persistent widgets; `stroke-focus` is the keyboard focus treatment.
- Montserrat Bold serves large numerals and compact labels. Noto Sans SC Regular serves body copy and remains available for future localization.
- Depth is tonal and stroked. Do not add drop shadows or glow effects.

## Interaction rules

- **Today first.** The initial page reports truthful local and provider-backed status, not a synthetic briefing.
- **Glance first, dive second.** A Widget can open a focused built-in view; Back and Escape restore the source page.
- **Direct input always works.** Touch and keyboard never depend on Remote Link, camera state, Face Agent, or owner recognition.
- **Peripheral state is explicit.** Remote and Camera hardware may be architecturally required, but each has a separate acceptance gate and must expose unavailable or synchronizing states honestly.
- **Reduced motion is respected.** Pager motion conveys location; it is not decoration.
