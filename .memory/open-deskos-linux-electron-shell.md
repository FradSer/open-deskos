---
name: open-deskos-linux-electron-shell
description: "CM5(RK3588S)的 Open DeskOS 外壳切片位于 app/linux(Electron);smoke 检查必须挂 did-finish-load 而非 ready-to-show"
type: project
---

CM5 Linux 应用链路的第一片实现:`app/linux/`,Electron(43.x,pnpm 固定)渲染
AIODI 外壳,目标面板 568×1232 竖屏触摸。P4+C6 固件仍是生产权威,此切片对应
迁移评估的"CM5 验证第一步"。

**关键实现事实:**
- 分辨率经 `ODESK_SHELL_WIDTH/HEIGHT` 覆盖,kiosk 用 `--kiosk` 或
  `ODESK_SHELL_KIOSK=1`;Wayland 追加 `--ozone-platform-hint=auto`。
- AIODI token 由 `tests/check_tokens.mjs` 与根目录 `DESIGN.md` 逐色对齐,
  防止 CSS 漂移。
- **smoke 模式陷阱**:无 WindowServer 访问权的终端会话里 `ready-to-show`
  永不触发导致挂死;smoke 必须挂 `webContents.did-finish-load` 并加超时,
  尺寸断言用 `getContentBounds()`。
- 宿主机 smoke 绿 ≠ CM5 真机绿(GPU 合成、触摸、自启均未验证)。

**Why:** 这是仓库第一个 JS/Electron 运行时端;token 对齐测试和无头可跑的
smoke 模式决定了后续切片能否安全迭代。

**How to apply:** 扩展外壳功能时先在 `tests/features/linux-shell.feature`
落场景,再改 renderer;颜色只走 DESIGN.md token;设备部署用
`scripts/cm5-install.sh`(arm64 设备端执行)。

**Related:** [[cerberus-rpi-migration-eval]] [[aiodi-ui-design-standard]] [[cerberus-os-top-spec]]
