# Vendored Lua — provenance

| Field | Value |
|---|---|
| Component | `georgik/lua` (ESP-IDF component wrapping upstream Lua) |
| Version | `5.5.0~7` |
| Upstream repo | https://github.com/georgik/esp-idf-component-lua |
| Lua project | https://www.lua.org/ (Lua 5.5 line) |
| License | Lua License (MIT-style; see the license notice in the Lua sources) |
| Acquired | 2026-07-11 |
| Source of these files | Copied verbatim from the fork's resolved managed component at `application/open_deskos/managed_components/georgik__lua/` (`lua/*.c`, `lua/*.h`, `include/luaconf.h`) after task 001's `idf.py build` resolved it. |
| Component hash (from `dependencies.lock`) | `10698fd2d729b63cca8b882e219c3fa3bd8a9adea26f814f2febb624d0385c23` |

## Version alignment (task 002 acceptance)

The fork pins Lua via `components/claw_capabilities/cap_lua/idf_component.yml`:

    dependencies:
      georgik/lua: "^5.5.0~7"

The IDF component manager resolved that constraint to the exact version
`5.5.0~7` (recorded in `application/open_deskos/dependencies.lock` and in
`UPSTREAM.md`). These host-harness sources were taken from that same resolved
`managed_components/georgik__lua/` tree, so the Lua VM compiled on the host is
byte-for-byte the same source as the Lua VM compiled into the target firmware.

## Files

- `lua/*.c`, `lua/*.h` — Lua sources, verbatim.
- `include/luaconf.h` — the component's ESP-IDF-adapted `luaconf.h`, verbatim.

The host `CMakeLists.txt` compiles the same library translation units the
on-target component compiles, excluding `lua.c` (standalone interpreter with
`main()`), `onelua.c` (single-file amalgamation), and `ltests.c` (internal
instrumentation harness).
