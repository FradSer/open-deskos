# Configuration inventory

One list of every environment variable the CM5 runtime, the Shell and the integrations read, with the
layer that owns it and the file that declares it. Read it before adding a variable, and update it in
the same change — `tests/config-inventory.test.js` fails when the list and the code disagree.

## Layers and rules

| 层 | 放什么 | 载体 |
|---|---|---|
| L2 安装期 | 发布能决定的值、unit、路径占位符、安装器到更新器的事务参数 | release 模板与安装脚本，手改即漂移 |
| L3 设备本地 | 只放发布定不了的值：设备路径、端点、凭据 | `~/.config/open-deskos/*.env` 与 JSON 配置，`0600` |
| 测试 | 只被测试设置，生产必须走默认值 | 测试进程环境 |

- **声明者等于资源所有者。** 端口与 socket 路径由绑定方声明，连接方读取同一处或向对方询问，不得复述。`ODK_STT_PORT` 是这条规则的样板：bridge 单元声明它，voice agent 由它推导 loopback 端点。
- **准入只实现一次。** 项目是否在允许的开发根目录内由 Hosted Pi daemon 判定；客户端只拒绝无法上路的路径。
- **发布能定的默认值不写进设备层。** 等于代码默认值的行是噪声，删掉它而不是同步它。
- **unit 由安装器从 release 模板生成。** voice-agent、pi-tasks、remote-bridge、desk-link 四个单元都是这样安装的。
- **一个决定一种载体。** drop-in 只用于临时覆盖，用完删除；长期配置写进 env 文件。systemd 的合并顺序是"后写覆盖先写"，所以 drop-in 会静默覆盖 `EnvironmentFile=` 的值，二者只能有一个声明同一个变量。
- **前缀冻结。** 新变量一律 `ODESK_`；存量 `ODK_` 保留在清单里，不再扩增。

## Inventory

`层` 里的"敏感"表示它是凭据本体或凭据路径，只允许出现在 `0600` 文件里，不得写进 unit、代码或日志。
`消费者` 列出真实读取该变量的文件；标记为"外部消费者"的表示该文件不在本仓库的运行时路径里（例如手工启动的工具），其含义在该行说明中给出。

| 变量 | 层 | 声明者 | 消费者 | 默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |

| `DISPLAY` | 环境 | 图形会话 | runtime/linux/src/main.js | — | 由图形会话导入用户 systemd 环境 |
| `FUTU_HOST` | 外部工具 | 外部消费者 integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 10.10.0.195 | 富途网关地址 |
| `FUTU_INTERVAL` | 外部工具 | 外部消费者 integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 60 | 轮询间隔秒 |
| `FUTU_PORT` | 外部工具 | 外部消费者 integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 11111 | 富途网关端口 |
| `FUTU_RSA_FILE` | 外部工具（敏感） | 外部消费者 integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | — | 网关 RSA 私钥副本路径 |
| `FUTU_TRADE_PWD` | 外部工具（敏感） | 外部消费者 integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | — | 交易解锁口令 |
| `HOME` | 环境 | 登录会话 | runtime/linux/src/opencode-go.js, runtime/linux/scripts/open-deskos-plugin-cli.js | — | 定位设备本地配置与凭据 |
| `LIBGL_ALWAYS_SOFTWARE` | 环境 | 运维 | runtime/linux/src/main.js | — | 强制软件渲染，诊断用 |
| `ODESK_APPS_CONTROL_SOCKET` | 测试 | 测试进程 | integrations/voice-agent/src/capabilities.mjs | 运行时目录下的 app 控制 socket | 仅测试覆盖，生产用默认值 |
| `ODESK_CAMERA_DEVICE` | L3 设备本地 | 运维 | runtime/linux/src/camera-source.js | — | 相机设备覆盖 |
| `ODESK_DESK_LINK_SOCKET` | 内部 | Shell | runtime/linux/src/desk-link-client.js | 运行时目录下的 desk link socket | Shell 到本机 desk link 服务的 socket 覆盖 |
| `ODESK_DISABLED_PLUGINS` | L3 设备本地 | 运维 | runtime/linux/src/main.js | — | 禁用插件列表 |
| `ODESK_DISABLE_GPU` | L3 设备本地 | 运维 | runtime/linux/src/main.js | — | 关闭 GPU 加速 |
| `ODESK_FUTU_SOCKET` | L3 设备本地 | runtime.env（绑定方声明） | runtime/linux/src/main.js, integrations/futu-poller/poller.py | — | futu-poller 与本机 Shell 共用的绝对 socket 路径 |
| `ODESK_GPU_BACKEND` | L3 设备本地 | 运维 | runtime/linux/src/main.js | 自动探测 | GPU 后端选择 |
| `ODESK_REMOTE_BRIDGE_SOCKET` | 内部 | Shell | runtime/linux/src/remote-bridge-client.js | 运行时目录下的 remote bridge socket | 同上，Remote Bridge |
| `ODESK_SHELL_HEIGHT` | 测试 | smoke/验收 | runtime/linux/src/main.js | — | 覆盖窗口高度 |
| `ODESK_SHELL_KIOSK` | 测试 | 验收 | runtime/linux/src/main.js | — | kiosk 模式开关 |
| `ODESK_SHELL_TEST_MODE` | 测试 | 测试进程 | runtime/linux/src/desk-link-client.js, runtime/linux/src/remote-bridge-client.js | — | 客户端测试模式 |
| `ODESK_SHELL_WIDTH` | 测试 | smoke/验收 | runtime/linux/src/main.js | — | 覆盖窗口宽度 |
| `ODESK_SKIP_GPU_USERSPACE` | L2 安装期 | 安装者临时设置 | runtime/linux/scripts/cm5-install.sh | 0 | 跳过 Mali 用户态安装 |
| `ODESK_SMOKE_RESULT_FILE` | 测试 | smoke 运行 | runtime/linux/src/main.js | — | smoke 结果输出文件 |
| `ODESK_TASK_CONFIG` | L2 安装期 | pi-tasks unit | integrations/voice-agent/src/task-store.mjs | %h/.config/open-deskos/pi-tasks.json | Hosted Pi daemon 私有配置路径：只有 daemon 读它，属主与权限也只校验一次；客户端读它发布的端点描述符 |
| `ODESK_TASK_TARGETS_FILE` | L3 设备本地 | voice unit 环境或 drop-in | integrations/voice-agent/src/task-client.mjs | 未配置 | voice 侧目标清单；未配置即报告需要配置 |
| `ODESK_VOICE_AGENT_CONFIG` | L3 设备本地（敏感） | voice-agent.env | integrations/voice-agent/src/personal-config.mjs | coding profile | 个人 profile 与技能/凭据路径清单 |
| `ODESK_VOICE_AUDIO_DEVICE` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | default | ALSA 采集设备 |
| `ODESK_VOICE_CAPABILITIES` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | 空 | 受信能力模块路径列表 |
| `ODESK_VOICE_MODEL` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | — | Pi provider/id 模型选择 |
| `ODESK_VOICE_STT_KEY_FILE` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | 未配置 | 仅非设备本地端点需要 |
| `ODESK_VOICE_STT_LANGUAGE` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | zh | 两或三位小写语言码 |
| `ODESK_VOICE_STT_MODEL` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | whisper-1 | 设备本地端点忽略该值，无需设置 |
| `ODESK_VOICE_STT_PROMPT` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | 内置中文上下文 | 上限 1024 字符，空值禁用 |
| `ODESK_VOICE_STT_URL` | L3 设备本地 | voice-agent.env | integrations/voice-agent/src/main.mjs | 云端 OpenAI 端点 | 显式端点；未设置时由 ODK_STT_PORT 推导 loopback 端点 |
| `ODESK_WORKSPACE` | L3 设备本地 | runtime.env | runtime/linux/src/main.js, runtime/linux/src/user-app-system.js, integrations/voice-agent/src/main.mjs | — | Shell 与 Voice Agent 共享的可写 checkout |
| `ODK_CANDIDATE_RELEASE` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | 本事务要激活的候选 release 绝对路径 |
| `ODK_CLIPROXY_MANAGEMENT_KEY` | L3 设备本地（敏感） | runtime.env | runtime/linux/src/opencode-go.js | — | 管理密钥本体；优选文件形式 |
| `ODK_CLIPROXY_MANAGEMENT_KEY_FILE` | L3 设备本地 | runtime.env | runtime/linux/src/opencode-go.js | — | 管理密钥文件路径 |
| `ODK_CLIPROXY_URL` | L3 设备本地 | runtime.env | runtime/linux/src/opencode-go.js | — | CLIProxyAPI 管理端点；端口须与隧道转发一致 |
| `ODK_CM5_TARGET` | L2 开发机 | cm5-stage-release.sh | runtime/linux/scripts/cm5-stage-release.sh | cm5 | ssh 目标别名 |
| `ODK_DESK_LINK_BIND` | L3 设备本地 | runtime.env | runtime/linux/src/desk-link-service.js | — | 监听地址覆盖 |
| `ODK_DESK_LINK_CONTROL_CREDENTIAL` | L3 设备本地（敏感） | runtime.env | runtime/linux/scripts/desk-link-service.js | 未配置 | Desk Link 控制凭据；未配置即只上报 |
| `ODK_DESK_LINK_PORT` | L3 设备本地 | runtime.env | runtime/linux/scripts/desk-link-service.js | 8765 | 监听端口；Console 侧须一致 |
| `ODK_DESK_LINK_SOCKET` | L3 设备本地 | runtime.env | runtime/linux/scripts/desk-link-service.js | 运行时目录下默认 | desk link 服务自身的 IPC socket |
| `ODK_DESK_LINK_TOKEN` | L3 设备本地（敏感，过渡） | runtime.env | runtime/linux/scripts/desk-link-service.js | 未配置 | Desk Link 上报令牌的环境变量形式：可被同一用户的进程环境读到，请改用 `ODK_DESK_LINK_TOKEN_FILE`；两者同时设置时以文件为准 |
| `ODK_DESK_LINK_TOKEN_FILE` | L3 设备本地（敏感） | runtime.env | runtime/linux/scripts/desk-link-service.js | 未配置 | Desk Link 上报令牌文件（0600）：推荐载体，与 Console 侧的令牌值相同 |
| `ODK_HOSTED_PI_SOCKET` | 测试 | 测试进程 | runtime/linux/src/desk-link-host-adapter.js | 从 endpoint.json 读取 | 隔离运行/测试用的显式 socket 覆盖；生产走 daemon 发布的端点描述符 |
| `ODK_HYDRA_MQTT_TOPIC` | L3 设备本地 | shell drop-in | runtime/linux/src/main.js | — | Hydra 主题前缀 |
| `ODK_HYDRA_MQTT_URL` | L3 设备本地 | shell drop-in | runtime/linux/src/main.js | — | Hydra MQTT 端点 |
| `ODK_KIOSK_BIN_DIR` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | 注入 corepack/pnpm 垫片的目录 |
| `ODK_KIOSK_DISPLAY` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | 图形会话 DISPLAY，用于激活后 smoke |
| `ODK_KIOSK_HOME` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | kiosk 家目录 |
| `ODK_KIOSK_NODE_BIN` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | kiosk 会话使用的 node 目录 |
| `ODK_KIOSK_UID` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | kiosk 用户 uid |
| `ODK_KIOSK_USER` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/migrate-runtime.js, runtime/linux/scripts/update-runtime.js | — | 运行桌面会话的 kiosk 用户 |
| `ODK_KIOSK_XAUTHORITY` | L2 安装期 | cm5-install.sh → update-runtime.js | runtime/linux/scripts/update-runtime.js | — | 同上，XAUTHORITY |
| `ODK_MODEL_FSTAB` | L3 设备本地 | SSD 迁移脚本 | runtime/linux/scripts/cm5-migrate-models-to-ssd.sh | /etc/fstab | fstab 路径 |
| `ODK_MODEL_MIGRATION_LIBRARY` | L3 设备本地 | SSD 迁移脚本 | runtime/linux/scripts/cm5-migrate-models-to-ssd.sh | — | 迁移库路径 |
| `ODK_MODEL_SSD_MOUNT` | L3 设备本地 | SSD 迁移脚本 | runtime/linux/scripts/cm5-migrate-models-to-ssd.sh | — | SSD 挂载点 |
| `ODK_MODEL_SSD_ROOT` | L3 设备本地 | SSD 迁移脚本 | runtime/linux/scripts/cm5-migrate-models-to-ssd.sh | — | SSD 上模型存储根 |
| `ODK_PI_SSH_COLLECTOR` | L3 设备本地 | shell drop-in | runtime/linux/src/pi-sessions-source.js | — | 该主机上的采集脚本绝对路径 |
| `ODK_PI_SSH_HOST` | L3 设备本地 | shell drop-in | runtime/linux/src/pi-sessions-source.js | — | Pi Sessions 远程采集主机 |
| `ODK_PI_SSH_NODE` | L3 设备本地 | shell drop-in | runtime/linux/src/pi-sessions-source.js | — | 该主机上的 node 绝对路径 |
| `ODK_RUNTIME_ROOT` | L2 安装期 | cm5-install.sh | runtime/linux/src/user-app-context.js, runtime/linux/scripts/cm5-acceptance.sh, runtime/linux/scripts/cm5-install.sh, runtime/linux/scripts/cm5-stage-release.sh, runtime/linux/scripts/migrate-runtime.js, runtime/linux/scripts/start-kiosk.sh, runtime/linux/scripts/update-runtime.js | /opt/open-deskos | release 与 state 的根 |
| `ODK_STAGING_ID` | L2 开发机 | cm5-stage-release.sh | runtime/linux/scripts/cm5-stage-release.sh | 时间戳-$-随机 | 隔离暂存目录标识 |
| `ODK_STT_PORT` | L3 设备本地 | stt-bridge unit（runtime.env 可覆盖） | integrations/local-stt-bridge/scripts/provision-stt-bridge.sh, integrations/voice-agent/src/main.mjs | 17840 | 设备本地 STT 端口：唯一声明，voice 由此推导端点 |
| `ODK_WEATHER_LAT` | L3 设备本地 | runtime.env | runtime/linux/src/weather-source.js | — | 天气仪器纬度 |
| `ODK_WEATHER_LON` | L3 设备本地 | runtime.env | runtime/linux/src/weather-source.js | — | 天气仪器经度 |
| `ODK_WEATHER_PLACE` | L3 设备本地 | runtime.env | runtime/linux/src/weather-source.js | — | 天气仪器地点名 |
| `OPEN_DESKOS_CONFIG_DIR` | L3 设备本地 | 插件 CLI | runtime/linux/scripts/open-deskos-plugin-cli.js | ~/.config/open-deskos | 插件 CLI 配置目录 |
| `PATH` | 环境 | unit / 安装器 | runtime/linux/scripts/cm5-install.sh | — | 单元固定 kiosk 会话的 node 与垫片目录，不走交互式版本管理者的 PATH |
| `PI_AGENT_DIR` | 环境 | Pi 运行时 | runtime/linux/src/pi-sessions.js | ~/.pi/agent | Pi 会话与认证目录 |
| `ODESK_FUTU_SERVICE_REVISION` | L3 设备本地 | runtime.env | runtime/linux/src/main.js, integrations/futu-poller/poller.py | dev | 富途服务修订号：握手与预期都用这一处声明 |
| `SERVICE_ID` | 外部工具 | 外部消费者 integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | futu-poller | 服务身份；Shell 侧的注册键是同一协议身份 |
| `WAYLAND_DISPLAY` | 环境 | 图形会话 | runtime/linux/src/main.js | — | Wayland 会话时用于 ozone 平台提示 |
| `WEREAD_API_KEY` | L3 设备本地（敏感） | runtime.env | runtime/linux/src/weread-source.js | — | 微信读书同步凭据 |
| `XDG_RUNTIME_DIR` | 环境 | 登录会话 | runtime/linux/src/desk-link-client.js, runtime/linux/src/main.js, runtime/linux/src/remote-bridge-client.js, runtime/linux/src/user-app-system.js, runtime/linux/src/voice-agent-client.js, runtime/linux/scripts/desk-link-service.js, integrations/remote-bridge/lib/remote-bridge.js, integrations/voice-agent/src/capabilities.mjs, integrations/voice-agent/src/main.mjs | — | IPC socket 与运行时目录的根 |
| `XDG_STATE_HOME` | 环境 | 登录会话 | runtime/linux/src/main.js, runtime/linux/src/user-app-system.js, integrations/voice-agent/src/main.mjs | ~/.local/state | 持久状态目录 |