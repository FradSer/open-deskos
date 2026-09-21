# Open DeskOS Linux Shell (CM5 / Electron)

Orange Pi CM5 (RK3588S) Linux 设备上的 Open DeskOS 外壳，基于 Electron，目标 HDMI 显示为 **1920×1280**。

这是当前的 CM5 Linux Desk Companion 可行性垂直切片：设备可独立运行，不需要连接 Mac。它验证一个可信的本地桌面外壳——时间、网络、专注和显式配置的 OpenCode Go 状态；OpenCode Go 用量由 Linux Electron 主进程直接读取，Remote Bridge 仅负责可选的遥控器分页链路。P4 摄像头以标准 UVC webcam + UAC 麦克风形态接入，C6 网关和可安装应用平台仍保留为实验集成，绝不阻塞基础外壳。

## 功能范围

- 1920×1280 默认 kiosk 窗口，分辨率可经环境变量覆盖；布局会响应其它窗口尺寸
- Open DeskOS 布局：顶部 State Bar（网络指示、Pi Sessions 和时钟），下方五列三行 Widget 网格；窄窗口保留可读的方形 Widget 并纵向滚动，不再缩小整页内容
- 基础桌面五页横向触摸滑动：Today、Home、Reading、Pi Sessions、Usage；Home 和 Reading 展示不可交互 Widget，用户生成的 Widget 可安装到指定网格位置；Pi Sessions 同时读取本地 `ps` 进程表和 Pi 会话元数据，无元数据的进程也会如实显示其 PID、工作目录、状态和运行时长
- OpenCode Go 用量页显示滚动窗口、周/月用量、重置时间和 Zen 余额
- 用量状态由设备本地配置决定：未配置、同步成功、凭据无效或暂不可用均如实显示，不伪造数据
- P4 摄像头以标准 UVC webcam 与 UAC 麦克风形态接入 CM5，无人脸识别、无表情分析、无身份存储；Home 页 1x1 摄像头 tile 定时展示最新一帧
- Widget 先陈述真实状态；已声明 `open-app` 的 Widget 是对应 App 的状态延续与内容入口
- UI 只发出 intent；当前的 main-process endpoint 与 renderer runtime 验证内置视图启动、动作和停止的 seam，不宣称已提供可安装应用平台
- Remote Bridge 通过 Unix socket 发布权威分页状态；OpenCode Go 和 Remote Link 状态在各自的专用页面中如实显示

## 目录结构

```
../../peripherals/esp32-p4-camera/  ESP32-P4 SC2336 MIPI CSI camera peripheral
../../peripherals/esp32-s3-remote/  ESP32-S3 Remote Control peripheral
../../integrations/remote-bridge/   Node.js systemd user service for the Remote link
src/main.js                         Electron main process, kiosk, and IPC
src/opencode-go.js                  Linux OpenCode Go request/auth/response parsing
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
pnpm run e2e              # 含 Widget / App 内部样式与交互回归
pnpm exec electron tests/widget-app-styles.cjs  # 单独运行样式回归
pnpm exec electron tests/widget-density.cjs     # 逐 Widget 的 62% 填充率门禁
pnpm exec electron tests/page-indicator.cjs      # 纯图形分页、三主题及等高胶囊
pnpm exec electron tests/pixel-font.cjs          # 中英文实际 Zpix 字形与布局
pnpm exec electron tests/pi-sessions-states.cjs  # Pi Sessions 各状态截图 + manifest
pnpm exec electron tests/capture-sheet.cjs       # 把一组截图拼成一张对照图
```

`tests/pi-sessions-states.cjs` 用 fixture IPC 驱动 Pi Sessions 页面与 Home 卡片的每个状态，逐张断言状态成立后才截图，并写出 `manifest.json`；截图只供人看，判定依据是 DOM 状态。默认对当前 checkout 取图，也可指向设备上的已安装 release：

```sh
ODK_SHELL_ROOT=/opt/open-deskos/current ODK_CAPTURE_DIR=/tmp/states \
  electron tests/pi-sessions-states.cjs
ODK_SHEET_DIR=/tmp/states ODK_SHEET_OUT=/tmp/states/sheet.png \
  electron tests/capture-sheet.cjs
```

### Pixel 像素字体

Pixel 主题统一使用本地 [Zpix v3.2.0](https://github.com/SolidZORO/zpix-pixel-font/releases/tag/v3.2.0) 字体：英文、简繁中文、数字、输入框和代码内容均由 Zpix Regular 渲染，不依赖在线字体，不合成粗体。官方 WOFF2 原文件约 944 KiB，未转换或裁剪；原字体文件已移除。

**许可注意：个人/教育项目免费，商业产品需向作者另购授权。** 来源、SHA-256 与原文条款见 `src/renderer/fonts/ZPIX-NOTICE.md`。

状态栏分页在所有主题中都不显示文字，只使用点/短条；Pi 状态与分页胶囊统一为 44px 高度。切换主题不改变当前页、焦点或点击区域。`pnpm e2e` 包含实际中英文字形、三主题切换与状态栏检查。

### Border Beam 可选主题

参考 [Libraries.dev / border-beam](https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/border-beam)
的 Mono 行进边框，使用本地 CSS 实现，不引入 React。新安装默认 Pixel；暂不提供状态栏切换入口。
开发时可在 renderer 控制台调用 `odkTheme.set('border-beam')`，恢复默认用
`odkTheme.set('instrument')`。选择保存在本地，重启后恢复。
减少动态效果时边框静止，窗口隐藏时暂停动画。

验证：`pnpm exec electron tests/border-beam-theme.cjs`。
CM5 实机绘制性能尚未验证。

### Widget 密度校验

`pnpm e2e` 同时运行密度门禁：5 种尺寸、在线/不可用状态，以及年初/年末数值。单独运行可选：

```sh
pnpm exec electron tests/widget-density.cjs --state=live --sizes=1920x1280,480x854
pnpm exec electron tests/widget-density.cjs --date=2026-12-31T23:59:00
pnpm exec electron tests/widget-density.cjs --report-only --output=/tmp/widget-density.json --capture-dir=/tmp/widget-density
```

- **视觉填充率**：真实文本行框、SVG 图标/仪表与进度条的紧致包围盒面积 ÷ 卡片边框内面积；目标 **62%，容差 ±8 个百分点**。
- **稀疏防护**：元素矩形联合占用面积至少 20%，最大横贯卡片的纵向空白带不超过 28%。不把空 flex 容器或卡片背景算成内容，也不重复计入重叠元素。
- 这不是字形着墨率：图标和环形仪表按其视觉框测量，不能解释为非背景像素比例。JSON 保留逐元素矩形，便于复核。
- 默认固定时钟以保证结果可复现，`--date` 可检验不同日期/时间。`--capture-dir` 保存每种尺寸的 Home 截图及逐 Widget 截图；捕获时会滚动到对应 Widget。
- 默认违规返回非零退出码。`--report-only` 仅允许采集不通过的报告，仍如实输出 `ok: false`，不能作为验收通过依据。

Wayland 会话在 `run.sh` 中自动追加 `--ozone-platform-hint=auto`；root 会话会自动追加 `--no-sandbox`。

## Pi Sessions Mac 监控（可选）

默认仍监控本机；可通过认证 SSH 切换为 Mac 数据源。部署采集器、配置 SSH 密钥和持久化 kiosk 服务环境变量的步骤见 [Mac Pi monitoring](docs/PI_SESSIONS_REMOTE.md)。远端不可用时不会回退本机或显示为空闲。

## Hosted Pi 控制（可选）

Mac 上的 Pi 会话可以作为 **Console** 远程驱动 desk 托管的 **Hosted Pi**：用 `/open-deskos` 打开控制台列出、启动、进入、追加指令、取消和结束这些会话，事件与历史共用会话日志位置这一个坐标，attach 时从上次位置续接。控制走与上报链路分开的连接（同一监听面，不新增端口），使用独立凭据且**凭据不上线**；未配置控制凭据时行为与现在完全一致。desk 会在 Pi Sessions 总览标题上标明当前驱动方，本地触控与键盘始终不受影响。协议与边界见 [Desk Link](docs/DESK_LINK.md)，决策与取舍见 [ADR-0013](docs/adr/0013-desk-link-carried-hosted-pi-control.md)，规格见 package 的 `docs/spec-desk-link-hosted-pi-console.md`。

## 用户应用生命周期

`ODESK_WORKSPACE/apps/<id>` 下的本地应用草稿经系统验证确切候选内容后安装，支持更新、失败保留旧版本、回滚和卸载；安装状态与 Widget 桌面位置独立于 Shell release 持久化。用户生成的 Widget 与内置 Widget 共用桌面网格，可由 Voice Agent 指定页面、位置和跨度，安装后也可移动；不再设置独立的 **User Applications / Your apps** 收纳页。Widget 为只读展示，交互式 App 在独立页面的受限 iframe 中运行。内置 Agent 使用系统安装入口，不以“文件已写入”冒充安装成功。

首版仅支持自包含、离线 HTML/CSS/JavaScript，无 Node、网络、后台服务或持久化应用数据 API。完整格式、限制和验收见 [用户应用](docs/USER_APPLICATIONS.md)。

## Remote 语音 Agent

Remote 的 MIC 先由 Shell 区分恢复对话与录音操作，不经过 Pi Sessions 监控 app/widget。Back 隐藏反馈后，再按 MIC 只恢复当前对话（包括后台完成的结果），不启动新任务。面板可见且 Agent 正在运行时 MIC 不重复提交；完成后再按 MIC 开始下一次录音。录音面板可见时再次点击停止录音并提交，也可在说话后由 CM5 本地 VAD 检测到约 1.2 秒静音时自动提交；没有 30 秒录音截止时间，尚未说话则继续等待。使用 CM5 Linux 默认录音设备，不读取 Remote 音频。Listening 保持麦克风图标与单行状态，下方线条显示实测输入音量；转写完成后先显示识别出的输入原文，再显示 Working；Agent 的对外回复随实际生成流式显示，支持安全 Markdown 排版。完成后移除 Working 并保留输入与回复；向上阅读时新输出不会强制滚回底部。链接仅显示文字和地址，不打开外部页面。桌面独立反馈录音、转写、执行和错误状态。

语音经显式配置的 OpenAI-compatible 服务转写，再由 Pi harness 在独立可写 checkout 中执行。能力工具可扩展；首批支持 Widget/App 开发和向已接入 session-control 扩展的 Pi session 发送 prompt。仅被监控到的进程不代表可控制，排队成功不代表任务完成。生成代码不会绕过验证直接修改 active release。

配置与边界见 [Voice Agent](../../integrations/voice-agent/README.md) 和 [部署指南](docs/VOICE_AGENT_DEPLOYMENT.md)。音频、转写服务认证及真实模型执行需要独立验收；测试通过不代表设备端链路已配置完成。

## OpenCode Go Linux 配置

Linux 外壳通过 CLIProxyAPI 已保存的认证文件读取 Codex、Antigravity 和 xAI 配额，不复制 OAuth token，也不读取 macOS Keychain。首次使用前，在 CM5 的用户会话中配置：

```sh
export ODK_CLIPROXY_URL=https://cliproxy.internal.example
export ODK_CLIPROXY_MANAGEMENT_KEY_FILE=/etc/open-deskos/cliproxy-management.key
```

也可以使用 `ODK_CLIPROXY_MANAGEMENT_KEY` 临时传入管理密钥。推荐使用权限为 `0600` 的密钥文件，并通过 systemd/user 环境或 kiosk 启动会话注入，不要把管理密钥或 CLIProxyAPI 认证文件写入仓库或日志。

CLIProxyAPI 的 Management API 必须允许 CM5 访问。远程地址必须使用 HTTPS；只有同机 `127.0.0.1`、`::1` 或 `localhost` 可以使用明文 HTTP。请求和 provider token 替换全部在 Electron 主进程与 CLIProxyAPI 中完成；renderer 只收到账号名、认证文件名、套餐、额度百分比和重置时间等脱敏快照。renderer CSP 不允许远程连接，管理密钥和 OAuth token 均不会通过 preload 暴露。单个 provider 获取失败时，其卡片显示不可用，其它账号仍继续展示。

## ESP32-P4 SC2336 Camera Sub-device (generic UVC webcam)

`../../peripherals/esp32-p4-camera/` is the ESP32-P4 SC2336 Camera Peripheral. It exposes a standard UVC MJPEG camera and a standard UAC microphone over one native USB connection, with no face recognition, expression analysis, or biometric storage. It is part of the intended CM5 architecture and has its own hardware acceptance gate; the base CM5 shell remains usable through direct touch and keyboard until that gate passes.

- **硬件连接**：SC2336 模组经 2-lane MIPI CSI-2 连入 ESP32-P4；SCCB 控制走 I2C0（SDA: GPIO 7, SCL: GPIO 8, RST: GPIO 26）。
- **通信**：ESP32-P4 经原生 USB 以标准 UVC MJPEG（1280x720）摄像头与标准 UAC 麦克风形态接入 CM5；无厂商私有协议、无图像帧之外的元数据。
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

# Optional, only after the camera hardware acceptance gate:
# bash runtime/linux/scripts/p4-camera-acceptance.sh

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

已验证：OpenCode Go 配置/解析单元测试、Linux 主进程 IPC 设计、renderer 沙盒约束、Remote Bridge 单元测试、host smoke 的 token 和布局检查；并已在真实 CM5 的 X11 `:0` HDMI 会话验证 active release、1920×1280 smoke、kiosk user service、Remote Bridge、原子 release 指针与 rollback candidate。CM5 运行时实际截图确认 State Bar 的网络可达指示器与 Today 首页的插件陈述可见。

CM5 通过 `scripts/cm5-gpu-userspace.sh` 安装 ARM libmali 用户态 blob（Rockchip 6.1 SDK，DDK g24p0）与 CSF 固件 `mali_csffw.bin`：内核自带的 kbase 驱动已把 Mali-G610 探针为 `/dev/mali0`，Xorg 的 glamor 随后在该 blob 上初始化。Chromium 只接受 ANGLE 实现，因此外壳把 ANGLE 固定到 gles-egl 后端，并让显示合成器留在软件路径——GPU rasterization 与 WebGL 仍在 Mali 上执行。`ODESK_GPU_BACKEND=default|mali` 可显式选择后端，`ODESK_DISABLE_GPU=1` 或 `LIBGL_ALWAYS_SOFTWARE=1` 仍强制软件渲染。`scripts/cm5-acceptance.sh` 分别报告 Mesa GLX 的 `gpu-renderer`、真正的 EGL renderer（ARM Mali-G610）、Xorg glamor 状态与已安装的 Mali 用户态。安装或移除后必须重启图形会话。
