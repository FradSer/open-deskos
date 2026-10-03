---
description: CM5 参考宿主的接入：ssh 别名 cm5 即 root；操作 Shell/poller 必须切到 orangepi 的 systemd --user 环境并带 XDG_RUNTIME_DIR，否则报 could not be found
type: project
---

CM5（`orangepicm5-tablet` ✓，RK3588S ✓）的运维通路 ✓。运行时配置的归 `open-deskos-cm5-workspace-runtime.md` ✓，voice agent 常驻服务归 `open-deskos-cm5-voice-agent-service.md` ✓，Futu 持仓事故归 `open-deskos-futu-holdings-refresh.md` ✓，掌机接入归 `open-deskos-windows-handheld-access.md` ✓，两者共用的排障陷阱归 `open-deskos-device-diagnostic-gotchas.md` ✓。

**怎么连** ✓：`~/.ssh/config` 里**有**别名 ✓ —— `ssh cm5` 即 `root@10.10.0.195` 邻网的 `10.10.0.153` ✓ ✓。

**以 root 连上不等于能操作服务** ✓：Shell 与 futu poller 都跑在 **`orangepi`** 用户下 ✓ ✓，root 身份的 `systemctl --user` 会去找 `/run/user/0/` ✓ 并报 `could not be found` ✓ ✓。正确形式 ✓：

```bash
ssh cm5 'sudo -u orangepi env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status open-deskos-futu-poller'
```

漏掉 `XDG_RUNTIME_DIR=` 是这里最常见的失手点 ✓ ✓（本次排查先撞了它才转对）✓。

**只读判定服务真实状态的位置** ✓：

- Futu poller 日志 `~/.local/state/open-deskos/futu-poller.log` ✓（**只在它自己把 stdout 重定向到那里时才有内容** ✓；托管后默认进 journal ✓，而这台机器**没有 journal** ✓ —— 见下 ✓）
- Shell 日志 `~/.local/state/open-deskos-shell/launcher.log` ✓ —— **Futu 拒绝连接的 `refusing` / `handshake-too-large` 只出现在这里** ✓ ✓
- 当前 release 是符号链接：`readlink -f /opt/open-deskos/current` ✓
- 设备凭据 `~/.config/open-deskos/*.env`（mode 0600 ✓）**绝不 cat** ✓，需要变量名时只 grep 键名 ✓

**这台机器没有 journal** ✓：`journalctl --user` 返回 `No journal files were found` ✓ ✓，所以单元的 `StandardOutput/StandardError` 保持 `append:` 指回日志文件，否则**报错原因无处可读** ✓ ✓。仓库模板 `integrations/futu-poller/open-deskos-futu-poller.service` 不带这两行（journal 才是正常主机的默认值 ✓）——这是**设备本地覆盖** ✓，改单元前先备份 ✓。

**读 Shell 真实渲染状态的捷径** ✓：kiosk 以 `--remote-debugging-port=9222` 启动 ✓，可从渲染进程 DOM 直接读 tile 的文本与值 ✓ ✓。这是确认"数据真的在刷新"（价格跨次读取在动）而不是"看起来正常"的唯一硬证据 ✓ ✓ —— 排障时用它，不要靠推断 ✓。

**这台机器会自己堆积** ✓：`/opt/open-deskos/staging/` 的部署脚本用 `trap cleanup EXIT` ✓，被中断的运行会留下**每个数百 MB 的快照** ✓（本次清掉 4 个 ≈1.5 GB ✓ ✓）；`cm5-migrate-models-to-ssd.sh` 建的 `/tmp/cm5-model-storage-*` 临时目录**从不清理** ✓（本次清掉 138 个 ✓ ✓）。删前必须确认**没有部署在飞** ✓（`pgrep -af rsync|cm5-stage-release` ✓，注意那条常驻 cliproxy ssh 隧道不算 ✓ ✓）。
