# 04 — Dynamic Theme Token Engine & Built-in Pixel Art Theme

**What to build:** A dynamic theme registry (`kind: 'theme'`) that safely updates `--odk-*` CSS custom properties at runtime, shipping with a fully realized, second built-in "Pixel Art" theme featuring 0px rectangular borders, retro stepped shadows, phosphor green/amber accents, and crisp pixel typography.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Theme plugins can register under `kind: 'theme'` declaring custom `--odk-*` token dictionaries
- [x] Theme switches apply instantly to the document root without reloading the page or losing current session state
- [x] Ships a second built-in theme `odk.theme.pixel-art` with authentic retro phosphor green (`#38d948`), amber (`#f5a623`), 0px corner radii, and monospace typography
- [x] Settings view exposes an interactive theme switcher allowing instant selection between default minimal dark and pixel art
- [x] Theme tokens are verified against `DESIGN.md` rules and fail closed on invalid CSS properties
