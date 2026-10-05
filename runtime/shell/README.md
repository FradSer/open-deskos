# Open DeskOS Shell

Linux, Windows x64 and macOS run the same Electron Display Shell in `runtime/shell/`. Orange Pi CM5 (RK3588S, Linux arm64) is the reference host. Its default HDMI content size is 1920×1280. The platform layer owns host differences.

Use [root PRODUCT](../../PRODUCT.md) for product scope, [CONTEXT](CONTEXT.md) for terms, and [ARCHITECTURE](docs/ARCHITECTURE.md) for decisions. [WINDOWS_HOST](docs/WINDOWS_HOST.md) owns Windows operations. The systemd, GPU and release commands below are CM5/Linux operations.

The internal package ID `@fradser/open-deskos-linux-shell` preserves Electron user-data locations. It does not restrict supported hosts. The Apple P4 USB companion remains separate research. S3 Remote, P4 camera/microphone and C6 hardware gates never block base installation or direct input.

## Development

```sh
cd runtime/shell
pnpm install
pnpm styles
./run.sh
ODESK_SHELL_KIOSK=1 ./run.sh --kiosk
bash tests/smoke.sh
pnpm test
pnpm run e2e
pnpm exec electron tests/widget-app-styles.cjs
pnpm exec electron tests/widget-density.cjs
pnpm exec electron tests/page-indicator.cjs
pnpm exec electron tests/pixel-font.cjs
pnpm exec electron tests/pi-sessions-states.cjs
pnpm exec electron tests/capture-sheet.cjs
```

Linux/macOS use `./run.sh`; Windows uses `run.ps1`. Use `node tests/smoke.mjs` for the shared smoke checks. `tests/smoke.sh` is the CM5 wrapper. Live startup reads configured services and user state; it is not an isolated fixture test.

The Pi state capture harness asserts fixture DOM states before writing screenshots and `manifest.json`. Screenshots support review; DOM assertions decide the result. It defaults to this checkout. To inspect an installed release:

```sh
ODK_SHELL_ROOT=/opt/open-deskos/current ODK_CAPTURE_DIR=/tmp/states \
  electron tests/pi-sessions-states.cjs
ODK_SHEET_DIR=/tmp/states ODK_SHEET_OUT=/tmp/states/sheet.png \
  electron tests/capture-sheet.cjs
```

## Themes and geometry

Pixel uses the unchanged local Zpix v3.2.0 WOFF2 for Latin/CJK text without synthetic bold. Personal/education terms differ from commercial terms. Keep the original [Zpix notice](src/renderer/fonts/ZPIX-NOTICE.md) and obtain the author's commercial license when required.

Border Beam uses local CSS inspired by [Libraries.dev](https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/border-beam). No React dependency is added. New installs default to Pixel. Development can select `odkTheme.set('border-beam')` or `odkTheme.set('instrument')`; the selection persists. Reduced motion stops border movement; hidden windows pause it. Run `pnpm exec electron tests/border-beam-theme.cjs`. CM5 drawing performance requires device evidence.

All themes retain page, focus and hit areas. State Bar paging uses dots/bars. Pi and page capsules are 44px high. Run `pnpm geometry` after Widget composition, placement or type changes. Widgets adapt to Cells and preserve type floors. Apps can scroll; glanceable Widgets cannot.

Density checks run in E2E. To collect focused measurements:

```sh
pnpm exec electron tests/widget-density.cjs --state=live --sizes=1920x1280,480x854
pnpm exec electron tests/widget-density.cjs --date=2026-12-31T23:59:00
pnpm exec electron tests/widget-density.cjs --report-only --output=/tmp/widget-density.json --capture-dir=/tmp/widget-density
```

The content-box target is 62%, with an eight-percentage-point tolerance. Union occupancy must reach 20%; the largest full-width vertical gap is at most 28%. Measure tight text/SVG/meter boxes, not empty containers or backgrounds. Do not count overlaps twice. These are visual boxes, not glyph-pixel coverage.

A fixed clock makes runs repeatable. `--date` changes it; `--capture-dir` saves Home and individual Widget images. A violation returns nonzero. `--report-only` collects the failure and still reports `ok:false`; it never establishes acceptance.

Wayland startup adds `--ozone-platform-hint=auto`; root startup adds `--no-sandbox`.

## Data, control and voice

[Desk Link](docs/DESK_LINK.md) owns reporting and separately authenticated Hosted Pi control. A Console disconnect does not end its Hosted Pi. Monitoring does not grant control; accepted delivery does not prove completion. The [optional SSH source](docs/DESK_LINK.md#optional-mac-ssh-source) uses a pull scan. A failed selected source does not become local data or idle state.

[Installed packages](docs/USER_APPLICATIONS.md) own draft format, verification, placement and revision lifecycle. Drafts use writable `ODESK_WORKSPACE`; the active release stays immutable. Writing a file does not install it.

[Personal Bot](../../integrations/personal-bot/README.md) owns coordination. [Deployment](docs/PERSONAL_BOT_DEPLOYMENT.md) owns host setup. [Voice feedback](docs/VOICE_FEEDBACK.md) owns recording, restore and streaming behavior. Live microphone, provider and model checks need separate authorization and evidence.

## CLIProxyAPI on Linux

Configure the CM5 user session:

```sh
export ODK_CLIPROXY_URL=https://cliproxy.internal.example
export ODK_CLIPROXY_MANAGEMENT_KEY_FILE=/etc/open-deskos/cliproxy-management.key
```

The Shell reads quotas from CLIProxyAPI's existing authentication files. It does not copy OAuth tokens or read macOS Keychain. Prefer a management key file with mode `0600`. `ODK_CLIPROXY_MANAGEMENT_KEY` remains a temporary environment form. Keep keys and authentication files out of Git and logs.

Remote management requires HTTPS. Plain HTTP is allowed only for `127.0.0.1`, `::1` or `localhost`. Requests and provider token replacement stay in main/CLIProxyAPI. The renderer receives only sanitized account, plan, quota and reset fields; CSP denies remote connections and preload never exposes tokens. A failed provider leaves its card unavailable without stopping other accounts.

## Peripherals

The [P4 runbook](../../peripherals/esp32-p4-camera/README.md) owns wiring, build and firmware gates. P4 exposes standard UVC MJPEG and UAC audio. It performs no face recognition, expression analysis or biometric storage. Camera/microphone acceptance stays separate from base Shell installation.

For a native MIPI DSI extension, verify the exact carrier, panel and kernel together. HDMI plus third-party MIPI is not yet accepted as two independent displays.

- Confirm controller, lane mapping, FPC contact direction, power rails/sequences, reset and touch support. Never guess negative-voltage requirements.
- Require a Linux DRM panel driver and a matching device-tree configuration. A similar controller name is not a compatible driver.
- Verify independent HDMI/MIPI outputs with `modetest -c` or `xrandr` on the target kernel, DTB and desktop. Host tests cannot accept the wiring or panel.
- The recorded [BOE Linux driver source](https://codebrowser.dev/linux/linux/drivers/gpu/drm/panel/panel-boe-bf060y8m-aj0.c.html) is a driver reference, not a purchase recommendation or CM5 integration proof. Use the exact CM5 carrier manual for connector/pin-mux authority.

## Approved CM5 deployment

Run from the repository root after deployment authorization:

```sh
# From the development checkout: stage, preflight, activate, then verify on CM5.
bash runtime/shell/scripts/cm5-stage-release.sh

# Optional, only after the camera hardware acceptance gate:
# bash runtime/shell/scripts/p4-camera-acceptance.sh

ssh cm5 'cd /opt/open-deskos/current && bash scripts/cm5-acceptance.sh'
```

The graphical autostart imports display variables and starts `open-deskos-shell.service`. The service resolves the active release and restarts after exit. Its log is `~/.local/state/open-deskos-shell/launcher.log`.

Composition validation requires `schemaVersion:1`. Extra declared fields such as tile `minCell` are valid; a missing schema version fails. `tests/runtime-release.test.js` covers both cases.

## Controlled runtime update

The installer builds a versioned release and creates `/opt/open-deskos/current`. A candidate needs valid `release.json`: schema version 1 and an ID matching its directory. It must pass `pnpm preflight` before activation. Failed post-activation kiosk/smoke restores the previous release.

Run the standalone updater from the runtime directory only for an approved activation:

```sh
sudo ODK_RUNTIME_ROOT=/opt/open-deskos \
ODK_CANDIDATE_RELEASE=/opt/open-deskos/releases/<release-id> \
ODK_KIOSK_USER=<kiosk-user> \
ODK_KIOSK_UID=$(id -u <kiosk-user>) \
ODK_KIOSK_HOME=/home/<kiosk-user> \
node scripts/update-runtime.js
```

Only one transaction can update pointers. State, rollback selection and per-user migration markers live under `/opt/open-deskos/state/`. Runtime rollback excludes system packages, kernel, host desktop and experiment services.

`cm5-acceptance.sh` reports active/rollback releases, migrations, base Shell, peripheral services and hardware separately. A host/no-display report is diagnostic evidence, not physical CM5 acceptance.

Remote Bridge uses `$XDG_RUNTIME_DIR/open-deskos-remote/bridge.sock`. Production does not support a socket override. Tests can use `ODESK_SHELL_TEST_MODE=1` with an absolute `ODESK_REMOTE_BRIDGE_SOCKET`.

## Tests without a display

```sh
xvfb-run -a --server-args="-screen 0 1920x1280x24" bash tests/smoke.sh
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a --server-args="-screen 0 1920x1280x24" \
  ./node_modules/.bin/electron tests/e2e.js
```

Host fixture checks do not establish physical touch, S3 Remote input, screen-reader announcements, GPU performance, live microphone or provider accuracy. Aggregate E2E acceptance requires every required subprocess to pass; scoped success never replaces a failed aggregate.

[ADR-0016](docs/ARCHITECTURE.md#adr-0016) records the Mali blob/firmware pair and software presentation trade-off. Restart the graphical session after `scripts/cm5-gpu-userspace.sh` installs/removes userspace. Check EGL, Xorg glamor and Mesa GLX separately; GLX alone does not prove GPU acceptance.
