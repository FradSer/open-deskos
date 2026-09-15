---
description: "CM5 runtime.env 的 ODESK_WORKSPACE 是 Shell 与 voice agent 共享的可写 Git checkout"
type: project
---

CM5 部署的运行时配置放在设备本地 kiosk 用户目录，不放在源码或 systemd 单元里。

- `~/.config/open-deskos/runtime.env`（mode 0600）承载共享变量 `ODESK_WORKSPACE`；Electron Shell 与 resident voice agent 都从该文件读取它。
- `ODESK_WORKSPACE` 指向共享的 Open DeskOS 可写 Git checkout（例如 kiosk 用户 `~/Developer/open-deskos`），必须位于 `/opt/open-deskos` 之外，且包含 `.agents/skills/open-deskos-widget/SKILL.md`；它不是 voice 专属 workspace。
- voice 专属设置单独放在 `~/.config/open-deskos/voice-agent.env`（mode 0600）。旧的 voice 专属 workspace 变量不再支持。
- 语音报错 `Set ODESK_WORKSPACE to the shared Open DeskOS writable checkout; restart service` 的根因是该变量未在此文件中定义（或 checkout 不存在），修复方式是写入正确的 `ODESK_WORKSPACE` 后重启 voice 服务。

**Why:** 安装器故意不创建或覆盖这两个 env 文件，也不克隆仓库；配置缺失时服务保留可读的错误状态而非崩溃。

**How to apply:** 以 kiosk 用户（非 root）配置；改动共享 runtime 配置后重启对应服务，绝不把密钥写进源码、systemd 单元或该 env 文件。
