# Open DeskOS Linux Shell (CM5 / Electron)

Orange Pi CM5(RK3588S)Linux 设备上的 Open DeskOS 外壳切片,基于
[Electron](https://www.electronjs.org/),目标面板为 **568×1232 竖屏触摸**。

这是迁移评估([CM5-S31-INTEGRATION](../../../docs/open-deskos/CM5-S31-INTEGRATION.md))中
"CM5 应用链路"的第一步实现。P4+C6 固件仍是生产权威;本切片不替换它。

## 功能范围(第一片)

- 568×1232 kiosk 窗口,分辨率可经环境变量覆盖
- **三段式布局对齐 ESP32-P4 launcher**:顶部状态栏(左连接闪电/中页点/右粗体时钟)、
  中部 3 列 widget 网格(按 `desktop_layout.lua` 声明的跨列跨行磁贴)、底部内缩 peek 条
  (当前为空,预留灵动岛式扩展)
- AIODI 设计系统 token(与根目录 `DESIGN.md` 逐色对齐,由测试强制);网格几何移植
  固件 `aiodi.grid_metrics()` portrait 算法(fit = min(w/320, h/480))
- 三页横向触摸滑动:Dashboard 流 / Home 网格 / Quota 页;年份进度条
- 点按 widget 进入全屏视图,返回按钮始终可用;连接/用量状态如实显示未连接

## 目录结构

```
src/main.js            Electron 主进程(窗口/kiosk/smoke 检查)
src/renderer/          外壳 UI(纯 DOM,index.html + shell.css + shell.js)
tests/features/        BDD 场景(中文 Gherkin)
tests/smoke.sh         可执行检查:两种分辨率启动 + DESIGN.md token 对齐
scripts/cm5-install.sh CM5 设备端安装器(依赖/arm64 模块/kiosk 自启)
```

## 本机开发(macOS/Linux 均可)

```sh
cd firmware/linux
pnpm install          # 或 npm install
./run.sh              # 窗口模式,默认 568x1232
ODESK_SHELL_KIOSK=1 ./run.sh --kiosk   # kiosk 全屏
bash tests/smoke.sh   # 可执行检查
```

环境变量:`ODESK_SHELL_WIDTH` / `ODESK_SHELL_HEIGHT`(默认 568/1232)、
`ODESK_SHELL_KIOSK=1`;命令行 `--kiosk` 等价。Wayland 会话追加
`--ozone-platform-hint=auto`。

## 部署到 CM5

```sh
# 从 Mac 同步(排除 node_modules,设备端按 arm64 重装)
rsync -a --delete --exclude node_modules --exclude pnpm-lock.yaml \
  firmware/linux/ cm5:/opt/open-deskos-shell/

# 在 CM5 上执行
ssh cm5
cd /opt/open-deskos-shell && bash scripts/cm5-install.sh
sudo reboot   # 重启后进入 kiosk 外壳
```

触摸输入经显示服务器(X11/Wayland)的 evdev 栈直达 Chromium,无需额外驱动;
如需校准用 `xinput` 触发。Electron 的 linux-arm64 官方构建由设备端
`pnpm/npm install` 自动拉取。

## 图标

全部图标来自 [Tabler Icons](https://github.com/tabler/tabler-icons)
(outline,MIT),以 `@tabler/icons` v3.46.0 的官方路径数据内联到
`src/renderer/index.html`,每个图标带 `data-tabler="名称"` 标识,e2e 校验集合完整性。
升级时从 `node_modules/@tabler/icons/icons/outline/` 复制对应 svg 内部路径即可。

## 验证状态

- 已验证:宿主机 smoke(窗口尺寸两种场景 + AIODI token 对齐),macOS arm64。
- 未验证:CM5 真机(GPU 合成、触摸事件、自启)。首次上机时按 README 排查,
  不要把宿主机绿当作设备绿。
