# Repository Guidelines
## Project Structure & Module Organization
This SwiftUI client and macOS CLI belong to preserved P4+C6 research, not the active CM5 architecture. `OpenDeskOS.xcodeproj` has the cross-platform `OpenDeskOS` GUI target and macOS-only `OpenDeskOSCLI` source target, whose built executable is `OpenDeskOS`. GUI code is under `OpenDeskOS/`; CLI code is under `OpenDeskOSCLI/`; sidecar payloads are under `OpenDeskOS/Resources/plugins/`; per-user health plists are in `LaunchAgents/`; BDD and executable checks are in `tests/`.
## Build, Test & Development Commands
From repository root:
```sh
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS -configuration Debug -destination 'platform=macOS' build
bash research/esp32-p4-c6-deskos/apple/tests/test_macos_management.sh
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI -configuration Release -destination 'generic/platform=macOS' -derivedDataPath build/open-deskos-cli build
OPEN_DESKOSCTL=build/open-deskos-cli/Build/Products/Release/OpenDeskOS bash research/esp32-p4-c6-deskos/apple/tests/test_open-deskos_cli.sh
```
`test_wispr_sidecar_auth.sh` is optional integration coverage.
## Coding Style & Testing Guidelines
Use standard Swift naming. Start behavior changes in `tests/features/`, then add a focused executable check. LaunchAgents must retain the resolved absolute path to the built `OpenDeskOS` executable. This scope remains a P4 USB serial companion; do not introduce CM5 runtime dependencies or claim iOS/iPadOS CGEvent/HID injection support.
## Commit & Pull Request Guidelines
Use focused Conventional Commits, report the Xcode/test commands used, and keep sidecar credentials and generated artifacts out of commits. See local `README.md` before changing installation behavior.
