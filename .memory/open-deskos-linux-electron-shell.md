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

## 2026-08 设计优化轮(全面 design pass)

- **P4 环形 parity 锚点**:pomodoro 2×2 环直径 = 环形 span 的 77%
  (aiodi ref: ring.d 160 / (2×cell 96+gutter 16)=208),红弧(#eb5757),
  空闲时 dashoffset 0 = 完整圆环(remaining=满 session);弧宽 ~15/120 viewBox。
  之前 52% 灰环是错的——读起来像禁用态。
- **字重纪律**:只捆绑了 Noto 400 与 Montserrat 700 两个面;font-weight
  500/600 会静默回退或触发 CJK 伪粗。AIODI Bold Digits Rule → CJK 一律 400,
  数字/拉丁 700(.al-weekday 400、.al-day 700、#app-title 400、.grp b 700)。
- **状态栏单行**:页名(#page-context)+ 页点(#dots)同入 #page-center 居中行,
  页名不再压顶缘;e2e 仍钉 label "名称 · N/3" 格式与 bolt/dots/clock 左中右序。
- **Dashboard 叙述流从头部正下方排布**(P4 parity,不用 margin-top:auto 压底);
  文案去重:叙述只说等待 Mac,辅助行独占"真实日程与用量"短语(e2e 钉死);
  装饰性红点已删——AIODI 色彩只表达状态;星期/日期 CSS uppercase(DOM 文本
  保持 "Tue"/"August 25" 以过 e2e 正则)。
- **Year 磁贴实时百分比**:year-pct 大数字 + 绿 meter(P4 2×1 meter 的
  label+value overlay 等价物);.w-state"实时"保留在 year-head 行。
- 网格页/卡片页一律 justify-content:flex-start 顶对齐(P4:网格贴状态栏,
  剩余高度归 peek 区),不再垂直居中悬浮。
- peek 加 chevron-right 尾随箭头提示可点按;quota 卡状态行升为大号主文字
  (信息主角),标题退居其上。
- 改 UI 前先改 .feature 场景(本轮:删红点、顶对齐、红环、实时百分比、
  单行状态栏均先落 scenario);截图验证用临时 electron capturePage 脚本放
  /tmp,用完即删。

## 2026-08 对比度/CSP 修复 + e2e flake 根因(重要)

- **e2e 几何扫描 flake 根因**:主测试窗口即使 `show: true`,被桌面其它窗口
  完全遮挡时 Chromium 仍会冻结 rAF(occlusion throttling),resize 驱动的
  `applyGeometry()` 永不执行,`__odkGrid` 停留旧值(症状:`applied=170
  expected=190`,时好时坏随桌面 z-order)。修复三件套:主窗口
  `backgroundThrottling: false`;sweep 在 setContentSize 后主动
  `dispatchEvent(new Event('resize'))`(与 OS 事件同一 handler,幂等);
  轮询 `__odkGrid.cellW === layout.compute().cellW`(上限 5s)替代盲睡
  500ms,另加 400ms 等 pager 260ms transform 过渡结束再探测。盲睡会漏掉
  两种竞态:rAF 延迟(metrics 未更新)和过渡中探测(widgets 位移出视口)。
- **对比度修复**:`.dash-support`、`.quota-checked/.app-action-status`
  (共享选择器)换 `--odk-secondary-strong`;`.al-weekday` 0.14→0.15
  (23.8→25.5px 跨过 24px AA-large 门槛,红色 #eb5757 白底 3.48:1)。
- **CSP 已收紧**:index.html `style-src 'self'`(移除 unsafe-inline);
  全仓无内联 style 属性,运行时样式全是 CSSOM(CSP 不拦)。改 CSP 后
  e2e 必跑——若未来插件模板引入内联 style 属性会静默失效。
- 排查心法:队友/测试"时好时坏"时先做受控 bisect(还原变量重跑)再下结论;
  本例 CSP 一度被误判为元凶,还原后同样失败才定位到 occlusion throttling。
