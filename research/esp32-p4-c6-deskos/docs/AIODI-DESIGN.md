---
name: Open DeskOS / AIODI
description: On-device LVGL/Lua OS shell design system for the desk companion panel
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
  caption:
    fontFamily: "Noto Sans SC, Montserrat, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  body:
    fontFamily: "Montserrat, Noto Sans SC, sans-serif"
    fontSize: "28px"
    fontWeight: 400
  title:
    fontFamily: "Noto Sans SC, Montserrat, sans-serif"
    fontSize: "40px"
    fontWeight: 400
  display:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "96px"
    fontWeight: 700
  mega:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "180px"
    fontWeight: 700
  numeral-clock:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "52px"
    fontWeight: 700
  numeral-ring:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "48px"
    fontWeight: 700
  label:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "32px"
    fontWeight: 700
rounded:
  sm: "8px"
  md: "16px"
  lg: "24px"
  tile: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  gutter: "16px"
  cell: "96px"
components:
  tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.tile}"
    padding: "0"
  tile-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.tile}"
  button-pill:
    backgroundColor: "{colors.button}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "8px"
  card-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "16px"
    height: "64px"
  progress-track:
    backgroundColor: "{colors.button}"
    rounded: "{rounded.pill}"
  progress-fill-green:
    backgroundColor: "{colors.accent-green}"
    rounded: "{rounded.pill}"
  progress-fill-blue:
    backgroundColor: "{colors.accent-blue}"
    rounded: "{rounded.pill}"
  progress-fill-red:
    backgroundColor: "{colors.accent-red}"
    rounded: "{rounded.pill}"
---

# AIODI research design tokens

The frontmatter contains the original P4/LVGL reference tokens. Use the [aiodi API](../firmware/components/lua_modules/lua_module_lvgl/README.md#lua-module-lvgl-lib-aiodi) for actual component and scaling behavior. These tokens do not replace the Electron Shell design contract.

Use black backgrounds, charcoal surfaces and flat borders. Use red, green or blue for a state or one focal item. Use Montserrat Bold for numbers and Noto Sans SC Regular for Chinese text. Do not send Chinese glyphs to font_bold. Use grid_metrics and aiodi.px for geometry. Use supported icon_label glyphs. The Shell owns the App frame and Back control.
