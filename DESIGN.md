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

# Open DeskOS design

## Scope and intent

This governs the shared Linux, Windows, and macOS Shell. Historical LVGL/Lua/AIODI rules remain in [P4+C6 research](research/esp32-p4-c6-deskos/docs/AIODI-DESIGN.md).

Use a quiet black field, charcoal surfaces, outlined instruments, and heavy tabular numerals. Show only local or sourced facts. Today does not repeat time, network, focus, or provider configuration already owned by the State Bar or dedicated surfaces. Controls have visible rest, focus, and active states; motion explains a change rather than decorating idle content.

## Tokens and geometry

- White carries primary reading. Red, green, and blue mark a specific state or focal action; inactive surfaces stay neutral.
- `stroke` separates Widgets; `stroke-focus` marks keyboard focus. Depth uses tone and outlines, without drop shadows or glow.
- Montserrat Bold carries numerals/compact labels; Noto Sans SC Regular carries body text. Supporting text on charcoal uses `secondary-strong`; `secondary` is for subdued non-text indicators.
- Widget supporting text is at least 12px. Compact layouts retain readable square cells and scroll vertically.
- Widget visual content targets 62% of the inner frame (54–70% accepted). Measure text line boxes, SVG visual frames, and meters, excluding empty wrappers. Rectangle union must exceed 20%; no full-width empty vertical band may exceed 28%. Wide dates and 100% values remain contained.
- App interiors share heading/body/label roles, controls at least 44px, visible search labels, and wrapping metadata. Desktop footprints align with the Home grid; compact Apps fit within page margins.

## Quoted Pi content

The transcript keeps Pi's dark-theme roles. A user prompt uses a full-width band.
Each tool box shows the recorded outcome and its result. Markdown, code, and diffs keep Pi's colors.
Assistant text and thoughts use the base surface. The desk's session list, filters, framing, and controls retain `--odk-*` tokens.

Declare `--pi-*` once, scoped to `.pi-app-wrapper` in `runtime/shell/src/renderer/shell.css`; never use them outside transcript surfaces.
[ADR-0015](runtime/shell/docs/ARCHITECTURE.md#adr-0015) and [ADR-0021](runtime/shell/docs/ARCHITECTURE.md#adr-0021) own the reading decisions.

## Themes

Pixel uses the unchanged local Zpix v3.2.0 WOFF2. It supplies Latin, Chinese, digits, input text, placeholders, and code. Use Regular without synthetic weight/style; establish hierarchy with size and spacing. Numeral sizing accounts for narrower Latin advances while retaining Widget density. Instrument and Border Beam retain Noto Sans SC/Montserrat. Zpix needs separate commercial license; see [its notice](runtime/shell/src/renderer/fonts/ZPIX-NOTICE.md) for source, checksum, and terms. Do not convert or subset it.

The optional `border-beam` theme uses [Libraries.dev](https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/border-beam)'s rotating conic-gradient edge. It uses existing neutral tokens. Home Widgets, Usage, and the Pi outer surface receive thin edges without changing geometry/content or adding React. This theme permits a six-second edge cycle. It does not add outward bloom or intercept input.
Use static edges for reduced motion. Pause animation when the document is hidden.

New installations use Pixel; explicit local selection survives restart. There is no State Bar theme selector.

## Interaction

- Widgets open focused views. Back/Escape restore the source page. Touch/keyboard remain independent of Remote Link and camera state.
- Attribute the Console driving a Hosted Pi in the overview header for as long as it drives. Local input retains authority.
- Show unavailable/synchronizing peripheral states honestly and keep hardware acceptance separate.
- Pointer paging has a short spatial transition; keyboard/Remote changes are immediate. Respect reduced motion. Page marks crossfade opacity without scaling targets or animating layout width.
- Pi status and pagination share `--odk-status-control-h: 44px` for surface and hit height. Other pages are points, the current page is a short bar, and page names are assistive text. Instrument/Border Beam round the marks; Pixel uses square marks and its semantic active color. Theme changes never resize or replace controls.
- Put session status/goals before PID/command disclosures. Refresh preserves expansion, focus, and scroll. Usage refresh actions stay beside provider state before optional metric details.
- A not-started focus dial is neutral; Today has no decorative active dot.
