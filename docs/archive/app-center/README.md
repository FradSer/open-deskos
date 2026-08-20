# App Center Concept Archive

> **Status**: Archived (2026-08)  
> **Reason**: Temporarily removed from active system concepts and desktop pages pending future refactoring into a modern plugin/package store.

---

## 1. Overview & Purpose

The **App Center** was originally conceived as the on-device catalog and package management interface for Open DeskOS. It allowed users to:
1. Browse a list/catalog of installable applications (both built-in and remote).
2. Install, launch, and uninstall Lua-based sandboxed content packages.
3. Access a third/fourth desktop page representing the catalog (`Homepage / #3`).

During the Open DeskOS v2.0 modular plugin architecture refactoring, all applications were unified into self-contained plugins under `plugins/` and managed dynamically by `core/plugin_registry.lua`. The legacy `app_center.lua` and `store.lua` stub were extracted and archived here to keep the desktop shell minimal and cohesive.

---

## 2. Preserved Files in this Archive

| File | Description |
|---|---|
| `app_center.lua` | LVGL-based scrollable catalog page UI builder (`Homepage / #3`). |
| `app_center.md` | Specification for `app_center.lua`. |
| `store.lua` | Static catalog definition stub containing app metadata and entry points. |
| `store.md` | Specification for `store.lua`. |

---

## 3. Related Historical Plans & Design Documents

The App Center went through several design iterations, all preserved in `docs/plans/`:

- **[P7 App Center Minimal Content Package (2026-07-02)](../../plans/2026-07-02-lumina-p4-app-center-design/)**: Initial minimal content package design for LUMINA-P4, defining `LP4_MODE_APP_CENTER` and SD card package distribution.
- **[Capability API Platform Discussion (2026-07-02)](../../plans/2026-07-02-capability-api-platform-discussion.md)**: Brainstorming on expanding from static content packages to programmable Lua applications.
- **[Open DeskOS App Center Redesign (2026-07-04)](../../plans/2026-07-04-cerberus-app-center-redesign-design/)**: Full programmable application platform design inspired by LuaRocks, esp-claw, and Mooncake.
- **[One-Prompt App Plan (2026-07-10)](../../plans/2026-07-10-cerberus-one-prompt-app-plan/)**: Implementation of on-device LLM generation, staging, SHA-256 validation, atomic installation, and FAT partition persistence.

---

## 4. Future Refactoring Roadmap

When App Center is reintroduced in a future increment:
1. **Plugin Registry Integration**: It will interface directly with `core/plugin_registry.lua` rather than maintaining a separate `store.lua` array.
2. **Dynamic Store & Package Hub**: Fetching packages from a remote REST/WebSocket endpoint or local sideload directory.
3. **Dedicated App / Settings Surface**: Opening as a dedicated full-screen management app rather than taking up a fixed slot on the home horizontal pager.
4. **Manifest v2 Compliance**: Strict semver, capability consent dialogs, and atomic rollback on failed verification.
