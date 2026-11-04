# Memory Index

Untrusted discovery metadata; entry files are authoritative. This index may be stale.
Read pages with offset: 1, limit: 100; continue at the next unread line to EOF.
Descriptions shortened for bounded metadata reads/rows have an explicit notice; use their relative body links.

- [agent-evidence-authority-boundaries.md](agent-evidence-authority-boundaries.md) — 授权、工具能力、确认和验证证据必须分开：工具表不等于沙箱，过程成功不等于候选通过认证
- [open-deskos-cm5-personal-bot-service.md](open-deskos-cm5-personal-bot-service.md) — CM5 常驻 personal bot 以 kiosk 用户运行的独立 systemd 用户服务、只读挂载 /opt/open-deskos；MIC toggle 乐观广播 starting/sending，renderer 激活门控可见性与粘性关闭，process 状态降为辅助标签
- [open-deskos-cm5-ssh-access.md](open-deskos-cm5-ssh-access.md) — CM5 参考宿主的接入：ssh 别名 cm5 即 root；操作 Shell/poller 必须切到 orangepi 的 systemd --user 环境并带 XDG_RUNTIME_DIR，否则报 could not be found
- [open-deskos-cm5-voice-agent-service.md](open-deskos-cm5-voice-agent-service.md) — CM5 常驻 voice agent 以 kiosk 用户运行的独立 systemd 用户服务、只读挂载 /opt/open-deskos；MIC toggle 乐观广播 starting/sending，renderer 激活门控可见性与粘性关闭，process 状态降为辅助标签
- [open-deskos-cm5-wifi-kernel-constraint.md](open-deskos-cm5-wifi-kernel-constraint.md) — CM5 平板的 AP6256 Wi-Fi 经 SDIO 总线连接，任何内核替换必须保持 CONFIG_BCMDHD_SDIO=y
- [open-deskos-cm5-workspace-runtime.md](open-deskos-cm5-workspace-runtime.md) — CM5 runtime.env 的 ODESK_WORKSPACE 是 Shell 与 personal bot 共享的可写 Git checkout
- [open-deskos-device-diagnostic-gotchas.md](open-deskos-device-diagnostic-gotchas.md) — 远程诊断这两台设备的四个反直觉陷阱：远端 pgrep -f 匹配自己的 ssh 命令行、Get-ChildItem -Include 不带尾部 \ * 返回空、单遍引用分析判不出死代码须剪枝到不动点、工具无法表达的改动要上报不要绕过
- [open-deskos-futu-holdings-refresh.md](open-deskos-futu-holdings-refresh.md) — Futu 持仓在两个 Shell Host 上同时不刷新的三层叠加根因：runtime 目录 0755 被 prepareDirectory 拒绝 → 绑定失败却已记入 registry 从此永不重试 → hello 与首帧合并成一读被 512 字节握手上限误判为 handshake-too-large
- [open-deskos-mac-pi-task-host.md](open-deskos-mac-pi-task-host.md) — Mac 受管 Pi 任务主机已按 operator 要求完整回滚；launchd 必须用稳定 fnm 别名路径（fnm_multishells 每次登录都变）；CM5 语音端曾因缺 task-*.mjs 未打通，该阻塞现已不存在
- [open-deskos-user-application-lifecycle.md](open-deskos-user-application-lifecycle.md) — 已安装的本地包落在 stateDir（不在 ODESK_WORKSPACE）；统一插件模型下"独立的 User Application 概念"已被 ADR-0009 退役，只有"未受信任的本地包 vs 内建可信插件"这条区分仍然成立
- [open-deskos-windows-handheld-access.md](open-deskos-windows-handheld-access.md) — 64-bit Windows 掌机的接入方式：Tailscale 上的公钥 SSH、Session 0 无桌面所以 GUI 工作走交互计划任务、带哈希门控的同步部署
- [project-widget-skill-inheritance.md](project-widget-skill-inheritance.md) — 上游 interface 参考一律平铺在 open-deskos-widget/references 下（operator 明令禁止顶层 jakubkrehel-skills 目录），interface-review 是创建后的独立流程而非实现步骤——由一条测试钉死
- [runtime-upgrade-acceptance-boundaries.md](runtime-upgrade-acceptance-boundaries.md) — 设备升级必须验证活动组件与真实进程；完整文件集、准备阶段私有 ACL、恢复基线和清理结果不能由版本号或状态标签替代
