# User applications

User applications are installed local packages, separate from trusted built-in Shell plugins. Creating a file does not install it. The Shell owns the installed catalog and verification; the resident Agent and the Your apps page use the same lifecycle operations.

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

Open **Your apps**, enter the draft ID and choose **Install**. The system snapshots and validates the exact bytes and starts a separate, time-bounded Electron verifier. Only a valid, visible, loadable candidate becomes installed. A verification failure leaves the installed version unchanged.

The page shows installed widgets and allows opening/closing interactive apps. **Update** verifies the current draft again. **Rollback** verifies and restores the immediately preceding version. Successful updates retain only the active and preceding snapshots; old snapshots are pruned, with cleanup failures reported as warnings. **Remove** removes the installation, not the draft or separate user data. Installed snapshots and catalog live under `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos/user-apps`, outside the runtime release.

A fresh Shell process reads the installed catalog. Applications do not require modifying `index.html`, built-in layout or plugin registry, nor rebuilding the Shell release for each update. The runtime feature itself must first be deployed.

## Agent operations

The resident Agent writes the same draft format, then calls `user_app_install`. Other tools are `user_apps_list`, `user_app_rollback`, and `user_app_remove`. They communicate with the running Shell via `$XDG_RUNTIME_DIR/open-deskos-apps/control.sock`; directory mode 0700, socket 0600. No network control listener is opened. A missing Shell is reported as unavailable, not successful installation.

Desktop preload exposes only list/dispatch and change subscription. Agent-generated tests can supplement validation, but cannot bypass the system verifier or submit an arbitrary executable verification command.

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

Current verification: scoped lifecycle tests, runtime unit tests, smoke and the
real Electron lifecycle sequence pass. The five-page marker test also passes,
including 320px layouts. Full desktop E2E remains red on the concurrent WeRead /
Pi widget composition, density and interiors checks; it is not a release pass.
No device deployment or model-generated real application has been claimed from
these deterministic host tests.
