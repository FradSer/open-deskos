# User applications

User applications are installed local packages, separate from trusted built-in Shell plugins. Creating a file does not install it. The Shell owns the installed catalog and verification; the resident Agent invokes the Shell-owned lifecycle service. Widgets share ordinary desktop grid pages with built-in instruments; interactive Apps have individual pages. There is no separate Your apps collection page.

## Author a draft

Set `ODESK_WORKSPACE` to the shared writable project checkout in `~/.config/open-deskos/runtime.env` (mode 0600). Both Shell and resident Agent user units read this system configuration file; keep STT-specific settings in `voice-agent.env`. Restart both services after changing the workspace. For foreground development, export the variable explicitly. Create `apps/<id>/manifest.json` and `apps/<id>/index.html` under it. Application IDs use lowercase letters, digits and hyphens, start with a letter and are at most 64 characters.

```json
{"schemaVersion":1,"id":"desk-note","name":"Desk note","version":"1","kind":"widget"}
```

`kind` is `widget` (display-only) or `app` (interactive). HTML is self-contained, up to 256 KiB; inline CSS and JavaScript are supported. No npm installation, build command, network requests, external assets, Node, filesystem or parent/preload API is available inside application content. Use readable text and the Open DeskOS visual language. A minimal draft HTML is:

```html
<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Desk note</title>
<style>body{background:transparent;color:white;font:20px sans-serif}</style>
<body><p>Remember to take a break.</p></body></html>
```

The first version does not provide persistent per-app data or background services. In-memory UI state is discarded when its frame closes. Keep these limitations explicit when asking the Agent to create an application.

## Install and manage

Ask the resident Agent to install a draft, optionally specifying its desktop page and grid rectangle. The system snapshots and validates the exact bytes and starts a separate, time-bounded Electron verifier. Only a valid, visible, loadable candidate becomes installed. A verification failure leaves the installed version unchanged.

Widgets render at their persisted grid placement; Apps render on individual pages. Reinstalling an existing ID performs an **Update** and verifies the current draft again. **Rollback** verifies and restores the immediately preceding version. Successful updates retain only the active and preceding snapshots; old snapshots are pruned, with cleanup failures reported as warnings. **Remove** removes the installation, not the draft or separate user data. Installed snapshots and catalog live under `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos/user-apps`, outside the runtime release.

A fresh Shell process reads the installed catalog. Applications do not require modifying `index.html`, built-in layout or plugin registry, nor rebuilding the Shell release for each update. The runtime feature itself must first be deployed.

## Agent operations

The resident Agent writes the same draft format, then calls `user_app_install`. Other tools are `user_apps_list`, `user_apps_desktop`, `user_app_place`, `user_app_rollback`, and `user_app_remove`. They communicate with the running Shell via `$XDG_RUNTIME_DIR/open-deskos-apps/control.sock`; directory mode 0700, socket 0600. No network control listener is opened. A missing Shell is reported as unavailable, not successful installation.

Call `user_apps_desktop` before selecting a location. Its `pages` array includes stable IDs, one-based page indices (Home is page 2, Reading page 3), kinds, and for grids `columns: 5`, `rows: 3`, and occupied built-in/user rectangles. Only grid pages accept Widgets. Built-in cells remain reserved even when a development URL disables their plugin.

`user_app_install` accepts optional `placement: {pageId, col, row}`. `user_app_place` requires the same placement and moves/resizes an installed Widget without changing or reverifying its revision. The renderer may remount its frame, resetting ephemeral state. Columns and rows are CSS grid line strings: `"2"` is one cell, `"2 / 5"` spans three cells. For example, `{ "pageId": "reading", "col": "1 / 3", "row": "3" }` occupies two bottom-row cells on page 3. The private protocol uses commands `desktop`, `install`, and `place`, with `appId` rather than the tools' `id` parameter.

Explicit placements outside the grid, on non-grid pages, or overlapping built-in/installed Widgets are rejected; nothing is silently overwritten or relocated. Omitted placements retain an existing Widget's location or select the first free cell. Placement survives restart, update and rollback independently of revision bytes. Existing unplaced Widgets receive free cells when listed. If there is no capacity, they remain listed with `placementError: "desktop-full"`; removal and other lifecycle operations remain available. Interactive Apps do not accept grid placement.

Desktop preload exposes only list/dispatch and change subscription. Agent-generated tests can supplement validation, but cannot bypass the system verifier or submit an arbitrary executable verification command.

## Appearance: theme, tokens, and fonts

A package is served with the Shell's appearance, so a package can look native without vendoring a palette or a face:

- `<html data-theme="instrument|pixel|border-beam">` names the active appearance.
- `--odk-*` resolves the appearance's semantic tokens (`--odk-primary`, `--odk-surface`, `--odk-stroke`, `--odk-radius-card`, `--odk-space-*`, `--odk-text-label`, `--odk-text-body`, `--odk-cell`). Every appearance's values are present at once, so a switch needs no reload.
- `--odk-radius-tile` is the radius the frame around the package actually renders with; use it for inner surfaces.
- The appearance's own face is declared and applied: Zpix in Pixel, Noto Sans SC with Montserrat in Instrument and Border Beam. `--odk-font` names it.
- `data-theme` follows a live theme change, published to the frame by the Shell. A package that branches on it needs no reload handling of its own.

A minimal package that inherits everything:

```html
<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Desk note</title>
<style>body{margin:0;background:var(--odk-bg);color:var(--odk-primary);font:var(--odk-text-body)/1.4 var(--odk-font);padding:var(--odk-widget-inset)}</style>
<body><p style="border-radius:var(--odk-radius-tile);background:var(--odk-surface);padding:var(--odk-space-3)">Remember to take a break.</p></body></html>
```

Icon path data is not served: the Pixel icon set is MIT-licensed data a package may embed, and a package switches between its own stroke and pixel variants on `data-theme`. Nothing else changed — the sandbox still grants no network, no Shell DOM, and no preload API, and the appearance context cannot read files outside the running release.

## Runtime safety and limits

The Shell keeps its strict script policy. A dedicated `odk-user-app` protocol serves only installed revision URLs with restrictive content policy. Frames use `sandbox="allow-scripts"` without same-origin authority. They cannot navigate the parent, create privileged windows, access Shell DOM/preload or fetch network data.

The bounded candidate verifier catches initial rendering failures and synchronous hangs. It does not prove application business correctness, test every future interaction, or enforce live CPU/memory quotas. A later infinite loop can still harm responsiveness; this is not a general untrusted-code hosting platform. Install only locally reviewed user-generated packages.

## Verify

```sh
cd runtime/linux
node --test tests/user-app*.test.js
pnpm exec electron tests/user-app-lifecycle.cjs
pnpm test
bash tests/smoke.sh
```

The lifecycle integration test actually installs, renders an opaque-origin frame, updates, rejects a broken revision, restores state after restart, rolls back and removes a temporary package. Tests use temporary directories, never the user's installed application state. Host checks do not establish CM5 hardware acceptance.

Placement tests cover exact spans, occupied/out-of-bounds rejection, concurrent installation, persistence through revision changes, existing unplaced Widgets, desktop capacity recovery, and corrupt catalog metadata. Voice tests exercise the actual private socket request contract. Host checks do not establish CM5 hardware acceptance.
