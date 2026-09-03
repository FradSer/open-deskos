# Open DeskOS Linux Shell (CM5 / Electron)

Orange Pi CM5 (RK3588S) Linux 设备上的 Open DeskOS 外壳，基于 Electron，目标 HDMI 显示为 **1920×1280**。

这是当前的 CM5 Linux Desk Companion 可行性垂直切片：设备可独立运行，不需要连接 Mac。它验证一个可信的本地桌面外壳——时间、网络、专注和显式配置的 OpenCode Go 状态；OpenCode Go 用量由 Linux Electron 主进程直接读取，Remote Bridge 仅负责可选的遥控器分页链路。P4 摄像头、Face Agent、C6 网关和可安装应用平台仍保留为实验集成，绝不阻塞基础外壳。

## 功能范围

- 1920×1280 默认 kiosk 窗口，分辨率可经环境变量覆盖；布局会响应其它窗口尺寸
- Open DeskOS 布局：顶部 State Bar（网络、OpenCode Go、Remote Link、Pi Sessions 和时钟），下方五列三行 Widget 网格；窄窗口自适应重排
- 四页横向触摸滑动：Today、Home、Pi Sessions、Usage；Home 仅展示不可交互 Widget，后两页提供 App 交互
- OpenCode Go 用量页显示滚动窗口、周/月用量、重置时间和 Zen 余额
- 用量状态由设备本地配置决定：未配置、同步成功、凭据无效或暂不可用均如实显示，不伪造数据
- Face Agent 视觉状态由 Electron 主进程从固定 loopback 健康端点读取；这是不阻断的实验集成，服务、相机和当前帧状态均如实显示，不伪造人脸、身份或情绪
- Widget 先陈述真实状态；已声明 `open-app` 的 Widget 是对应 App 的状态延续与内容入口
- UI 只发出 intent；当前的 main-process endpoint 与 renderer runtime 验证内置视图启动、动作和停止的 seam，不宣称已提供可安装应用平台
- Remote Bridge 通过 Unix socket 发布权威分页状态；State Bar 始终显示网络、OpenCode Go 和 Remote Link 状态

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
scripts/update-runtime.js CM5 原子 release 激活与回退事务
scripts/migrate-runtime.js CM5 用户级、幂等 runtime migration
scripts/cm5-stage-release.sh 从开发机 stage 并在 CM5 上激活 release
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

## Experimental Face Agent (ESP32-P4 metadata adapter)

Face Agent is a preserved, opt-in experiment; it is not required for the desk shell, and cannot lock or hide core shell data. Face capture, inference, owner-feature storage, and physical enrollment run exclusively on the ESP32-P4. CM5 accepts only validated P4 USB-CDC metadata through `/dev/open-deskos-p4-camera`; Electron reads only `http://127.0.0.1:8790/status` with a short timeout. The endpoint is intentionally fixed to loopback, not environment-configurable.

The experimental deployer provides `/opt/face-agent/` with the CM5 metadata adapter source. Install it only after a separate hardware acceptance decision:

```sh
ODESK_INSTALL_EXPERIMENTAL_VISION=1 bash scripts/cm5-install.sh
```

That opt-in path creates `/opt/face-agent-venv`, installs its serial metadata dependencies, enables `open-deskos-face-agent.service`, and configures the optional P4 serial rule. `/status` distinguishes `starting`, `no-frame`, `camera-unavailable`, and `online`; an unreachable, stale, or malformed P4 record remains an unavailable experimental status. A running service with no valid P4 metadata is never reported as online or face-free.

## Experimental ESP32-P4 SC2336 Camera Sub-device

`../../peripherals/esp32-p4-camera/` is the ESP32-P4 SC2336 Camera Peripheral. It is part of the intended CM5 architecture and has its own hardware acceptance gate; the base CM5 shell remains usable through direct touch and keyboard until that gate passes.

- **硬件连接**：SC2336 模组经 2-lane MIPI CSI-2 连入 ESP32-P4；SCCB 控制走 I2C0（SDA: GPIO 7, SCL: GPIO 8, RST: GPIO 26）。
- **通信与推理**：ESP32-P4 经 USB CDC 与 CM5 连接，只传输由 P4 本地推理产生的结构化 v1 元数据；不会作为 CM5 视频设备输出图像帧。
- **构建与烧录**：
  ```sh
  cd peripherals/esp32-p4-camera
  eim run 'idf.py set-target esp32p4' v6.0.1
  eim run 'idf.py build' v6.0.1
  ```

## 部署到 CM5

```sh
# From the development checkout: stage, preflight, activate, then verify on CM5.
bash runtime/linux/scripts/cm5-stage-release.sh

# Optional, only after the vision hardware acceptance gate:
# ODESK_INSTALL_EXPERIMENTAL_VISION=1 bash runtime/linux/scripts/cm5-stage-release.sh

ssh cm5 'cd /opt/open-deskos/current && bash scripts/cm5-acceptance.sh'
```

在 kiosk 用户会话中配置 OpenCode Go 环境变量后，由图形会话自启项导入显示环境并启动 `open-deskos-shell.service`。该服务解析 active release，外壳退出后自动重启；日志位于 `~/.local/state/open-deskos-shell/launcher.log`。

## 受控 Runtime 更新

安装器会从同步后的 staging tree 建立首个 versioned release，并创建 `/opt/open-deskos/current` 原子指针和 `open-deskos-shell.service`。候选 release 必须先包含有效的 `release.json`（`schemaVersion: 1`、与目录一致的 `id`）并通过 `pnpm preflight`，才会切换 active release。post-activation kiosk 或 smoke 检查失败会恢复前一个 release；系统包、内核、用户桌面和实验服务不属于此回退范围。

```sh
sudo ODK_RUNTIME_ROOT=/opt/open-deskos \
ODK_CANDIDATE_RELEASE=/opt/open-deskos/releases/<release-id> \
ODK_KIOSK_USER=<kiosk-user> \
ODK_KIOSK_UID=$(id -u <kiosk-user>) \
ODK_KIOSK_HOME=/home/<kiosk-user> \
node scripts/update-runtime.js
```

更新状态、回退候选和用户级 migration marker 位于 `/opt/open-deskos/state/`。同一时间只允许一个更新事务。`scripts/cm5-acceptance.sh` 的 JSON 会分别报告 active/rollback release、migration、base shell、外围服务和硬件证据；host 运行产生的是诊断报告，不是 CM5 硬件验收。

Remote Bridge 使用 `$XDG_RUNTIME_DIR/open-deskos-remote/bridge.sock`。生产环境不支持 socket 路径覆盖；自动化测试可同时设置 `ODESK_SHELL_TEST_MODE=1` 和绝对路径 `ODESK_REMOTE_BRIDGE_SOCKET`。

## 无屏设备测试

```sh
xvfb-run -a --server-args="-screen 0 1920x1280x24" bash tests/smoke.sh
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a --server-args="-screen 0 1920x1280x24" \
  ./node_modules/.bin/electron tests/e2e.js
```

## 验证状态

已验证：OpenCode Go 配置/解析单元测试、Linux 主进程 IPC 设计、renderer 沙盒约束、Remote Bridge 单元测试、host smoke 的 token 和布局检查；并已在真实 CM5 的 X11 `:0` HDMI 会话验证 active release、1920×1280 smoke、kiosk user service、Remote Bridge、原子 release 指针与 rollback candidate。CM5 运行时实际截图确认 Today 与真实 network/OpenCode Go/Remote Link 状态可见。

CM5 默认启用硬件 GPU 加速（Chromium 绕过 blocklist 并启用 GPU rasterization 与 zero-copy），并通过环境变量 `LIBGL_ALWAYS_SOFTWARE=1` 或 `ODESK_DISABLE_GPU=1` 保留软件 fallback。`scripts/cm5-acceptance.sh` 会报告实际的 GPU renderer（如 Panfrost / Mali G610 或 llvmpipe）。
