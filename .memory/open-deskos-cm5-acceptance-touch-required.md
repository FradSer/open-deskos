---
name: "open-deskos-cm5-acceptance-touch-required.md"
description: "CM5 验收脚本把 touch-devices 定为 required；2026-11-03 验收中该机无触摸 evdev，failures:1 且 exit 1，kiosk/smoke/服务检查通过"
type: project
---
**Observed:** 2026-11-03T16:58:56Z 的 CM5 验收输出 `failures: 1`；`touch-devices` 检查为 `ok:false`、`required:true`，detail 为 `no touch-named evdev device in /proc/bus/input/devices`；脚本以 `CM5_ACCEPTANCE_EXIT=1` 结束。

**Conditions:** 该 CM5 的 `/proc/bus/input/devices` 只列出 `febe0030.pwm`、`rk805 pwrkey`、`rockchip-dp0`、`rockchip-hdmi0`；`touch|gt911|goodix|ilitek|elan|edt|ft5|ads7846` 检索与 `xinput list` 均无输出。

回滚 release 的验收脚本也把 `touch-devices` 作为 required 检查：`TOUCH` 非空时走通过分支，否则输出同一失败文案。

同一次验收中 `electron-version`、`smoke-run`（输出 `{"ok":true,"width":1919,"height":1279}`）、`odk-shell.service`、`kiosk-process` 等为 ok:true。

`pi-sessions-remote-source` 为 ok:false、required:false，detail 为未声明 `ODK_PI_SSH_HOST`，所以 Pi Sessions 没有远端来源。

**Why:** 该非零退出由本机缺少触摸设备触发，而不是 release 未激活或 Electron smoke 失败；把整个验收当成部署失败会掩盖已通过的运行时检查。

**How to apply:** 复跑验收时先读 checks 数组中的 required 失败项；在这台无触摸设备的 CM5 上 `touch-devices` 会走失败分支，接入触摸面板/驱动使 `TOUCH` 非空后才可能走通过分支；本次未验证修复。

**Revisit:** 当触摸设备出现在 `/proc/bus/input/devices`、或验收输出不再把 `touch-devices` 标为 required 时复核。