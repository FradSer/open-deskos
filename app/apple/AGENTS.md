# Repository Guidelines

Instructions specific to the macOS/iOS client in `app/apple/`. Repository-wide
rules live in the root `AGENTS.md`.

## Project Structure & Module Organization

- `OpenDeskOS.xcodeproj` — one Xcode project, two targets:
  - **OpenDeskOS** — SwiftUI cross-platform (iOS/iPadOS/macOS) GUI app.
  - **OpenDeskOSCLI** — macOS-only CLI target; the built product is `odkctl`.
- `OpenDeskOS/Plugins/` — sidecar plugin host (`PluginHost`, `SidecarProcess`);
  plugin payloads live in `OpenDeskOS/Resources/plugins/<name>/`
  (server bundle + `.proto.txt` contract).
- `LaunchAgents/` — launchd plists for per-user scheduled health checks;
  they reference the absolute installed path of `odkctl`.
- `tests/` — executable shell checks and BDD specs:
  - `test_macos_management.sh` — builds via `xcodebuild` and asserts views exist.
  - `test_open-deskos_cli.sh` — compiles CLI sources with `xcrun swiftc` directly.
  - `test_wispr_sidecar_auth.sh` — exercises a running Wispr Flow sidecar over HTTP.
  - `features/*.feature` — Given/When/Then behavior specs (no automated runner).

## Build & Test Commands

```sh
# Build the macOS CLI target
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build

# Run checks from repo root
bash app/apple/tests/test_macos_management.sh
bash app/apple/tests/test_open-deskos_cli.sh
```

## Coding Style & Conventions

- Standard Swift naming; no external Swift package dependencies are configured.
- New behavior starts as a scenario in `tests/features/`, then an executable
  check in `tests/`.
- The installed daemon depends on `odkctl` living at a stable absolute path
  (`/usr/local/bin/odkctl`) — see `app/README.md` before changing install layout.

## Scope Boundary

This app is **not** the OPEN-DESKOS.md §10 Rust companion. iOS/iPadOS cannot do
CGEvent/HID injection; see `../README.md` for the capability split.
