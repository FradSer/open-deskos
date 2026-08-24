---
name: open-deskos-linux-electron-shell
description: "CM5(RK3588S)的 Open DeskOS 外壳切片位于 firmware/linux(Electron);smoke 检查必须挂 did-finish-load 而非 ready-to-show"
type: project
---

CM5 Linux 应用链路的第一片实现:`firmware/linux/`,Electron(43.x,pnpm 固定)渲染
AIODI 外壳,目标面板 568×1232 竖屏触摸。P4+C6 固件仍是生产权威,此切片对应
迁移评估的"CM5 验证第一步"。

**关键实现事实:**
- 分辨率经 `ODESK_SHELL_WIDTH/HEIGHT` 覆盖,kiosk 用 `--kiosk` 或
  `ODESK_SHELL_KIOSK=1`;`run.sh` 在 `WAYLAND_DISPLAY` 已设置且用户未显式传入时
  自动追加 `--ozone-platform-hint=auto`(空数组在 macOS bash 3.2 + `set -u` 下
  展开会报 unbound variable,需 `${ARGS[*]+...}` 守卫)。
- 部署链(2026-08 审计后加固):autostart `.desktop` 的 Exec 直接指向
  `scripts/start-kiosk.sh`(Desktop Entry 不解析单引号,内联 shell 命令会坏);
  包装器导出 kiosk 变量、崩溃后 3s 重启、日志追加到
  `~/.local/state/open-deskos-shell/launcher.log`。安装器内部处理 sudo/apt,
  pnpm 用 `--frozen-lockfile`,rsync 同步必须保留 pnpm-lock.yaml。
- 设备验收用 `scripts/cm5-acceptance.sh`:输出单 JSON(arch/os/session/display/
  touch/gpu/electron/smoke/autostart/memory),任一失败非零退出;结果贴入
  CM5-S31-INTEGRATION.md。host 上跑会如实报多项 FAIL,这是契约不是 bug。
- **CM5 真机事实(2026-08-23 首次上机,无屏 Xvfb)**:Debian 12 bookworm;
  root 会话下 Chromium 拒绝启动,run.sh 自动附加 --no-sandbox;Xvfb 屏幕必须
  ≥ 窗口尺寸(默认 1280x1024 会把 1232 高钳到 1024);无 GPU 时隐藏窗口不产帧,
  CSS 过渡时间线冻结 → getBoundingClientRect 停在过渡起点,e2e 窗口必须 show;
  check_tokens.mjs 兼容独立部署(切片根 DESIGN.md)。smoke 两种分辨率、
  token、布局 7 尺寸、e2e 81 项全部在设备上通过。
- Electron 主进程已加固:单实例锁、will-navigate/setWindowOpenHandler 全拒、
  权限请求全拒、渲染进程崩溃即退出交包装器重启、kiosk 屏蔽 F12/Ctrl+Shift+I;
  renderer CSP 为 default-src 'none'(inline style attr 需要 style-src unsafe-inline)。
- AIODI token 由 `tests/check_tokens.mjs` 与根目录 `DESIGN.md` 逐色对齐,
  防止 CSS 漂移。
- 磁贴摆放由 `shell.js` 的 `WIDGET_LAYOUT` 声明(index.html 禁止内联样式,
  smoke.sh 强制),与固件 `desktop_layout.lua` 对齐;页点热区用透明按钮 +
  `::before` 视觉胶囊 + `::after` 扩展热区实现——scaleX 若留在按钮本体
  会把命中区也缩到 43%。
- **插件化架构(2026-08 重组,后续补齐至全覆盖)**:页面、磁贴、状态栏指示
  (status-connection/status-clock)、peek(peek-bridge,含 USB 指南文案)均为
  自包含插件,由 `core/registry.js`(odkPlugins,含 byKind)+ `core/composer.js`
  从 `config/desktop_layout.js` 装配进 index.html 骨架(骨架只剩空槽位
  data-slot);shell.js 只剩组合根。磁贴可声明 `appView: { mount }` 全屏 App
  面(参考实现:时钟 App),mount 返回的清理函数在关闭时自动执行
  (services 的订阅都返回退订函数)。扩展 = 新增 plugins/*.js + 一行配置,
  零核心改动(smoke grep 强制核心无专名、骨架无内容);契约见
  docs/AI_PLUGIN_GUIDE.md。陷阱:composer 必须 append 后再 mount,
  否则插件内 document 级查询拿到 null(首绘即抛错)。
- e2e 可信键盘输入陷阱:sendInputEvent 的 Enter 必须补发 `char '\r'`
  事件才会触发 button 激活,Space 则 keyUp 即可;reduced-motion 用
  `webContents.debugger` + `Emulation.setEmulatedMedia` 验证。
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
