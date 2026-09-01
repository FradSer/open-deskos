# Repository Guidelines

## Project Structure & Module Organization
This SwiftUI client and macOS CLI belong to preserved P4+C6 research, not the active CM5 architecture. `OpenDeskOS.xcodeproj` contains the cross-platform `OpenDeskOS` GUI target and macOS-only `OpenDeskOSCLI` target (built binary `OpenDeskOS`). GUI sources are in `OpenDeskOS/`, CLI sources in `OpenDeskOSCLI/`, sidecar plugins in `OpenDeskOS/Resources/plugins/`, health launch agents in `LaunchAgents/`, and tests in `tests/`.

## Build, Test & Development Commands
From repository root:
```sh
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS -configuration Debug -destination 'platform=macOS' build
bash research/esp32-p4-c6-deskos/apple/tests/test_macos_management.sh
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI -configuration Release -destination 'generic/platform=macOS' -derivedDataPath build/open-deskos-cli build
OPEN_DESKOSCTL=build/open-deskos-cli/Build/Products/Release/OpenDeskOS bash research/esp32-p4-c6-deskos/apple/tests/test_open-deskos_cli.sh
```

## Coding Style & Naming Conventions
- Standard Swift style, naming, and concurrency patterns.
- Keep LaunchAgents referencing resolved absolute paths to the built `OpenDeskOS` binary.
- This scope remains a P4 USB serial companion; do not introduce CM5 runtime dependencies or assume iOS/iPadOS CGEvent/HID injection support.

## Testing Guidelines
- Start behavior changes in `tests/features/` before updating client logic.
- Execute bash test scripts (`test_macos_management.sh`, `test_open-deskos_cli.sh`) to verify management and CLI contracts.

## Commit & Pull Request Guidelines
- Use focused Conventional Commits (`feat(mac):`, `fix(mac):`, `refactor(mac):`).
- Report the Xcode build and test commands used.
- Keep sidecar credentials, Keychain tokens, and generated artifacts out of commits.
