---
description: "CM5 常驻 voice agent 以 kiosk 用户运行的独立 systemd 用户服务、只读挂载 /opt/open-deskos；MIC toggle 乐观广播 starting/sending，renderer 激活门控可见性与粘性关闭，process 状态降为辅助标签"
type: project
---

`integrations/voice-agent` 打包进每个不可变 runtime release，以 `open-deskos-voice-agent.service`（systemd 用户单元，非 root、非与 shell 生命周期耦合）常驻运行。

- 单元 `WorkingDirectory`/`ExecStart` 经 `current` 符号链接解析代码，`EnvironmentFile=-%h/.config/open-deskos/voice-agent.env` 与 `EnvironmentFile=-%h/.config/open-deskos/runtime.env` 读取配置，`ReadOnlyPaths=/opt/open-deskos` 令服务无法自行激活 release。
- 需 Node 22.19.0+、可用 pnpm/Corepack、`arecord`（alsa-utils）与用户 runtime 目录；Pi SDK 是 voice 包依赖，不是从开发机复制的全局可执行。
- 配置/凭据缺失时守护进程仍可达并给出 error 状态、capture 关闭；改动 env 后仅重启 voice 服务：`systemctl --user restart open-deskos-voice-agent.service`。
- IPC socket 为 `$XDG_RUNTIME_DIR/open-deskos-voice/agent.sock`（status 帧 `{"v":1,"type":"status","state":...,"message":...}`）；运行态在 `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos-voice`。microphone/STT/coding-model 的可用性必须显式经操作员批准的语音交互验证，服务运行本身不证明这些。

**主进程广播契约：**
- 一次被接受的 MIC toggle 之后，`src/main.js` 会**立即**在渲染层广播 `starting`，提交录音后广播 `sending`，不等外部服务下一条状态；无法发送（未连接/被拒）时广播 `{ ...current, activated: true }` 而非伪造成功。
- 窗口 `did-finish-load` 之后 `main.js` 重新广播 `voiceAgent.snapshot()`，保证后加载的 shell 也能如实渲染 `unavailable`。
- `src/voice-agent-client.js` 对未连接的操作**永不排队** MIC toggle、失败关闭到 `unavailable`，其状态 allowlist 必须包含 `sending`。MIC 路由一次直达 resident agent callback，绝不进入 Pi monitor 或 renderer 导航。

**Renderer 可见性/关闭状态机（`src/renderer/core/voice-status.js`）：**
- **激活门控**：`active`/`dismissed`/`previousState` 三个局部变量构成状态机。`idle`、`unavailable`、`error` 等后台状态**不会**打开 surface。只有 `status.activated === true`（来自 main 的用户操作反馈）、`state === 'starting'`（用户启动的明确信号）、或从非忙状态转入围 `busyStates`（starting/recording/sending/transcribing/thinking）时才设 `active = true` 并清除 `dismissed`。
- **粘性关闭**：dismiss 按钮设 `dismissed = true` 并隐藏 surface；重复的 terminal 快照（如 `idle` + message）不会重新打开。新活动（进入 busy 状态或收到 starting）重新激活并清除 dismissed。`idle` 且无 message 时清空 `active`。
- **层级**：process 状态（starting/recording/sending/transcribing/thinking）只显示紧凑的 `.voice-status-stage` 标签，`.voice-status-title` 和 `.voice-status-detail` 隐藏或为空；`thinking` stage 文案为 `Working`（非 `Pi is working`）。只有 `idle` 且携带 `status.message` 时 message 成为 title 的主要阅读内容。
- **无障碍**：外层 `div#voice-status` 为 `role="region" aria-label="Voice request"`；内层 `.voice-status-content` 为 `role="status"` + `tabindex="0"` 可滚动聚焦；dismiss 按钮为原生 `<button>`，键盘/触控可用。
- **CSS 结构**：flex 布局（content + dismiss button），无左 meter bar；状态色仅在 icon 上表达（recording/error 红、idle 绿），不改变 border；仅保留 progress 动画，无 entrance 动画。

**Why:** 后台服务报告状态时不得凭空弹出界面打断用户；乐观反馈必须真实（不得把未连接伪装成 starting/sending）；process 阶段不是结果，不应占据视觉主体；host 端契约测试不等于 CM5 硬件验收。

**How to apply:** 发布/回滚 `current` 后需相应重启 voice；不复制开发者 `.pi`、auth、`.env` 或 `node_modules` 到 CM5；不发布凭据、录音或原始日志；BDD `voice-agent.feature` 中 `Background voice service status does not open feedback` 和 `Results take precedence over process metadata` 场景钉死此契约；状态文案不得自相矛盾。
