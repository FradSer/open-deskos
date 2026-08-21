# app/

Open DeskOS 各平台客户端的 monorepo 分类目录。按**平台/运行时**分子目录,不按品牌名——便于将来加新端时结构对称。

## 子目录

| 目录 | 平台 | 说明 |
|---|---|---|
| [apple/](apple/) | Apple 生态原生(SwiftUI,iOS/iPadOS/macOS) | 跨端原生客户端 |
| [linux/](linux/) | Linux(Electron,Orange Pi CM5/RK3588S) | 568×1232 竖屏触摸外壳切片(迁移评估第一步) |

> 待补:`web/` 等。

## apple/ 与 §10 Rust companion 的边界(必读)

`app/apple/` 下的 Swift 工程**不是** [OPEN-DESKOS.md §10](../docs/open-deskos/OPEN-DESKOS.md) 定义的 **companion**(macOS 常驻端,Rust)。两者是不同实现:

| 维度 | companion(§10) | apple/ 本工程 |
|---|---|---|
| 语言/栈 | Rust workspace + menu bar tray + launchd | SwiftUI + Xcode project |
| 形态 | macOS menu bar 常驻 | iOS/iPadOS/macOS 跨端原生 |
| 能力 | CGEvent 中文注入、hidapi HID 读、EventKit、Shortcuts 桥、包侧载 + 生成工作台 | iOS/iPadOS **无法** CGEvent 注入;为只读/远程/设置形态 |

关键约束:**iOS/iPadOS 不能做 HID/CGEvent 注入**,所以本客户端不是 companion 的 Swift 重写,而是面向移动端的能力子集形态。companion 仍是 macOS 注入/常驻/EventKit 的唯一权威实现;两者各管一端,不要视为同一物的两种实现。

## macOS CLI

除了跨端 `OpenDeskOS` SwiftUI app，Xcode 工程还包含一个仅 macOS 的 `OpenDeskOSCLI` target，产物名为 `odkctl`。它和 GUI 共享同一套 sidecar 约定，但不依赖 SwiftUI 生命周期，适合被 `launchd` 无界面调用：

```sh
# 构建 CLI
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
# 将 Release 产物放到稳定路径后再安装 daemon；LaunchAgent 会记录这个绝对路径
cp build/open-deskos-cli/Build/Products/Release/odkctl /usr/local/bin/odkctl

# 检查 Wispr Flow sidecar
odkctl plugin health

# 安装/管理每用户定时健康检查（默认 30 分钟）
odkctl daemon install --interval 1800
odkctl daemon status
odkctl daemon uninstall

# 非默认端口：安装时将端点写入 LaunchAgent
FLOW_API_PORT=18787 odkctl daemon install --interval 900
# 或指定完整端点
odkctl daemon install --interval 900 --url http://127.0.0.1:18787/health
```

定时任务采用 `~/Library/LaunchAgents/dev.fradser.open-deskos.wispr-health.plist`。安装时 CLI 会经 `PATH` 解析自身并将稳定的绝对路径写进 Agent；`launchd` 每次启动短命令，运行 `odkctl plugin health --daemon --url <endpoint>` 后退出。最后一次结果保存在 `~/Library/Application Support/OpenDeskOS/CLI/last-run.json`，日志写入同目录下的 `logs/daemon.log`。未传 `--url` 时端点来自 `FLOW_API_PORT`（默认 `127.0.0.1:8787`）；端口或 CLI 路径变更后重新安装 daemon。如 sidecar 启用了 `FLOW_API_TOKEN`，请在安装 daemon 前导出它；CLI 会把该变量写入权限为 `0600` 的 LaunchAgent plist，轮换 token 后需重新安装。CLI 不会替 GUI 启动或托管 Bun sidecar，只负责健康检查和定时任务管理。

## 订阅桥接 (`odkctl sub`)

把用户的 **OpenCode Go 订阅用量**（CodexBar 菜单栏显示的那份数据）经 USB 推到 Open DeskOS 设备，让固件 launcher 首页 #2 显示真实用量而不是占位符：

```sh
# 从 Keychain 读 opencode.ai 会话 cookie → 抓取用量 → 经 USB 串口推给设备
odkctl sub push [--serial /dev/cu.usbmodem*] [--dry-run]
odkctl sub pull  # 等价别名（循环模式由设备端刷新驱动）
```

- **数据源**：macOS Keychain `com.steipete.codexbar.cache` / 账号 `cookie.opencodego`（CodexBar 缓存的 opencode.ai 会话 cookie），POST `https://opencode.ai/_server`（subscription.get / billing）拿 5 小时滚动窗口百分比、周/月用量与 Zen 余额。
- **传输**：USB Serial/JTAG 串口 `esp_console` REPL，命令 `cerb sub push plan=opencode-go primaryPct=62 ...`。固件端 `odk_sub`（NVS 字符串快照）+ launcher `sub_get`/`sub_request_fresh` 渲染。
- **拉取模型**：设备打开首页 #2 时置 `refresh` 标记；launcher 有数据即重绘，桥接器在 launchd 定时模式下轮询 `cerb sub status` 检测 `refresh=yes` 后再抓取推送（“打开屏时拉取”）。
- cookie 失效时 `sub push` 会报 `no opencode.ai session cookie`；打开 CodexBar 刷新一次即可。

## macOS 管理界面

macOS 版 OpenDeskOS 主窗口提供三个管理页：

- `Overview` 汇总 Wispr Flow、会话和后台检查的状态，并给出下一步操作。
- `Wispr Flow` 可选择或更换 `session.json`、启动/停止/重启 sidecar，以及查看一次手动健康检查的 HTTP 状态、耗时和时间。
- `Automation` 用 macOS `SMAppService` 管理随 App 打包的 `odkctl` 和 LaunchAgent，可选每 5、15、30 或 60 分钟执行一次健康检查。首次启用如显示“Approval required”，请在“系统设置 → 通用 → 登录项”中批准 OpenDeskOS。

App 管理的 LaunchAgent 不携带 `FLOW_API_TOKEN`，也不会启动 Bun；它只访问绑定到 `127.0.0.1:8787` 的无敏感数据 `/health` 端点。转写 API 仍保持 bearer token 保护。若使用非默认 `FLOW_API_PORT`，Automation 会禁用 App 管理的任务并给出含该端点的 CLI 命令。不要同时启用 App 管理的后台检查和 `odkctl daemon install`，以免重复执行；后者继续适用于无界面、自定义端口或自定义间隔的场景。

## 工程命名

- 目录按平台命名(`apple/`),内部 `.xcodeproj` + 源码组同名是 Xcode 默认布局,保留。
- 当前 GUI target/工程名 `OpenDeskOS` 为**占位**;正式产品名拍板后,改 GUI target 名 + `PRODUCT_BUNDLE_IDENTIFIER` 一处即可,CLI target 保持 `OpenDeskOSCLI` 便于脚本调用,目录结构不动。
- 固件侧品牌为 `odk_*`(213 处 `odk_err_t` / `.cerb-pack` / `open-deskos_sim`)。占位名正式化时统一对齐,避免大写 `OpenDeskOS` 与 `odk_*` 交错。
