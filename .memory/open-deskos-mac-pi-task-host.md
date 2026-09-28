---
description: Mac 受管 Pi 任务主机曾按 operator 部署并验收后回滚；launchd 必须用稳定 fnm 别名路径
type: project
---

2026-09-16 在本机（Frad-MacBook-Pro）按 `integrations/voice-agent/docs/MANAGED_TASKS.md` 完整部署过受管 Pi 任务主机，随后 operator 要求「清理本地进程、不要安装」，已全部回滚：LaunchAgent `~/Library/LaunchAgents/com.open-deskos.pi-tasks.plist`、`~/.local/bin/pi-task-control`、`~/.config/open-deskos/`、`~/.local/state/open-deskos/`、`~/.local/run/` 均已删除，`launchctl print gui/501/com.open-deskos.pi-tasks` 现为不存在。仓库代码未改动，无待提交产物。

移植要点（下次部署仍需如此）：

- launchd 的 node 路径必须用稳定别名 `/Users/FradSer/.local/share/fnm/aliases/default/bin`。fnm 的 `~/.local/state/fnm_multishells/<pid>_<ts>/bin` 每个 shell 都不同，写进 plist 会在下次登录失效。
- 助手/配置的准入检查很严：`ODESK_TASK_CONFIG` 必须绝对路径、当前用户拥有且 mode 无 `022` 位；socket 父目录由守护进程建为 0700，socket 0600。
- 前台冒烟 → `plutil -lint` → `launchctl bootstrap gui/$(id -u)` 的顺序可复用。

真机验收结论（非 fixture，回滚前测得）：只读中文任务 19s `finished` 且 `verification: not_run`；运行中 `cancel` → `cancelled`；SIGTERM（`kickstart -k`）走优雅退出，活动任务落 `cancelled` 并保留截断响应；`kill -9` 后重启把记录改判 `interrupted`，两种情况都不重放。

仍未打通的是 CM5 语音端：`current` 为 `20260915T164708Z-voice-hydra`，其 `voice-agent/src/` 无 `task-*.mjs`（无 `coding_task_*` 工具），`ODESK_TASK_TARGETS_FILE` 未配置。本机构建/激活新 release、授予 CM5 入站 SSH 之前，这两步都需要 operator 明确确认。
