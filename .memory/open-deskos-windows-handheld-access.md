---
description: 64-bit Windows 掌机的接入方式：Tailscale 上的公钥 SSH、Session 0 无桌面所以 GUI 工作走交互计划任务、带哈希门控的同步部署
type: project
---

这是 64-bit Windows 掌机（Open DeskOS 的第二个 Shell Host ✓）的实测接入事实。完整流程归 `runtime/linux/docs/WINDOWS_HOST.md` ✓ ✓，本文件只留跨会话最容易忘的连接与操作约定 ✓ ✓。

**怎么连** ✓：用户 `frads`（管理员 ✓，从 SSH 拿到 High integrity ✓）。`ssh -i ~/.ssh/id_ed25519 frads@100.82.50.70`（Tailscale ✓）✓，MagicDNS 同义 `frads@desktop-qlqd17f.tail27726.ts.net` ✓，局域网 `frads@192.168.50.225` ✓。`~/.ssh/config` **没有**这台机器的条目 ✓ —— 一律用显式参数调用 ✓ ✓。授权文件是 `C:\ProgramData\ssh\administrators_authorized_keys` ✓（管理员标准位置 ✓，用户目录没有 `.ssh\authorized_keys` ✓）；开发机那把钥匙的指纹 `SHA256:RNMyWZCU294srI7D8Eu5mUeD5KVnttqVKHKxZV5E/+I` ✓ ✓，换机器时用它比对 ✓。

**与「运行时通道鉴权」是两回事** ✓：SSH 是我的运维通路 ✓；desk ↔ 机器/插件/语音那条路走的是 ADR-0025 的 **Channel Token** ✓ —— 能按所有权认证就按所有权（Unix socket 目录 0700 ✓、socket 0600 ✓），命名管道与 `tcp://` 才用每主机一个 32 字节令牌 ✓（连接首行 `{"v":1,"token":…}` ✓、常数时间比较 ✓ ✓）。令牌值从不打印 ✓ ✓。

**三个每次都会咬人的坑** ✓：

- **SSH 是 Session 0 ✓ 没有交互桌面** ✓ —— Electron 夹具、抓屏、kiosk 都要从**交互计划任务**跑 ✓，且任务**从 SSH 注册** ✓，绝不在任务里再注册任务（Windows 禁止链式持久化 ✓ ✓）。
- **远程 `.ps1` 必须纯 ASCII** ✓ —— PS 5.1 按系统代码页解析无 BOM 的 UTF-8 ✓，一个中文/非 ASCII 字符就语法报错 ✓。也别把 PowerShell 拼成一行穿 ssh ✓：cmd 吃掉引号与 `|`、`&`、`>` ✓ ✓（本次取证当场又撞了一次 ✓）。写文件 → 上传 → 执行 ✓。
- **同步是带哈希门控的部署 ✓ 不是拷贝** ✓：按**仓库根相对路径**打 tar ✓ + 逐文件 `md5 -q` 期望清单 ✓ → scp 到 `C:\Users\frads\` ✓ → 设备脚本在仓库根解包并用 `Get-FileHash -Algorithm MD5` 逐文件比对 ✓ → 全等才 `DEPLOY_OK` ✓ 并重建 `uno.css` ✓ + 重启 desk ✓。包**永不包含 `.env.local` 或任何设备状态** ✓ ✓。轮询日志要用**本次运行独有的哨兵** ✓（旧日志里也有 `DONE` ✓，读到会把上次当本次 ✓ ✓）。PS 5.1 的 `Join-Path` 是拼接不是解析 ✓，所以部署脚本参数给**相对名** ✓ ✓。

这个门已经当场抓到过两类真实事故 ✓：包解在子目录留下一棵 `runtime\runtime\…` 树（desk 仍在读旧文件 ✓）、设备上残留上一个 commit 的混合状态 ✓ ✓。

**未处置的安全项** ✓：`sshd_config` 里 `PasswordAuthentication` 与 `PubkeyAuthentication` 都还是注释掉的**默认值** ✓，即**口令登录仍开着** ✓ —— 端口只在 tailnet 可见是唯一理由 ✓。关法与验证步骤在 runbook 里 ✓ ✓；**改服务属于运维动作，需要 operator 点头才动** ✓ ✓。

**设备会挂起** ✓：电池供电 + 屏幕熄灭会断开 Wi-Fi ✓，长任务前必须接电 ✓（已发生过一次 `pnpm install` 被挂起打断 ✓ ✓）—— 详见 runbook 的「长任务与掌机省电」✓ ✓。
