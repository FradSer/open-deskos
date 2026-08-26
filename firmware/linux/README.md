# Open DeskOS Linux Shell (CM5 / Electron)

Orange Pi CM5(RK3588S)Linux 设备上的 Open DeskOS 外壳切片,基于
[Electron](https://www.electronjs.org/),目标面板为 **568×1232 竖屏触摸**。

这是迁移评估([CM5-S31-INTEGRATION](../../../docs/open-deskos/CM5-S31-INTEGRATION.md))中
"CM5 应用链路"的第一步实现。P4+C6 固件仍是生产权威;本切片不替换它。

## 功能范围(第一片)

- 568×1232 kiosk 窗口,分辨率可经环境变量覆盖
- **三段式 Open DeskOS 布局**:顶部状态栏(左连接闪电/中页点/右粗体时钟)、
  中部 3 列 widget 网格(按 `desktop_layout.lua` 声明的跨列跨行磁贴)、底部内缩 peek 条
  (显示 Mac 连接与网络状态,点击进入网络连接说明)
- Open DeskOS 设计 token(与根目录 `DESIGN.md` 逐色对齐,由测试强制);网格几何使用
  Open DeskOS portrait 算法(fit = min(w/320, h/480))
- 三页横向触摸滑动:Dashboard 流 / Home 网格 / Quota 页;当前页名与 N/3 可见,年份进度条
- 磁贴是纯展示面(对齐 ESP32-P4):点按与键盘都不进入 App;未接入 App 明确显示待接入状态
- quota 与 peek 分离显示 Mac companion 健康状态和网络在线状态,提供网络连接说明与重新检查入口

## 目录结构

```
src/main.js            Electron 主进程(窗口/kiosk/smoke 检查,导航与权限拒绝,
                       单实例锁,渲染进程崩溃退出)
src/renderer/index.html 骨架(状态栏/分页视口/peek/app-view),不含页面内容
src/renderer/shell.js   组合根:几何、分页器、对话框、键盘导航、核心状态栏
src/renderer/layout.js  网格几何(Open DeskOS portrait 分支)
src/renderer/core/      插件注册表、共享服务(tick/连接)、桌面组合器
src/renderer/config/    desktop_layout.js:页面构成与磁贴摆放的唯一权威
src/renderer/plugins/   页面/磁贴/状态栏/peek 插件,每个文件自包含
docs/AI_PLUGIN_GUIDE.md AI 生成新插件的契约与步骤指南
tests/features/        BDD 场景(中文 Gherkin)
tests/smoke.sh         可执行检查:两种分辨率启动 + Open DeskOS token 对齐
                       + 架构契约(骨架纯净/核心无专名)
scripts/start-kiosk.sh kiosk 启动包装器:崩溃自动重启,日志写入 launcher.log
scripts/cm5-install.sh CM5 设备端安装器(依赖/arm64 模块/kiosk 自启)
scripts/cm5-acceptance.sh
                       设备端验收脚本:输出 JSON 报告(arch/session/display/
                       touch/gpu/electron/smoke/autostart/memory),失败时非零退出
```

扩展外壳 = 新增一个插件文件(+ 在 `config/desktop_layout.js` 声明位置):
磁贴、整页、状态栏指示、peek 内容全部可插件化,零核心改动;
完整契约见 [docs/AI_PLUGIN_GUIDE.md](docs/AI_PLUGIN_GUIDE.md)。

## 本机开发(macOS/Linux 均可)

```sh
cd firmware/linux
pnpm install          # 或 npm install
pnpm styles           # 生成 Open DeskOS UnoCSS utility stylesheet
./run.sh              # 窗口模式,默认 568x1232
ODESK_SHELL_KIOSK=1 ./run.sh --kiosk   # kiosk 全屏
bash tests/smoke.sh   # 可执行检查
```

开发时可用 `pnpm styles:watch` 持续生成样式。环境变量:`ODESK_SHELL_WIDTH` / `ODESK_SHELL_HEIGHT`(默认 568/1232)、
`ODESK_SHELL_KIOSK=1`;命令行 `--kiosk` 等价。Wayland 会话(`WAYLAND_DISPLAY`
已设置)由 `run.sh` 自动追加 `--ozone-platform-hint=auto`,用户显式传入时不重复。

Mac companion 通过网络提供状态服务。默认检查 `http://127.0.0.1:8788/health`;
部署到 CM5 时用 `ODK_COMPANION_HOST=<Mac 的局域网地址>` 和可选
`ODK_COMPANION_PORT=<端口>` 指向 Mac。`ODK_COMPANION_HEALTH_URL` 仍可直接覆盖完整 URL。
Mac 与 CM5 必须位于同一可达网络；不要把 `127.0.0.1` 用作跨设备地址。

## 部署到 CM5

```sh
# 从 Mac 同步(排除 node_modules;保留 pnpm-lock.yaml 以锁定设备端版本)
rsync -a --delete --exclude node_modules \
  firmware/linux/ cm5:/opt/open-deskos-shell/
# token 检查在设备上需要仓库根的 DESIGN.md
rsync -a DESIGN.md cm5:/opt/open-deskos-shell/DESIGN.md

# 在 CM5 上执行(sudo 用于 apt 依赖安装;无 root 且无 sudo 时会明确报错)
ssh cm5
cd /opt/open-deskos-shell && bash scripts/cm5-install.sh
sudo reboot   # 重启后进入 kiosk 外壳
```

安装器注册的自启项指向 `scripts/start-kiosk.sh`:它导出 `ODESK_SHELL_KIOSK=1`,
外壳退出(含崩溃)后 3 秒自动重启,全部输出追加到
`~/.local/state/open-deskos-shell/launcher.log`。

首次 bring-up 后在设备上执行验收并留存结果:

```sh
bash scripts/cm5-acceptance.sh | tee acceptance-report.json
```

### 无屏设备测试(headless)

设备未接面板时,用 Xvfb 跑 smoke/e2e;注意三点:Xvfb 屏幕必须不小于窗口
(否则高度被钳制)、root 会话由 `run.sh` 自动附加 `--no-sandbox`、e2e 窗口
必须可见(无 GPU 时隐藏窗口不产帧):

```sh
xvfb-run -a --server-args="-screen 0 568x1232x24" bash tests/smoke.sh
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a --server-args="-screen 0 800x1400x24" \
  ./node_modules/.bin/electron tests/e2e.js
```

触摸输入经显示服务器(X11/Wayland)的 evdev 栈直达 Chromium,无需额外驱动;
如需校准用 `xinput` 触发。Electron 的 linux-arm64 官方构建由设备端
`pnpm/npm install` 自动拉取(pnpm 路径使用 `--frozen-lockfile`)。

## 图标

全部图标来自 [Tabler Icons](https://github.com/tabler/tabler-icons)
(outline,MIT),以 `@tabler/icons` v3.46.0 的官方路径数据内联到
`src/renderer/index.html`,每个图标带 `data-tabler="名称"` 标识,e2e 校验集合完整性。
升级时从 `node_modules/@tabler/icons/icons/outline/` 复制对应 svg 内部路径即可。

## 验证状态

- 已验证:UnoCSS CLI 样式生成、宿主机 smoke(窗口尺寸两种场景 + Open DeskOS token 对齐),macOS arm64。
- Mac companion 状态检查经 Electron 主进程调用 `http://127.0.0.1:8788/health`(macOS App 内置的
  CompanionStatusServer,默认监听 Mac 的网络接口,返回 `service: "OpenDeskOS companion"` 身份标识;
  非 OpenDeskOS 身份的 2xx 响应一律视为未连接)。可用时显示 Mac 已连接,不可用时显示 Mac 尚未连接。
  检查地址可用 `ODK_COMPANION_HOST` / `ODK_COMPANION_PORT` 或 `ODK_COMPANION_HEALTH_URL` 覆盖。Dashboard 叙述流随连接状态切换,已连接时隐藏连接 CTA。
- 已验证:本地字体加载、网络/bridge 状态文案、网络连接说明入口、Escape 返回、宿主机 smoke/e2e。
- 已验证(CM5 真机,2026-08-23,无屏 Xvfb):smoke 两种分辨率 + token + 布局
  全绿;e2e 含 100+ 项交互、连接与几何检查全绿;arm64 Electron v43.4.1 依赖完整。root 会话由 run.sh
  自动附加 --no-sandbox。无头环境下隐藏窗口不产帧、CSS 过渡冻结,测试窗口
  必须 show(e2e 已改)。
- 未验证:真实面板(GPU 合成上屏、真实 evdev 触摸、桌面会话自启)。
  接屏后用 `scripts/cm5-acceptance.sh` 留存证据。
- 网络闪电反映的是接口级在线状态(`navigator.onLine`);Mac companion 状态来自实际
  `/health` 请求。Internet 在线不等于 Mac 已连接；跨设备部署必须配置 Mac 的局域网地址。
