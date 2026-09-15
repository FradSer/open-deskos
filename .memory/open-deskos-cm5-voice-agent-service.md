---
description: "CM5 resident voice agent 是以 kiosk 用户运行的独立 systemd 用户服务，只读挂载 /opt/open-deskos"
type: project
---

`integrations/voice-agent` 打包进每个不可变 runtime release，以 `open-deskos-voice-agent.service`（systemd 用户单元，非 root、非与 shell 生命周期耦合）常驻运行。

- 单元 `WorkingDirectory`/`ExecStart` 经 `current` 符号链接解析代码，`EnvironmentFile=-%h/.config/open-deskos/voice-agent.env` 与 `EnvironmentFile=-%h/.config/open-deskos/runtime.env` 读取配置，`ReadOnlyPaths=/opt/open-deskos` 令服务无法自行激活 release。
- 需 Node 22.19.0+、可用 pnpm/Corepack、`arecord`（alsa-utils）与用户 runtime 目录；Pi SDK 是 voice 包依赖，不是从开发机复制的全局可执行。
- 配置/凭据缺失时守护进程仍可达并给出 error 状态、capture 关闭；改动 env 后仅重启 voice 服务：`systemctl --user restart open-deskos-voice-agent.service`。
- IPC socket 为 `$XDG_RUNTIME_DIR/open-deskos-voice/agent.sock`；运行态在 `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos-voice`。microphone/STT/coding-model 的可用性必须显式经操作员批准的语音交互验证，服务运行本身不证明这些。

**Why:** 麦克风缺失、STT key 缺失或 voice 激活失败都不得阻断 Shell；host 端契约测试不等于 CM5 硬件验收。

**How to apply:** 发布/回滚 `current` 后需相应重启 voice；不复制开发者 `.pi`、auth、`.env` 或 `node_modules` 到 CM5；不发布凭据、录音或原始日志。
