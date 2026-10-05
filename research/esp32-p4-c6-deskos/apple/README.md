# Preserved Apple P4 client

This SwiftUI app and macOS CLI serve the P4 research device through USB serial. They are not part of the active Electron Shell. The old Rust companion was a design proposal, not this Swift implementation. iOS and iPadOS cannot supply macOS CGEvent injection. Do not assume the mobile client has host injection, EventKit or package-install capabilities.

## macOS CLI and background checks

The Xcode project has a cross-platform GUI target named OpenDeskOS and a macOS-only CLI target named OpenDeskOSCLI. The CLI binary is OpenDeskOS. Run these commands from the repository root. The command samples below retain their original bytes and comments.

```sh
# 构建 CLI
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
# 将 Release 产物放到稳定路径后再安装 daemon；LaunchAgent 会记录这个绝对路径
cp build/open-deskos-cli/Build/Products/Release/OpenDeskOS /usr/local/bin/OpenDeskOS

# 检查 Wispr Flow sidecar
OpenDeskOS plugin health

# 安装/管理每用户定时健康检查（默认 30 分钟）
OpenDeskOS daemon install --interval 1800
OpenDeskOS daemon status
OpenDeskOS daemon uninstall

# 非默认端口：安装时将端点写入 LaunchAgent
FLOW_API_PORT=18787 OpenDeskOS daemon install --interval 900
# 或指定完整端点
OpenDeskOS daemon install --interval 900 --url http://127.0.0.1:18787/health
```

The standalone task uses ~/Library/LaunchAgents/dev.fradser.open-deskos.wispr-health.plist. Install the binary at a stable absolute path before you install the task. Each run calls plugin health, records last-run.json under ~/Library/Application Support/OpenDeskOS/CLI, writes logs/daemon.log and exits.

Without --url, FLOW_API_PORT selects the endpoint; the default is 127.0.0.1:8787. Reinstall after the port or binary path changes. If the sidecar requires FLOW_API_TOKEN, export it before installation. The CLI stores it in a mode-0600 plist. Reinstall after token rotation. The CLI checks health; it does not start or host the Bun sidecar.

Installing or removing a task changes user services. Live GUI actions can read Keychain data or contact a provider. A subscription push can write to the USB device. These actions require task authorization. See [local verification](AGENTS.md) for fixture checks.

## Subscription bridge

The bridge sends OpenCode Go usage to the P4 launcher through USB serial.

```sh
# 从 Keychain 读 opencode.ai 会话 cookie → 抓取用量 → 经 USB 串口推给设备
OpenDeskOS sub push [--serial /dev/cu.usbmodem*] [--dry-run]
OpenDeskOS sub pull  # 等价别名（循环模式由设备端刷新驱动）
```

- The data source is the Keychain service com.steipete.codexbar.cache, account cookie.opencodego. The client calls opencode.ai/_server subscription.get and billing. This provider interface can change.
- The transport is the esp_console REPL command cerb sub push. The firmware stores an NVS string snapshot through odk_sub. The launcher uses sub_get and sub_request_fresh.
- The device marks refresh when the usage page opens. The scheduled bridge checks cerb sub status for refresh=yes before it fetches and pushes data.
- If the client reports no opencode.ai session cookie, refresh the session in CodexBar.

## App management

Overview shows sidecar, session and background-check status. Wispr Flow selects session.json, controls the sidecar and shows a manual health-check result. Automation uses SMAppService for the bundled CLI and LaunchAgent. It offers 5, 15, 30 or 60-minute checks. When approval is required, approve OpenDeskOS in System Settings, General, Login Items.

The App-managed task has no FLOW_API_TOKEN. It calls the local 127.0.0.1:8787 health endpoint and does not start Bun. The transcription API retains bearer-token protection. A non-default FLOW_API_PORT disables the App-managed task and gives a CLI command. Use either the App-managed task or the standalone daemon, not both.

## Build layout

Keep platform files in apple/. Keep the CLI target name OpenDeskOSCLI for scripts. See AGENTS.md for build and packaging checks. App-managed agents use BundleProgram; standalone agents use a resolved absolute binary path. A simulator or unsigned packaging check does not verify live USB or user-service behavior.
