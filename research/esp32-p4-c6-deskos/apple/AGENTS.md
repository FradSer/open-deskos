# Repository Guidelines

## Project Structure & Module Organization

- `OpenDeskOS.xcodeproj` — one Xcode project, two targets:
  - **OpenDeskOS** — SwiftUI cross-platform (iOS/iPadOS/macOS) GUI app.
  - **OpenDeskOSCLI** — macOS-only CLI target; the current built executable is `OpenDeskOS` (the source target remains `OpenDeskOSCLI`).
- `OpenDeskOS/Plugins/` — sidecar plugin host (`PluginHost`, `SidecarProcess`);
  plugin payloads live in `OpenDeskOS/Resources/plugins/<name>/`
  (server bundle + `.proto.txt` contract).
- `LaunchAgents/` — launchd plists for per-user scheduled health checks;
  they reference the absolute installed path of the `OpenDeskOS` executable.
- `tests/` — executable shell checks and BDD specs:
  - `test_macos_management.sh` — builds via `xcodebuild` and asserts views exist.
  - `test_open-deskos_cli.sh` — compiles CLI sources with `xcrun swiftc` directly.
  - `test_wispr_sidecar_auth.sh` — exercises a running Wispr Flow sidecar over HTTP.
  - `features/*.feature` — Given/When/Then behavior specs (no automated runner).

## Build & Test Commands

```sh
# Build the SwiftUI management app (also embeds the CLI)
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS \
  -configuration Debug -destination 'platform=macOS' build
bash research/esp32-p4-c6-deskos/apple/tests/test_macos_management.sh

# Build and exercise the standalone CLI target
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
OPEN_DESKOSCTL=build/open-deskos-cli/Build/Products/Release/OpenDeskOS \
  bash research/esp32-p4-c6-deskos/apple/tests/test_open-deskos_cli.sh
bash research/esp32-p4-c6-deskos/apple/tests/test_wispr_sidecar_auth.sh  # optional Bun sidecar integration check
```

## Coding Style & Conventions

- Standard Swift naming; the Xcode project has no external Swift package dependencies configured. Keep GUI code in `OpenDeskOS/`, CLI code in `OpenDeskOSCLI/`, and sidecar payloads under `OpenDeskOS/Resources/plugins/`.
- New behavior starts as a scenario in `tests/features/`, then an executable
  check in `tests/`.
- The installed daemon resolves and records the built `OpenDeskOS` executable at
  a stable absolute path; see `README.md` before changing install layout.

## Scope Boundary

This SwiftUI client is not the planned Rust companion from
`../docs/OPEN-DESKOS.md` §10. iOS/iPadOS cannot perform CGEvent/HID
injection; keep that capability in the future macOS companion rather than this
cross-platform client.
