---
description: "CM5 常驻 voice agent 以 kiosk 用户运行的独立 systemd 用户服务、只读挂载 /opt/open-deskos；MIC toggle 在 main 侧乐观广播 starting/sending，客户端对未连接永不排队并失败关闭到 unavailable"
type: project
---

`integrations/voice-agent` 打包进每个不可变 runtime release，以 `open-deskos-voice-agent.service`（systemd 用户单元，非 root、非与 shell 生命周期耦合）常驻运行。

- 单元 `WorkingDirectory`/`ExecStart` 经 `current` 符号链接解析代码，`EnvironmentFile=-%h/.config/open-deskos/voice-agent.env` 与 `EnvironmentFile=-%h/.config/open-deskos/runtime.env` 读取配置，`ReadOnlyPaths=/opt/open-deskos` 令服务无法自行激活 release。
- 需 Node 22.19.0+、可用 pnpm/Corepack、`arecord`（alsa-utils）与用户 runtime 目录；Pi SDK 是 voice 包依赖，不是从开发机复制的全局可执行。
- 配置/凭据缺失时守护进程仍可达并给出 error 状态、capture 关闭；改动 env 后仅重启 voice 服务：`systemctl --user restart open-deskos-voice-agent.service`。
- IPC socket 为 `$XDG_RUNTIME_DIR/open-deskos-voice/agent.sock`（status 帧 `{"v":1,"type":"status","state":...,"message":...}`）；运行态在 `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos-voice`。microphone/STT/coding-model 的可用性必须显式经操作员批准的语音交互验证，服务运行本身不证明这些。

**状态广播/交互契约（2026-09 交互优化轮）：**
- 一次被接受的 MIC toggle 之后，`src/main.js` 会**立即**在渲染层广播 `starting`，提交录音后广播 `sending`，不等外部服务下一条状态；无法发送（未连接/被拒）时广播不变的 `unavailable` 快照而非伪造成功。
- 窗口 `did-finish-load` 之后 `main.js` 重新广播 `voiceAgent.snapshot()`，保证后加载的 shell 也能如实渲染 `unavailable`（修复了「初始不可见」缺口）。
- `src/voice-agent-client.js` 对未连接的操作**永不排队** MIC toggle、失败关闭到 `unavailable`，其状态 allowlist 必须包含 `sending`（否则 CSS 有 `sending` 选择器却永远渲染不出）。MIC 路由一次直达 resident agent callback，绝不进入 Pi monitor 或 renderer 导航（`tests/voice-agent-routing.test.js` 钉死）。

**Why:** 麦克风缺失、STT key 缺失或 voice 激活失败都不得阻断 Shell；乐观反馈必须真实（不得把未连接伪装成 starting/sending）；host 端契约测试不等于 CM5 硬件验收。

**How to apply:** 发布/回滚 `current` 后需相应重启 voice；不复制开发者 `.pi`、auth、`.env` 或 `node_modules` 到 CM5；不发布凭据、录音或原始日志；状态文案不得自相矛盾（recording 说明由 BDD 正则 `/MIC.*stop/i` 锁定）。
