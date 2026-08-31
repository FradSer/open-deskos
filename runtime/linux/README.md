# Open DeskOS Linux Shell (CM5 / Electron)

Orange Pi CM5 (RK3588S) Linux 设备上的 Open DeskOS 外壳，基于 Electron，目标 HDMI 显示为 **1920×1280**。

这是当前的 CM5 Linux Desk Companion 可行性垂直切片：设备可独立运行，不需要连接 Mac。它验证一个可信的本地桌面外壳——时间、网络、专注和显式配置的 OpenCode Go 状态；OpenCode Go 用量由 Linux Electron 主进程直接读取，Remote Bridge 仅负责可选的遥控器分页链路。P4 摄像头、Face Agent、C6 网关和可安装应用平台仍保留为实验集成，绝不阻塞基础外壳。

## 功能范围

- 1920×1280 默认 kiosk 窗口，分辨率可经环境变量覆盖；布局会响应其它窗口尺寸
- 三段式 Open DeskOS 布局：顶部网络指示/内置视图入口/时钟，中部三列 Widget 网格，底部 peek 状态条
- 三页横向触摸滑动：Today、Home、Usage
- OpenCode Go 用量页显示滚动窗口、周/月用量、重置时间和 Zen 余额
- 用量状态由设备本地配置决定：未配置、同步成功、凭据无效或暂不可用均如实显示，不伪造数据
- Face Agent 视觉状态由 Electron 主进程从固定 loopback 健康端点读取；这是不阻断的实验集成，服务、相机和当前帧状态均如实显示，不伪造人脸、身份或情绪
- Widget 先陈述真实状态；已声明 `open-app` 的 Widget 是对应 App 的状态延续与内容入口
- UI 只发出 intent；当前的 main-process endpoint 与 renderer runtime 验证内置视图启动、动作和停止的 seam，不宣称已提供可安装应用平台
- Remote Bridge 通过 Unix socket 发布权威分页状态；peek 分别显示网络、OpenCode Go 和 Remote Link 状态

## 目录结构

```
../../peripherals/esp32-p4-camera/  ESP32-P4 SC2336 MIPI CSI camera peripheral
../../peripherals/esp32-s3-remote/  ESP32-S3 Remote Control peripheral
../../integrations/remote-bridge/   Node.js systemd user service for the Remote link
../../experiments/vision/face-agent/ Face Agent service overlay and user systemd unit
src/main.js                         Electron main process, kiosk, and IPC
src/opencode-go.js                  Linux OpenCode Go request/auth/response parsing
src/face-agent-status.js            Experimental Face Agent loopback status normalizer
src/renderer/                       Sandboxed DOM shell, plugins, and declarative layout
docs/AI_PLUGIN_GUIDE.md 插件契约和扩展步骤
tests/features/         中文 Gherkin 场景
tests/smoke.sh          分辨率、token、骨架和核心架构检查
scripts/start-kiosk.sh  kiosk 启动包装器
scripts/cm5-install.sh CM5 设备端安装器
```

## 本机开发

```sh
cd runtime/linux
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

## Experimental Face Agent (CM5 local vision)

Face Agent is a preserved, opt-in experiment; it is not required for the desk shell, and cannot lock or hide core shell data. Electron never opens a camera or reads Face Agent model/profile files; its main process may read only `http://127.0.0.1:8790/status` with a short timeout. The endpoint is intentionally fixed to loopback, not environment-configurable.

The experimental deployer provides `/opt/face-agent/` with its source, models, and owner profile. Install it only after a separate hardware acceptance decision:

```sh
ODESK_INSTALL_EXPERIMENTAL_VISION=1 bash scripts/cm5-install.sh
```

That opt-in path creates `/opt/face-agent-venv`, installs its dependencies, enables `open-deskos-face-agent.service`, and configures the optional P4 serial rule. `/status` distinguishes `starting`, `no-frame`, `camera-unavailable`, and `online`; an unreachable or malformed endpoint remains an unavailable experimental status. A running service with no delivered camera frames is never reported as online or face-free.

## Experimental ESP32-P4 SC2336 Camera Sub-device

`../../peripherals/esp32-p4-camera/` is the ESP32-P4 SC2336 Camera Peripheral. It is part of the intended CM5 architecture and has its own hardware acceptance gate; the base CM5 shell remains usable through direct touch and keyboard until that gate passes.

- **硬件连接**：SC2336 模组经 2-lane MIPI CSI-2 连入 ESP32-P4；SCCB 控制走 I2C0（SDA: GPIO 7, SCL: GPIO 8, RST: GPIO 26）。
- **通信与流传输**：ESP32-P4 经 USB (UVC/CDC) 与 CM5 连接，既可作为标准视频设备输出帧，也可传输结构化 v1 元数据（人脸检测与置信度），为后续在 P4 端实现本地人脸推理奠定基础。
- **构建与烧录**：
  ```sh
  cd peripherals/esp32-p4-camera
  eim run 'idf.py set-target esp32p4' v6.0.1
  eim run 'idf.py build' v6.0.1
  ```

## 部署到 CM5

```sh
rsync -a --delete --exclude node_modules runtime/linux/ cm5:/opt/open-deskos/runtime/linux/
rsync -a integrations/ experiments/ peripherals/ cm5:/opt/open-deskos/
rsync -a DESIGN.md cm5:/opt/open-deskos/DESIGN.md
ssh cm5
cd /opt/open-deskos/runtime/linux && bash scripts/cm5-install.sh
# Optional, only after the vision hardware acceptance gate:
# ODESK_INSTALL_EXPERIMENTAL_VISION=1 bash scripts/cm5-install.sh
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
