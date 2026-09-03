# 03 — Desktop Grid Auto-Assembly via Manifest Contributions

**What to build:** An intelligent grid packing engine in the Desktop Composer that automatically slots enabled widgets into available cells based on declared manifest contributions (`preferredSpan`), removing the need for developers to manually calculate and hardcode row/column coordinates in `desktop_layout.js`.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Widget manifests can declare `contributions: { slot: "home.grid", preferredSpan: "1x1" | "2x1" | "2x2" }`
- [x] Desktop Composer retains explicit coordinate overrides in `desktop_layout.js` while automatically packing unassigned widgets into free grid cells
- [x] Composer supports both 5-column widescreen (1920x1280) and 3-column portrait (480x854 / 320x480) grid matrices
- [x] Overlapping placements or overflowing cells are detected and degraded truthfully without crashing grid assembly
- [x] Disabling or removing a widget dynamically frees its grid cell for subsequent auto-assembly
