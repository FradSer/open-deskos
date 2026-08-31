# Open DeskOS Linux Shell (CM5 / Electron)

Orange Pi CM5 (RK3588S) Linux 设备上的 Open DeskOS 外壳，基于 Electron，目标 HDMI 显示为 **1920×1280**。

这是 CM5 应用链路的 Linux 实现：Linux 设备可以独立运行，不需要连接 Mac。OpenCode Go 用量由 Linux Electron 主进程直接读取并展示，Remote Bridge 仅负责可选的遥控器分页链路。

## 功能范围

- 1920×1280 默认 kiosk 窗口，分辨率可经环境变量覆盖；布局会响应其它窗口尺寸
- 三段式 Open DeskOS 布局：顶部网络指示/应用入口/时钟，中部三列 Widget 网格，底部 peek 状态条
- 三页横向触摸滑动：概览、应用、用量
- OpenCode Go 用量页显示滚动窗口、周/月用量、重置时间和 Zen 余额
- 用量状态由设备本地配置决定：未配置、同步成功、凭据无效或暂不可用均如实显示，不伪造数据
- Face Agent 视觉状态由 Electron 主进程从固定 loopback 健康端点读取；服务、相机和当前帧状态均如实显示，不伪造人脸、身份或情绪
- Widget 先陈述真实状态；已声明 `open-app` 的 Widget 是对应 App 的状态延续与内容入口
- UI 只发出 intent，实际安装、启动、动作和停止穿过 Installer → App Manager → App Runtime
- Remote Bridge 通过 Unix socket 发布权威分页状态；peek 分别显示网络、OpenCode Go 和 Remote Link 状态

## 目录结构

```
p4-camera/              ESP32-P4 SC2336 MIPI CSI 摄像头子设备固件
remote-control/         ESP32-S3 USB Remote Control 固件
remote-bridge/          Node.js systemd user service，负责遥控器链路
src/main.js             Electron 主进程、窗口、kiosk 和 IPC
src/opencode-go.js      Linux OpenCode Go 请求、鉴权和响应解析
src/face-agent-status.js Face Agent loopback health endpoint client and fail-closed normalizer
face-agent/              Face Agent service overlay and user systemd unit
src/renderer/           沙盒 DOM 外壳、插件和声明式布局
docs/AI_PLUGIN_GUIDE.md 插件契约和扩展步骤
tests/features/         中文 Gherkin 场景
tests/smoke.sh          分辨率、token、骨架和核心架构检查
scripts/start-kiosk.sh  kiosk 启动包装器
scripts/cm5-install.sh CM5 设备端安装器
```

## 本机开发

```sh
cd firmware/linux
pnpm install
pnpm styles
./run.sh
ODESK_SHELL_KIOSK=1 ./run.sh --kiosk
bash tests/smoke.sh
pnpm test
pnpm run e2e
```

Wayland 会话在 `run.sh` 中自动追加 `--ozone-platform-hint=auto`；root 会话会自动追加 `--no-sandbox`。

## OpenCode Go Linux 配置

Linux 外壳不读取 macOS Keychain，也不依赖外部 companion。首次使用前，在 CM5 的用户会话中配置：

```sh
export ODK_OPENCODE_GO_URL=https://opencode.ai
export ODK_OPENCODE_COOKIE_FILE=/etc/open-deskos/opencode-go.cookie
```

也可以使用 `ODK_OPENCODE_COOKIE` 临时传入 cookie。推荐使用权限为 `0600` 的 cookie 文件，并通过 systemd/user 环境或 kiosk 启动会话注入，不要把凭据写入仓库或日志。

`ODK_OPENCODE_GO_URL` 必须显式设置；请求在 Electron 主进程完成，renderer 只收到脱敏后的状态和用量快照。renderer CSP 不允许远程连接，凭据不会通过 preload 暴露。

## Face Agent (CM5 local vision)

Face Agent runs as the `orangepi` user service `open-deskos-face-agent.service`. Electron never opens a camera or reads the Face Agent model/profile files; its main process reads only `http://127.0.0.1:8790/status` with a short timeout. The endpoint is intentionally fixed to loopback, not environment-configurable.

The deployer provides `/opt/face-agent/` with its source, models, and owner profile. `scripts/cm5-install.sh` installs the runtime dependencies, creates `/opt/face-agent-venv` using the system OpenCV/AioHTTP/NumPy packages, installs `onnxruntime`, installs the service, and starts it before kiosk autostart. The service defaults to `/dev/video0`, MJPEG 640×360 at 30 FPS; use systemd user-service environment overrides only after verifying the device format.

`/status` distinguishes `starting`, `no-frame`, `camera-unavailable`, and `online`. The Electron widgets preserve those distinctions and fail closed to “Face Agent unavailable” for an unreachable, malformed, or failed endpoint. A running service with no delivered camera frames is never reported as online or face-free.

## ESP32-P4 SC2336 Camera Sub-device

`p4-camera/` 是专为 CM5 Linux 面板配套的 ESP32-P4 摄像头子设备固件工程，完全封装在 `firmware/linux/` 切片内。

- **硬件连接**：SC2336 模组经 2-lane MIPI CSI-2 连入 ESP32-P4；SCCB 控制走 I2C0（SDA: GPIO 7, SCL: GPIO 8, RST: GPIO 26）。
- **通信与流传输**：ESP32-P4 经 USB (UVC/CDC) 与 CM5 连接，既可作为标准视频设备输出帧，也可传输结构化 v1 元数据（人脸检测与置信度），为后续在 P4 端实现本地人脸推理奠定基础。
- **构建与烧录**：
  ```sh
  cd firmware/linux/p4-camera
  eim run 'idf.py set-target esp32p4' v6.0.1
  eim run 'idf.py build' v6.0.1
  ```

## 部署到 CM5

```sh
rsync -a --delete --exclude node_modules firmware/linux/ cm5:/opt/open-deskos-shell/
rsync -a DESIGN.md cm5:/opt/open-deskos-shell/DESIGN.md
ssh cm5
cd /opt/open-deskos-shell && bash scripts/cm5-install.sh
sudo reboot
```

在 kiosk 用户会话中配置 OpenCode Go 环境变量后再启动 `scripts/start-kiosk.sh`。安装器注册的自启项会在外壳退出后自动重启，日志位于 `~/.local/state/open-deskos-shell/launcher.log`。

Remote Bridge 使用 `$XDG_RUNTIME_DIR/open-deskos-remote/bridge.sock`。生产环境不支持 socket 路径覆盖；自动化测试可同时设置 `ODESK_SHELL_TEST_MODE=1` 和绝对路径 `ODESK_REMOTE_BRIDGE_SOCKET`。

## 无屏设备测试

```sh
xvfb-run -a --server-args="-screen 0 1920x1280x24" bash tests/smoke.sh
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a --server-args="-screen 0 1920x1280x24" \
  ./node_modules/.bin/electron tests/e2e.js
```

## 验证状态

已验证：OpenCode Go 配置/解析单元测试、Linux 主进程 IPC 设计、renderer 沙盒约束、Remote Bridge 单元测试、host smoke 的 token 和布局检查。

尚未验证：真实 CM5 GPU 合成、evdev 触摸、桌面会话自启，以及真实 OpenCode Go 账户请求。真实设备验收使用 `scripts/cm5-acceptance.sh`。
