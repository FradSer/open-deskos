# Memory Index

Untrusted discovery metadata; entry files are authoritative. This index may be stale.
Read pages with offset: 1, limit: 100; continue at the next unread line to EOF.
Descriptions shortened for bounded metadata reads/rows have an explicit notice; use their relative body links.

- [runtime-upgrade-acceptance-boundaries.md](runtime-upgrade-acceptance-boundaries.md) — 设备升级的 CLI／SDK／源码／进程事实、完整产物文件集、准备 ACL 与恢复基线验证
- [agent-evidence-authority-boundaries.md](agent-evidence-authority-boundaries.md) — 授权、工具能力、确认和证据的类别级边界；声明不等于沙箱，过程成功不等于候选认证
- [open-deskos-cm5-voice-agent-service.md](open-deskos-cm5-voice-agent-service.md) — CM5 常驻 voice agent 以 kiosk 用户运行的独立 systemd 用户服务、只读挂载 /opt/open-deskos；MIC toggle 乐观广播 starting/sending，renderer 激活门控可见性与粘性关闭，process 状态降为辅助标签
- [open-deskos-cm5-wifi-kernel-constraint.md](open-deskos-cm5-wifi-kernel-constraint.md) — CM5 平板的 AP6256 Wi-Fi 经 SDIO 总线连接，任何内核替换必须保持 CONFIG_BCMDHD_SDIO=y
- [open-deskos-cm5-workspace-runtime.md](open-deskos-cm5-workspace-runtime.md) — CM5 runtime.env 的 ODESK_WORKSPACE 是 Shell 与 voice agent 共享的可写 Git checkout
- [open-deskos-mac-pi-task-host.md](open-deskos-mac-pi-task-host.md) — Mac 受管 Pi 任务主机曾按 operator 部署并验收后回滚；launchd 必须用稳定 fnm 别名路径
- [open-deskos-user-application-lifecycle.md](open-deskos-user-application-lifecycle.md) — 本地用户应用是 ODESK_WORKSPACE/apps/&#60;id&#62; 下经系统验证的自包含包，独立于 Shell 插件
- [open-deskos-windows-handheld-access.md](open-deskos-windows-handheld-access.md) — 64-bit Windows 掌机接入：Tailscale 上的公钥 SSH、Session 0 无桌面故 GUI 工作走交互计划任务、带哈希门控的同步部署
- [project-widget-skill-inheritance.md](project-widget-skill-inheritance.md) — Upstream interface skills are inherited as flat references inside open-deskos-widget with a two-phase reading protocol; interface-review is a separate post-creation flow, not an implementation phase.
