# Repository Guidelines

## Project Structure & Module Organization
This SwiftUI client and macOS CLI belong to preserved P4+C6 research, not the active CM5 architecture. `OpenDeskOS.xcodeproj` contains the cross-platform `OpenDeskOS` GUI target and macOS-only `OpenDeskOSCLI` target (built binary `OpenDeskOS`). GUI sources are in `OpenDeskOS/`, CLI sources in `OpenDeskOSCLI/`, sidecar plugins in `OpenDeskOS/Resources/plugins/`, health launch agents in `LaunchAgents/`, and tests in `tests/`.

## Build, Test & Development Commands
From repository root:
```sh
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS -configuration Debug -destination 'platform=macOS' build
bash research/esp32-p4-c6-deskos/apple/tests/test_macos_management.sh
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI -configuration Release -destination 'generic/platform=macOS' -derivedDataPath build/open-deskos-cli build
OPEN_DESKOSCTL=build/open-deskos-cli/Build/Products/Release/OpenDeskOS zsh research/esp32-p4-c6-deskos/apple/tests/test_open-deskos_cli.sh
```

## Coding Style & Naming Conventions
- Standalone CLI-installed LaunchAgents use a stable, resolved absolute path to the `OpenDeskOS` binary; App-managed agents use `BundleProgram` at `Contents/Resources/OpenDeskOS`.
- For background health management, use @README.md: App-managed schedules and the standalone daemon are alternatives, not concurrent installations. App-bundled plists must not embed `FLOW_API_TOKEN`.
- This scope remains a P4 USB serial companion; do not introduce CM5 runtime dependencies or assume iOS/iPadOS CGEvent/HID injection support.

## Testing Guidelines
- `tests/test_macos_management.sh` builds an unsigned app in temporary DerivedData and inspects bundled CLI/LaunchAgents; it does not install them. Use it for management and packaging changes without a separate duplicate GUI build.
- `tests/test_open-deskos_cli.sh` requires zsh, the built CLI, `rg`, Python 3, and Xcode tools. It reads daemon status and starts loopback fixture servers on ports 18787/18788; it does not install a daemon.
- Running the live GUI, `daemon install/uninstall`, or `sub push` is not fixture verification: these can manage user services, read Keychain credentials, contact providers, or write to a USB device. Use them only within an authorized task.
