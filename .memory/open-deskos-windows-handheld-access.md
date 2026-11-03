---
description: 64-bit Windows 掌机的接入方式：Tailscale 上的公钥 SSH、Session 0 无桌面所以 GUI 工作走交互计划任务、带哈希门控的同步部署
type: project
---

这是 64-bit Windows 掌机（Open DeskOS 的第二个 Shell Host ✓）的实测接入事实。完整流程归 `runtime/linux/docs/WINDOWS_HOST.md` ✓ ✓，本文件只留跨会话最容易忘的连接与操作约定 ✓ ✓。CM5 参考宿主的接入归 `open-deskos-cm5-ssh-access.md` ✓，两者共用的排障陷阱归 `open-deskos-device-diagnostic-gotchas.md` ✓，Futu 持仓事故归 `open-deskos-futu-holdings-refresh.md` ✓。

**怎么连** ✓：用户 `frads`（管理员 ✓，从 SSH 拿到 High integrity ✓）。`ssh -i ~/.ssh/id_ed25519 frads@100.82.50.70`（Tailscale ✓）✓，MagicDNS 同义 `frads@desktop-qlqd17f.tail27726.ts.net` ✓，局域网 `frads@192.168.50.225` ✓。`~/.ssh/config` **没有**这台机器的条目 ✓ —— 一律用显式参数调用 ✓ ✓。授权文件是 `C:\ProgramData\ssh\administrators_authorized_keys` ✓（管理员标准位置 ✓，用户目录没有 `.ssh\authorized_keys` ✓）；开发机那把钥匙的指纹 `SHA256:RNMyWZCU294srI7D8Eu5mUeD5KVnttqVKHKxZV5E/+I` ✓ ✓，换机器时用它比对 ✓。

**与「运行时通道鉴权」是两回事** ✓：SSH 是我的运维通路 ✓；desk ↔ 机器/插件/语音那条路走的是 ADR-0025 的 **Channel Token** ✓ —— 能按所有权认证就按所有权（Unix socket 目录 0700 ✓、socket 0600 ✓），命名管道与 `tcp://` 才用每主机一个 32 字节令牌 ✓（连接首行 `{"v":1,"token":…}` ✓、常数时间比较 ✓ ✓）。令牌值从不打印 ✓ ✓。

**三个每次都会咬人的坑** ✓：

- **SSH 是 Session 0 ✓ 没有交互桌面** ✓ —— Electron 夹具、抓屏、kiosk 都要从**交互计划任务**跑 ✓，且任务**从 SSH 注册** ✓，绝不在任务里再注册任务（Windows 禁止链式持久化 ✓ ✓）。
- **远程 `.ps1` 必须纯 ASCII** ✓ —— PS 5.1 按系统代码页解析无 BOM 的 UTF-8 ✓，一个中文/非 ASCII 字符就语法报错 ✓。也别把 PowerShell 拼成一行穿 ssh ✓：cmd 吃掉引号与 `|`、`&`、`>` ✓ ✓（本次取证当场又撞了一次 ✓）。写文件 → 上传 → 执行 ✓。
- **同步是带哈希门控的部署 ✓ 不是拷贝** ✓：按**仓库根相对路径**打 tar ✓ + 逐文件 `md5 -q` 期望清单 ✓ → scp 到 `C:\Users\frads\` ✓ → 设备脚本在仓库根解包并用 `Get-FileHash -Algorithm MD5` 逐文件比对 ✓ → 全等才 `DEPLOY_OK` ✓ 并重建 `uno.css` ✓ + 重启 desk ✓。包**永不包含 `.env.local` 或任何设备状态** ✓ ✓。轮询日志要用**本次运行独有的哨兵** ✓（旧日志里也有 `DONE` ✓，读到会把上次当本次 ✓ ✓）。PS 5.1 的 `Join-Path` 是拼接不是解析 ✓，所以部署脚本参数给**相对名** ✓ ✓。

这个门已经当场抓到过两类真实事故 ✓：包解在子目录留下一棵 `runtime\runtime\…` 树（desk 仍在读旧文件 ✓）、设备上残留上一个 commit 的混合状态 ✓ ✓。

**未处置的安全项** ✓：`sshd_config` 里 `PasswordAuthentication` 与 `PubkeyAuthentication` 都还是注释掉的**默认值** ✓，即**口令登录仍开着** ✓ —— 端口只在 tailnet 可见是唯一理由 ✓。关法与验证步骤在 runbook 里 ✓ ✓；**改服务属于运维动作，需要 operator 点头才动** ✓ ✓。

**设备会挂起** ✓：电池供电 + 屏幕熄灭会断开 Wi-Fi ✓，长任务前必须接电 ✓（已发生过一次 `pnpm install` 被挂起打断 ✓ ✓）—— 详见 runbook 的「长任务与掌机省电」✓ ✓。

## Active release model (verified 2026-11-02)

The desk and its companion tasks run from an immutable release directory, not from `ODK_WORKSPACE`.
A release is `%LOCALAPPDATA%\odk\releases\<yyyymmdd>-<branch>-<sha>`.
`release.json` carries `id` and `sourceCommit`; `source-receipt.json` lists every non-`node_modules` file with SHA-256.

Release layout: `runtime/shell/**` flattens to the release root; `runtime/android` becomes `android/`; `integrations/`, `peripherals/`, `.agents/`, `experiments/` keep their repository paths; root `DESIGN.md` is copied.

Task definitions reference the release explicitly, so a new release needs a task re-registration:
`OdkDesk` and `OdkDeskLink` use `deployment-backups\<id>\windows-release-entry.ps1` with `-RuntimeRoot`; `OdkPersonalAgent` uses `<release>\scripts\windows-personal-agent.ps1`.

- Copying another release's `node_modules` is wrong: top-level entries are relative symlinks into `.pnpm`, and a recursive file copy materialises them as real directories, which hides dependency siblings. Run `pnpm install --frozen-lockfile` with `CI=true` instead.
- Electron downloads its binary on demand (Electron 42+). Run `node node_modules\electron\install.js` before activation.
- `pnpm run styles` verifies dependencies against the lockfile and aborts without a TTY. Build styles with the three direct commands from `package.json`.
- `schtasks /end` does not stop grandchildren. Stop leftover `electron.exe`, `odk-link-service.js` and `display-client.mjs` processes that still point at the old release, or the new task exits because the channel or pipe already has an owner.
- The Personal Agent reads `perosnal-agent.env` (spelling is authoritative) plus `runtime.env` and `voice-agent.env`, and rejects any `ODK_PERSONAL_BOT_*` setting. It needs `ODK_PERSONAL_AGENT_MAIN_SSH=odk-cm5-agent` and `ODK_PERSONAL_AGENT_AUDIO_DEVICE=<DirectShow name>`.
- `integrations/personal-agent` needs its own `pnpm install`; the runtime tree's `node_modules` does not serve it.
- Window geometry can only be read in the interactive session: from SSH every `MainWindowHandle` is 0. Register a check task with an interactive principal.

Verified on the handheld on 2026-11-02: release `20261102-main-b36be942` active, panel bounds `0,0 1280x800`, Link service and Personal Agent running from that release, `OdkPersonalBot` disabled but kept for recovery.
Rollback: re-register the saved task XML in `deployment-backups\20261102-main-b36be942\` against `releases\20261023-main-2988cf77` and restart the tasks.

## Personal Agent link (verified 2026-11-02)

The Windows display client reaches CM5 through the fixed SSH alias `odk-cm5-agent`, whose key entry in `/home/orangepi/.ssh/authorized_keys` runs a forced command.
That command must name `integrations/personal-agent/src/hub-stdio.mjs`; the bot-to-agent rename left it on `personal-bot`, so every Windows connection failed and the desk showed `CM5 连接不可用` plus an empty Overview.

The agent also delegates tasks to the Mac. CM5's `~orangepi/.ssh/config` aliases `pi-monitor-mac` and `odesk-control-mac` point at the Mac's current address; a stale DHCP address there produced `Delivery unconfirmed` for every Hosted Pi task. Host key verification survives an address change because both aliases pin `HostKeyAlias`.

- Test the relay from the device with a NULL stdin: `$null | ssh -o BatchMode=yes odk-cm5-agent`.
- Test Pi collection from CM5 as `orangepi`: `ssh -o BatchMode=yes pi-monitor-mac` returns a JSON snapshot.
- The CM5 unit now appends both streams to `~/.local/state/open-deskos/personal-agent.log`. This host has no journal, so without that line `home_briefing_failure` and relay errors are unreadable.
- A text request must carry a 36-character UUID `requestId`. An invalid id makes the CM5 socket destroy the connection, which looks like a relay crash.
- Briefing state is not in the status record; it arrives as its own `briefing` frame. Read it from the display pipe instead of inferring failure from a missing status field.
