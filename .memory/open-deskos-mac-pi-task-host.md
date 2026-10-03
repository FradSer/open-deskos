---
description: Mac 受管 Pi 任务主机已按 operator 要求完整回滚；launchd 必须用稳定 fnm 别名路径（fnm_multishells 每次登录都变）；CM5 语音端曾因缺 task-*.mjs 未打通，该阻塞现已不存在
type: project
---

**本机没有在跑受管 Pi 任务主机** ✓。2026-09-16 曾按 `integrations/voice-agent/docs/MANAGED_TASKS.md` 完整部署并做过真机验收 ✓，随后 operator 要求「清理本地进程、不要安装」✓，已**全部回滚** ✓：LaunchAgent `~/Library/LaunchAgents/com.open-deskos.pi-tasks.plist` ✓、`~/.local/bin/pi-task-control` ✓、`~/.config/open-deskos/` ✓、`~/.local/state/open-deskos/` ✓、`~/.local/run/` ✓ 均已删除 ✓，`launchctl print gui/501/com.open-deskos.pi-tasks` 现为不存在 ✓。仓库代码未改动 ✓。

**下次部署最容易忘的一条** ✓：launchd 里的 node 路径必须写**稳定别名** `/Users/FradSer/.local/share/fnm/aliases/default/bin` ✓ —— fnm 的 `~/.local/state/fnm_multishells/<pid>_<ts>/bin` **每个 shell 都不同** ✓，写进 plist 会在下次登录失效 ✓ ✓。准入检查也严 ✓：`ODESK_TASK_CONFIG` 必须绝对路径、当前用户拥有、mode 不含 `022` ✓；socket 父目录由守护进程建为 `0700`、socket `0600` ✓ ✓。可复用顺序：前台冒烟 → `plutil -lint` → `launchctl bootstrap gui/$(id -u)` ✓ ✓。

**CM5 语音端这一段已过期，本文件曾记错** ✓。本文件先前写「仍未打通，因为 `voice-agent/src/` 无 `task-*.mjs`、无 `coding_task_*` 工具」✓ —— 2026-10-01 复核时 `integrations/voice-agent/src/` 下**已有 8 个 `task-*.mjs`**（`task-agent` / `task-cli` / `task-client` / `task-daemon` / `task-endpoint` / `task-protocol` / `task-service` / `task-store`）✓ ✓，那个阻塞**不再成立** ✓。是否已在新 release 上真正打通要以**当前 CM5 release 为准**去查，不要引用本文件的旧结论 ✓ ✓ —— 记忆里的"现状"比代码更容易骗人 ✓。

**Why:** 一次回滚 + 一次验收是历史事件，值得留；一条基于当时 release 的"仍未打通"结论会随 release 前进而失效，留在记忆里只会误导。

**How to apply:** 在 Mac 上重新部署前先确认是否仍需要 operator 点头 ✓；验证 CM5 侧能力时**先读当前 release 的代码**再下结论 ✓ ✓；任务机制的权威是 `MANAGED_TASKS.md` ✓，本文件只留 fnm 别名与准入检查这两条最容易踩的 ✓。
