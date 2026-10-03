# Windows Shell Host 运行手册

64 位 Windows（Windows 10/11 x64）是 Display Shell 的第二个 Shell Host。CM5（Linux arm64）仍是参考宿主；Windows on ARM 不在支持范围内。决策见 [ADR-0023](adr/0023-windows-x64-is-a-supported-shell-host.md)，行为场景见 [tests/features/windows-shell-host.feature](../tests/features/windows-shell-host.feature)。

## 需要什么

| 依赖 | 用途 | 缺失后果 |
|---|---|---|
| Windows 10/11 x64 | Shell Host | 不在支持范围 |
| Node 22 以上 | Electron 主进程与验收脚本 | 无法启动 |
| pnpm | 安装依赖（`packageManager` 已声明） | 可用 npm 代替 |
| Visual Studio Build Tools（C++ 工作负载）+ Python | 编译可选的原生进程读取模块 | Shell 照常启动，会话工作目录显示未知 |

不需要 bash、WSL 或 Git Bash：启动与验收都有不用 shell 的入口。

## 安装与启动

```powershell
cd runtime\linux
pnpm install
pnpm start                 # 等价于 unocss 构建 + electron .
pwsh -File run.ps1         # 读取 .env.local，可选 kiosk
pwsh -File run.ps1 -Kiosk  # 无边框全屏，ODESK_SHELL_KIOSK=1
```

默认内容尺寸仍是 CM5 的 1920×1280。屏幕不同就用既有变量覆盖，布局会响应窗口尺寸：

```powershell
$env:ODESK_SHELL_WIDTH = '1280'; $env:ODESK_SHELL_HEIGHT = '800'; pwsh -File run.ps1
```

`.env.local` 与 CM5 上同一格式（每行 `KEY=VALUE`，`#` 注释），不进入版本库与发布产物。

## 可选：原生进程读取模块

Pi Sessions 需要进程表，而“工作目录”这一列在 Windows 上只能从目标进程的 PEB 里读。原生模块一次拿全 pid、父 pid、可执行名、启动时间、命令行与工作目录。

```powershell
pnpm run build:native
# 产物：native\odk-process\build\Release\odk_process.node
```

- 非 Windows 宿主上这个命令是 no-op 并说明原因。
- 按 Electron 的 ABI 编译（`--runtime=electron --target=<electron 版本> --dist-url=electronjs.org/headers`），因为加载它的是 Electron 主进程。
- 构建失败**不会**阻止 Shell 启动：Shell 回退到托管进程表读取，并在启动日志里用一行说明，会话工作目录如实显示未知。
- 构建成功后脚本会在 Electron 自己的 Node 里加载一次产物（`ELECTRON_RUN_AS_NODE=1`）：编译成功不等于能加载。Windows 上原生模块需要的符号由 `electron.exe` 导出而不是 `node.dll`，缺少延迟加载钩子的模块会编译通过、然后以 `Module did not self-register` 报错。`binding.gyp` 因此把 `win_delay_load_hook` 显式设为 `true`；加载检查失败时先看这个变量。
- `build/` 被 Git 忽略，发布工具链也不搬运它，所以每台 Windows 宿主安装后自己编译一次。

## 验收

```powershell
node tests\smoke.mjs        # 等价 tests/smoke.sh 的关键检查，不需要 bash
node --test tests\*.test.js # Node 契约测试
pnpm run build:native       # 可选：再确认原生模块能编译
```

`tests/smoke.sh` 现在只是 `tests/smoke.mjs` 的 CM5 包装，两者规则同一份。窗口检查需要图形会话；没有会话时它会如实报失败而不是跳过。

## 这个宿主上如实不可用的能力

这些是真实的缺口，不是隐藏的降级：界面上报 unavailable / disconnected，绝不假装本地或模拟。

| 能力 | Windows 宿主状态 |
|---|---|
| Remote Control（Remote Link / Remote Bridge） | 不可用：Unix socket 链路未移植，Windows 上也没有对应服务 |
| 语音 Agent（MIC、转写、录音、回答） | **可用**：同名管道 `\\.\pipe\open-deskos-personal-bot` + 通道令牌认证，采集走 ffmpeg DirectShow（需本机 ffmpeg 与交互式计划任务）；服务未跑时如实报 unavailable |
| Desk Link / Hosted Pi 远程控制 | **可用**：宿主通道监听 TCP（默认 8765，令牌来自 `ODK_DESK_LINK_TOKEN_FILE`），运行时通道绑定为命名管道 `\\.\pipe\open-deskos-desk-link`，由通道令牌认证 |
| Desk Data Link（`desk_data` 读桌面运行数据） | **两端都可用**：Shell 侧监听命名管道 `\\.\pipe\open-deskos-desk-data`（通道令牌认证），语音 Agent 侧按主机解析同一端点名并出示该主机令牌，因此语音/文字都能读到 Widget 的实时读数（2026-09-30 实机验证） |
| 外部应用控制端点 | **两端都可用**：Shell 侧创建命名管道 `\\.\pipe\open-deskos-user-app-control`（通道令牌认证），语音 Agent 侧按主机解析同一端点名并出示该主机令牌，因此 `user_apps_*` 工具在这台机器上真的能用（2026-09-30 实机验证）。Shell 内的 Widget/App 安装、更新、回退、卸载不受影响 |
| P4 摄像头 tile | 如实报 unavailable：`v4l2-ctl` 与 `/dev/open-deskos-p4-camera` 在 Windows 上不存在，代码无需改动 |
| Futu 监控（Service Plugin） | **可用**：桌面监听 `ODK_FUTU_ENDPOINT`，可为 socket 路径、命名管道或 `tcp://host:port`。插件在别的机器上时用网络形式，并必须出示本机的通道令牌（见下） |
| CM5 硬件验收（Mali GPU、HDMI 时序、触摸） | 不适用 |

逻辑端点名称仍由平台层定义（Windows 上是 `\\.\pipe\<name>` 命名管道），所以将来移植某条链路时不需要重新决定传输方式。

## 运行时通道与通道令牌

运行时通道是 Shell 与它自己那些服务之间的本地连接（Desk Link 运行时通道、外部应用控制端点）。

- **POSIX**：认证靠文件系统属主——socket 位于只有属主能进入的目录内，模式 `0600`。属主检查、目录模式、`uid` 校验、以及“该路径上不是本用户的 socket 就拒绝删除”都保持不变。
- **Windows**：命名管道没有属主、模式或 `uid`，Node 也无法给管道设置安全描述符，所以由**通道令牌**认证：一个 32 字节随机值，保存在 `%LOCALAPPDATA%\open-deskos\local-channel.token`，首次使用时自动创建，仅本用户可读。它作为连接的第一行发送并在常数时间内比对，握手会在通道自己的协议读到任何字节之前被消费掉。
- 属主能认证的地方，属主仍是关卡，令牌是第二层；早于令牌存在的客户端仍能逐字节送达协议（因为不会给它发握手）。属主无法认证的地方（命名管道、任何 win32 端点），**没有合法令牌的连接在到达协议前就被关闭**。
- 决定与取舍见 @docs/adr/0025-a-runtime-channel-is-authenticated-by-ownership-or-a-token.md。诚实提醒：Windows 上的管理员（或 Unix 上的 `root`）能读到令牌文件，这与他们本来就有的进程权限一致。

### 在 Windows 上跑 Desk Link 服务

`.env.local` 里需要（`run.ps1` 之外的入口请自行加载该文件）：

| 键 | 含义 |
|---|---|
| `ODK_DESK_LINK_TOKEN_FILE` | 宿主令牌文件（`host:port` 通道的共享密钥），绝对路径 |
| `ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE` | 控制凭据文件；留空即“只上报”的 desk，服务会如实记一行说明 |
| `ODK_DESK_LINK_PORT` | 宿主通道端口，默认 8765 |

服务用与 kiosk 相同的模式常驻：登录触发 + 重启循环（systemd `Restart=always` 的对应物），任务里的 wrapper 先加载 `.env.local` 再 `node scripts/desk-link-service.js`。首次运行要在提权会话里放通入站端口：

```powershell
New-NetFirewallRule -DisplayName 'Open DeskOS Desk Link' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -Profile Any
```

验证（服务已在运行时，用一个客户端读一次快照）：

```powershell
node -e "require('./src/desk-link-client').createDeskLinkClient().snapshot().then(s => console.log(s.ok, (s.sessions||[]).length))"
```

这条命令在 Windows 上走的就是那个命名管道 + 令牌握手；`ok true` 表示握手被接受、协议被送达。

### 服务插件（Futu）在 Windows 上

Service Plugin 的契约是“**插件连上桌面并推送**”（ADR-0009），所以 Windows 上要做的只是把端点换成这里存在的传输（ADR-0026）：

```ini
# .env.local：本机监听在哪里。同一份 app 声明的端点因此不分 Win/Linux。
ODK_FUTU_ENDPOINT=tcp://100.82.50.70:8790
ODESK_FUTU_SERVICE_REVISION=dev
```

```powershell
# 入站放通（提权会话，一次即可）
New-NetFirewallRule -DisplayName 'Open DeskOS Futu Plugin' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8790 -Profile Any
```

要点：

- **令牌是关卡**：命名管道与 TCP 端点没有属主可认证，插件必须出示本机的通道令牌（`%LOCALAPPDATA%\open-deskos\local-channel.token`），并作为连接的**第一行**发送（`{"v":1,"token":"…"}\n`，见 ADR-0025）。本机的令牌只给要推送的插件所在机器，用 `0600` 文件携带，**不要**写进命令行。
- **socket 路径端点不需要令牌**：Unix 主机上属主已经完成认证，所以参考宿主上那个早于令牌存在的 poller **不受影响**，仍可无握手接入。
- **一台插件可喂多台 desk**：目标列表由插件自己声明（远程 desk 的端点不可能从 desk 的配置里读到），某台不可达不影响其他台。
- **凭据不上桌**：网关 RSA 与交易口令留在已经持有它们的机器上；桌面只是数据接收方。
- 自检（在设备上就能跑，不打印令牌）：

```powershell
node -e "const n=require('node:net');const fs=require('node:fs');const t=fs.readFileSync(process.env.LOCALAPPDATA+'\\open-deskos\\local-channel.token','utf8').trim();const s=n.connect(8790,'100.82.50.70',()=>{s.write(JSON.stringify({v:1,token:t})+'\n');s.write(JSON.stringify({v:1,type:'hello',service:'futu-poller',revision:'dev',proto:1})+'\n')});s.on('data',(d)=>{console.log('ack: '+d.toString().trim());s.end()})"
```

看到 `ack: {"v":1,...,"ok":true}` 就说明令牌被接受、协议被送达。

## 在 Windows 上跑语音 Agent（Personal Bot）

语音 Agent 通过两条独立的运行时通道接触 Shell：`desk-data`（读桌面 Widget 的运行数据）与 `user-app-control`（应用生命周期）。两条都按主机解析端点——Windows 是 `\\.\pipe\open-deskos-<link>` 命名管道并出示 `%LOCALAPPDATA%\open-deskos\local-channel.token`，Unix 是运行时目录里的 socket——所以 Windows 上不需要任何 `ODESK_*_SOCKET` 覆盖。覆盖仍然保留，仅用于测试。

语音 Agent 是桌面运行时的常驻组件，所以 64 位 Windows 也跑**同一个** `integrations/personal-bot`，只有两处按宿主不同：采集走 ffmpeg 的 DirectShow（不是 ALSA），链路绑定成主机接缝里已经声明的 `\\.\pipe\open-deskos-personal-bot`。管道没有属主可认证，因此连接由 `%LOCALAPPDATA%\open-deskos\local-channel.token` 里的通道令牌把门，并且在语音协议读到任何字节之前就被消费（见 ADR-0025）。

设备本地配置与 CM5 是同一份格式的两个文件：`%LOCALAPPDATA%\open-deskos\runtime.env`（与桌面共享的 `ODESK_WORKSPACE`）和 `personal-bot.env`（转写 provider、模型、`ALIYUNCS_TOKEN`）。云端转写声明成 provider 而不是从 URL 推断：

```ini
# %LOCALAPPDATA%\open-deskos\personal-bot.env
ODESK_PERSONAL_BOT_STT_PROVIDER=aliyun
ODESK_PERSONAL_BOT_STT_MODEL=qwen3-asr-flash
# 未设置 URL 时用 DashScope 官方端点；指向 MaaS 网关就写它的完整多模态端点
ODESK_PERSONAL_BOT_STT_URL=https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation
ALIYUNCS_TOKEN=<本机自己的设备本地值>
# Windows 上必须是 DirectShow 设备名本身（ffmpeg 会自己加 audio= 前缀），Unix 的 default 在这里没有意义
ODESK_PERSONAL_BOT_AUDIO_DEVICE=麦克风 (Realtek High Definition Audio)
```

```powershell
# 只报缺什么，不安装也不注册
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1 -Report
# 装 ffmpeg（仅在 -InstallFfmpeg 时）、注册交互式计划任务并启动
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1 -InstallFfmpeg -Start
```

服务跑在已登录的交互会话里：**session 0 没有音频端点**，所以它是带重启循环的交互式计划任务（`scripts\windows-personal-bot.ps1`，对应 unit 的 `Restart=on-failure`），而不是 Windows 服务。日志在 `%LOCALAPPDATA%\open-deskos\personal-bot.log`。注册必须从 SSH 或登录会话发起：计划任务自身不能再注册任务。

验收（走发布出去的协议，不打印任何凭据）：

```powershell
node scripts\personal-bot-acceptance.mjs            # toggle 一次，报告状态序列、transcript 和回答
node scripts\personal-bot-acceptance.mjs --status   # 只读当前状态
```

如实的边界：服务没跑时语音面报 unavailable（不是本地或模拟）；ffmpeg 缺失时报麦克风不可用；DirectShow 设备名写错或设备不存在时 ffmpeg 会在收到任何采样前退出，同样报“麦克风不可用”而不是伪造一段录音（ffmpeg 自己的 stderr 不进入状态，ffmpeg 在 PATH 上但设备名错才是这类报错的真正原因）；语音回答需要**本机自己的** Pi 模型认证（`~\.pi\agent\models.json`），桌面只读远程会话、不代替 Pi 登录。

### Desk Link 服务在这台机器上

上报别的机器上的 Pi session、并在桌面侧读到它们的事件，靠的是 Desk Link 服务；它和语音服务一样是常驻进程，在 Windows 上就是一个交互式计划任务（`OdkDeskLink`，带重启循环，脚本 `scripts\provision-desk-link.ps1` / `scripts\windows-desk-link.ps1`）。SSH 会话（session 0）不需要桌面，但常驻服务要在已登录的会话里，所以用计划任务而不是 Windows 服务。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-desk-link.ps1 -Report   # 只报缺什么
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-desk-link.ps1 -Start   # 注册并启动
```

- 它读 `runtime\linux\.env.local`（与桌面同一份），需要 `ODK_DESK_LINK_TOKEN_FILE`（上报凭据）指向一个非空文件。
- `ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE` 为空不是故障，而是"本桌只接受上报"：别的机器无法指挥本桌托管的 Hosted Pi。`provision-personal-bot.ps1 -Report` 同理会把这句讲出来。
- 服务只把服务进程自己写的说明记进 `%LOCALAPPDATA%\open-deskos\desk-link.log`；PowerShell 会把原生死输出当成错误记录，所以启动器必须把这一层与真正的崩溃分开，否则一行说明就能把重启循环打断。

## 状态与配置位置

| 内容 | Windows 位置 |
|---|---|
| 已安装 Widget/App 与状态 | `%LOCALAPPDATA%\open-deskos\` |
| Pi 会话与认证 | `~\.pi\agent`（`PI_AGENT_DIR` 可覆盖） |
| 设备本地配置 | `runtime\linux\.env.local`，或用户环境变量 |

### 设备本地凭据（`.env.local`，已被 `.gitignore` 忽略）

任何 Windows 宿主只需要自己那几把钥匙；下面每一条都是在真机上验过的。

| 键 | 用途 | 来源 |
|---|---|---|
| `WEREAD_API_KEY` | 微信读书同步凭据 | 与参考宿主**同一把**（CM5 的 release 本地 `.env.local`）；掌机实测 `status live` 且桌面自己写出了缓存 |
| `ALIYUNCS_TOKEN` | 语音 Agent 的云端转写凭据（`ODESK_PERSONAL_BOT_STT_PROVIDER=aliyun`） | 本机**自己的**设备本地值，写在 `%LOCALAPPDATA%\open-deskos\personal-bot.env`，不进 `.env.local`、不进命令行 |
| `ODK_HYDRA_MQTT_URL` | 浇水 MQTT 端点 | 设备本地（NAS 地址，不含凭据） |
| `ODK_WEATHER_LAT/LON/PLACE` | 固定位置天气 | 可选：**不设**时改用设备定位（掌机即如此，会自动跟随城市） |
| `ODK_LOCATION_URL` | 定位端点覆盖 | 默认 `https://ipwho.is/`，无密钥 |
| `ODK_CLIPROXY_URL` + `ODK_CLIPROXY_MANAGEMENT_KEY_FILE` | OpenCode Go 用量 | 本机**自己的** SSH 隧道（授权到 NAS 且只给转发）+ 管理密钥文件 |
| `ODK_DESK_LINK_TOKEN_FILE` / `ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE` | Desk Link 宿主令牌 / 控制凭据 | 本机**自己的**令牌（首次使用自动生成）；留空即只上报 |
| `ODK_PI_SSH_HOST/NODE/COLLECTOR` | 远程 Pi 会话采集 | 本机**自己的** SSH 身份（对方的 authorized_keys 里按命令限制） |

刻意**不放**在 Windows 宿主上，以及原因：

| 内容 | 为何不放 |
|---|---|
| Futu 网关 RSA 私钥与交易口令 | 掌机还没有 Futu poller 实例；且交易口令按约定只由你自己处理 |
| 语音 agent 的个人配置（`personal-bot.json`）与 DiDi key | personal profile 里的 `didi` 能力仍未移植到 Windows；`coding` profile（默认）不需要它，所以语音 Agent 本身可以跑 |
| 语音 Agent 用的 Pi 模型凭据 | 语音 Agent 在**本机**跑自己的 Pi session，因此本机需要自己的模型认证（`~\.pi\agent\models.json` 指向 OpenAI 兼容服务）。这与“桌面不代替 Pi agent 登录任何账号”不矛盾：桌面只读远程会话，语音 Agent 是另一个常驻组件 |
| 参考宿主的 Desk Link 令牌与控制凭据 | 每个 desk 拥有自己的令牌；掌机没有 hosted Pi 宿主，控制凭据在那儿无事可做（它是只上报的 desk） |
| Pi agent 自己的 `auth.json` | 桌面只**读取**远程 Pi 会话，不代替 Pi agent 登录任何账号 |
| MQTT 凭据 | 局域网 broker 不要求；需要时另说 |
| Shell 日志 | `run.ps1` 前台输出；kiosk 场景请重定向到文件 |

## 真机验证记录（2026-09 于一台 1280×800 掌机）

下面每一条都是在真机上得到的事实，不是推断：

| 事实 | 证据 |
|---|---|
| 显示为 **1280×800 横屏**，缩放 100%，工作区 1280×776 | `screen.getPrimaryDisplay()`：`size 1280x800, workAreaSize 1280x776, scaleFactor 1`（WMI 的 `CurrentHorizontalResolution/CurrentVerticalResolution` 会报 800×1280，是面板原生方向，不可信） |
| 桌面在该设备上按自身尺寸开出窗口 | `node tests/smoke.mjs` → `{"ok":true,"width":1280,"height":776}` |
| 验收与密度门禁均通过 | `ALL SMOKE CHECKS PASSED`；`WIDGET_DENSITY_RESULT {"ok":true,...,"violations":0}` @1280×776 |
| 完整套件通过 | 457 测试 / 436 通过 / **0 失败** / 21 跳过（跳过项在 `tests/not-ported.js` 里逐条说明） |
| 面板几何与“不能拖动”（2026-09-30 复测） | 修之前的运行实例：窗口 `0,0 1280x728`（显示 1280x800、工作区 1280x776），截图里底部露出桌面壁纸与任务栏；`SendInput` 手拖后窗口几何变成 `0,89 1280x639` |
| 修之前是竞态而不是固定状态 | 同一份旧 `main.js` 在 00:45 重启后自己走到了 `0,0 1280x800`，而 11:14 开机那次停在 1280x728；所以“能不能铺满”由开机时序决定，不是配置问题 |
| 修之后的实验窗口（四个不可用选项全 false） | `0,0 1280x800`，手拖后仍是 `0,0 1280x800`，`Win+Down` 无变化，`style=0x14000000`（无 `WS_THICKFRAME`、无 `WS_MAXIMIZEBOX`、无 `WS_MINIMIZEBOX`） |
| 修之后的**已发布模块**在真机（`runtime/linux/src/panel.js`） | 带哈希门控只把这一个文件送到设备（未重启 desk），实验窗口用它的 `resolvePanelBounds` + `KIOSK_WINDOW_LOCK` + `enterPanel`：`created 1280x776` → `after panel 1280x800`，`covers display: true`，手拖与 `Win+Down` 均无变化，截图 1280x800 全屏无任务栏 |
| Windows 的 fullscreen 不是状态而是几何 | 实验里 `setFullScreen(true)` 之后 `isFullScreen()` 始终为 `false`，而 `getBounds()` 变成 `0,0 1280x800`；`setBounds(显示边界)` 单独也能到达同一几何 |
| 新建的 frameless 窗口会被压到工作区 | 以显示边界 1280x800 建窗，`getBounds()` 立刻就是 `0,0 1280x776`（当时的工作区），所以"建得比工作区大"并不能避开最大化 |
| 加入运行时通道与位置定位后仍然通过 | 499 测试 / 472 通过 / **0 失败** / 27 跳过（其中若干条只在 Windows 上执行，所以在 macOS 上看不到它们） |
| 命名管道 + 令牌握手在真机上验证 | `createDeskLinkClient()` 在设备上打印 `endpoint \\.\pipe\open-deskos-desk-link`，`snapshot ok=true`，即握手被消费、desk-link 协议被送达 |
| Desk Link 服务常驻并把端点绑成命名管道 | 服务日志：`desk link service listening on 100.82.50.70:8765`；`Get-NetTCPConnection -LocalPort 8765` 有 Listen；`Test-Path '\\.\pipe\open-deskos-desk-link'` 为 `True`；Mac 侧 `nc -z` 该端口可达 |
| 天气按设备位置定位（该机已移动到武汉） | `createDeviceLocation().resolve()` → `place Wuhan, 30.5833/114.2667`；天气快照 → `place Wuhan, locationSource device, 24°C, status live`。`.env.local` 里的 `ODK_WEATHER_LAT/LON/PLACE` 已移除 |
| 默认定位服务从中国网络可达 | 上一条就是走默认的 `https://ipwho.is/` 得到的；离线或换网时用 `ODK_LOCATION_URL` 覆盖 |
| SSH 会话在 **Session 0**，建不了窗口 | 在 SSH 里跑 Electron 会静默挂住；`node --test` 里 6 个 Electron 验证器用例因此失败 |
| GUI 检查必须放进交互会话 | 用**以当前用户注册的交互式计划任务**跑（`-LogonType Interactive`），见下方的任务片段 |
| 省电会杀死长任务 | 电池供电下掌机挂起并断 Wi-Fi；Task Scheduler 默认“切到电池就停任务” |
| 非提权用户不能建符号链接 | `fs.symlink` → `EPERM`；相关测试在 Windows 上跳过 |
| GitHub 可能被挡（`http=000`），npmmirror 可达 4.6 MB/s | 用镜像下 Electron 二进制，再走 LAN（17 MB/s）送到设备 |
| Electron 二进制可手工放置 | 解包到 `node_modules/electron/dist` 并写 `path.txt`（内容 `electron.exe`），绕过下载器 |
| 重编译原生模块前必须先停 kiosk 循环 | 桌面（Electron）加载了 `odk_process.node`，文件被占用，`node-gyp rebuild` 会在 unlink 阶段报 `EPERM`。而 kiosk 循环会在几秒内把进程拉回来，所以必须停 **`OdkDesk` 任务本身**（只杀进程不够），编译完再启动 |
| 原生进程读取器已构建，且在 Electron 内确实加载 | `node scripts/build-native.mjs` → `build exit=0`，`process reader loaded; rows=207`，构件 `native/odk-process/build/Release/odk_process.node`（N-API，Node 与 Electron 43.7.5 均可用）。样例 `winlogon.exe → cwd C:\WINDOWS\system32\` |
| 加载检查自身曾误报（已修） | 检查原本用 `shell: true` 把 `-e` 脚本交给 `electron.cmd`，Windows 下参数被毁，导致**能用的构件被报成坏的**。现改为写临时探针文件 + 直接调用 `node_modules/electron/dist/electron.exe`，完全避开引号；回归断言 `the Electron load check never passes a script through a command shell` 钉住这一点 |

### 在交互会话里跑 GUI 检查

```powershell
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited   # 裸用户名；USERDOMAIN\USER 在 MSA 账户上映射失败
$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\path\check.ps1'
Register-ScheduledTask -TaskName OdkCheck -Action $action -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName OdkCheck
```

计划任务的 stdout 会被丢弃，脚本里要用 `Start-Transcript` 或写日志文件，再从 SSH 读回来。

**远程脚本要写纯 ASCII**：PowerShell 5.1 读取无 BOM 的 UTF-8 `.ps1` 时会按系统代码页（本机为 GBK）解析，脚本里带中文就会直接语法报错、甚至连日志都不生成。要在脚本里输出中文，请给文件加 UTF-8 BOM；否则用英文。

## 作为面板运行（全屏，但宿主 shell 保持可用）

```powershell
# 在你自己的交互会话里运行（计划任务 -LogonType Interactive），不要从 SSH 会话里跑
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-kiosk.ps1
```

它做两件跨平台启动器不做的事：外壳退出后 3 秒重启（对齐 CM5 的 `scripts/start-kiosk.sh`）；把每次启动与外壳输出写进 `%LOCALAPPDATA%\open-deskos\kiosk.log`，不弹控制台窗口。

**它刻意不隐藏任务栏。** 这是一台会跑其它应用的机器：Desk 只在它是活动窗口时铺满屏幕（Windows 自己会把任务栏让开），切到别的窗口时那个窗口与任务栏就回来了。隐藏 shell 会让其它应用变得不可达。因此 Desk 也**不置顶**。只有在参考宿主上（没有其它窗口可切）才会进 kiosk 模式。

**面板铺满的是屏幕，不是工作区。** Windows 上 Electron 的 fullscreen 对无边框窗口不是一个状态：实测 `setFullScreen(true)` 之后 `isFullScreen()` 仍然是 `false`，只是把窗口挪到了屏幕尺寸。所以桌面上"全屏"就是几何。几何在窗口 show 之后才施加，并且**被检查、被重试**：

- 登录那一刻，fullscreen 请求可能被整个丢掉（实测：重启后的面板停在 1280x728，屏幕 1280x800、工作区 1280x776，底下就是那条桌面缝）；
- 因此面板每次都同时要两样：fullscreen 请求，和“把窗口放到显示边界”的 `setBounds`；
- 窗口没盖住显示边界就继续要（每 400 ms 一次，最多 8 次），盖住就停。

重试本身由 `tests/kiosk-panel.test.js` 行为级覆盖，顺序与“不置顶、不隐藏任务栏”由 `tests/kiosk-window-order.test.js` 钉住；实现都在 `src/panel.js`，`src/main.js` 只负责接线。

**面板不是用户能拖动的窗口。** kiosk 窗口建出来时就声明不可移动、不可缩放、不可最大化、不可最小化：实测这样一来宿主窗口不带 `WS_THICKFRAME` 和两个 box 按钮，手拖不动，`Win+Down` 也不再把它最小化（不声明时 `Win+Down` 会把它最小化到 -32000）。

在真机上核验这两点（都要交互会话，见下节“在交互会话里跑 GUI 检查”）：

```powershell
# 面板几何：应当是 0,0 1280x800（= 显示边界），不是工作区高度
Add-Type -Namespace Odk -Name W -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT { public int L, T, R, B; }
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr h, out RECT r);
'@
$h = (Get-Process electron | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).MainWindowHandle
$r = New-Object Odk.W+RECT; [void][Odk.W]::GetWindowRect($h, [ref]$r)
"panel {0},{1} {2}x{3}" -f $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)
```

拖动与最小化那一半用 `SendInput` 从同一个交互会话里试，截图用 `Graphics.CopyFromScreen` 取全屏 PNG 再 scp 回来读。

停止面板：

```powershell
Stop-ScheduledTask -TaskName OdkDesk
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process
```

注意：**计划任务自身不能再注册任务**（Windows 用受限令牌阻止这种链式持久化，会报“拒绝访问”）。要用任务包装的脚本里不要调 `Register-ScheduledTask`/`schtasks /Create`；从你的登录会话（或 SSH）里注册。

## 从另一台机器同步改动到这台设备（带哈希门控）

开发机的分支才是权威：这台设备上跑的是它的开发副本，所以“同步”不是 `scp` 一次就完事，而是**每个文件都要等于分支上的那个文件**。这一段记录已经被这个门挡下过的两类事故：把包解在子目录里、留下一棵 `runtime\runtime\…` 树而 desk 仍在读旧文件；以及设备上留着上一个 commit 的混合状态。

流程（仓库根为打包根）：

1. 在开发机按**仓库根相对路径**打 tar：`tar czf change.tgz runtime/linux/src/…`（不要 `cd` 进子目录再打）。
2. 同一条 `md5 -q` 逐文件生成期望清单 `change.hashes`，格式 `<md5> <仓库根相对路径>`，一行一个，覆盖 tar 里的**每一个**文件。
3. `scp` 两个文件到 `C:\Users\<user>\`。
4. 设备上一个纯 ASCII 的 `.ps1` 调部署脚本：按 `ODESK_WORKSPACE`（仓库根）解包、逐文件比 MD5、任一不符就报失败、最后重建样式并重启 desk。只有全部相等才输出 `DEPLOY_OK`。
5. 从 SSH 注册并启动一个交互计划任务来跑它（见上节；**任务自身不能再注册任务**），用**本次运行独有的**结束标记去轮询日志，**再把日志 scp 回来读**。

只在这一步实测过的三个陷阱：

- **PowerShell 5.1 的 `Join-Path` 是拼接，不是解析**：传绝对路径会得到 `C:\Users\xC:\Users\x\file`。给部署脚本的必须是**相对名**。
- **ssh 里穿过去的 PowerShell 会被 cmd 吃掉引号与管道符**（`|`、`&`、`>` 都不是你想的那个意思）。要复杂逻辑就写 `.ps1` 上传再执行，不要拼一行命令。
- **轮询日志必须用本次独有的哨兵**：旧日志里也有 `DONE`，读到它会把上一次运行当成这一次。同理，一次运行失败后重跑时，任务可能仍卡在上一次实例里（`schtasks /query` 看状态、必要时 `/end`）。

## Tailscale（从网络外部到达这台设备）

Desk 从网络外部被操作：SSH、传文件、远程作业。Tailscale 是那条路径，所以它是**部署的一部分**，而不是可选件（决策见 [ADR-0024](adr/0024-tailscale-is-provisioned-and-a-host-install-is-reused.md)）。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1            # 缺失才装
powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1 -Report     # 只看状态，永不安装
```

**复用规则（重点）**：宿主机已经装了 Tailscale（`C:\Program Files\Tailscale\tailscale.exe` 存在）就**直接用它自己的**——不覆盖、不代登录、不改它的配置。脚本只在命令缺失时才装，且可重复执行。

安装需要管理员权限（提权会话，或你点一次 UAC），所以它不是外壳启动的一部分；**登录也永远不自动化、不存凭据**：`tailscale up` 会打印一个 URL 让你打开，或用托盘应用。Desk 只如实报状态：`connected` / `needs-login` / `stopped` / 其它，拿不到就说原因。

### SSH 进入这台设备

```sh
# 开发机（Mac）上，通 Tailscale
ssh -i ~/.ssh/id_ed25519 frads@100.82.50.70
ssh -i ~/.ssh/id_ed25519 frads@desktop-qlqd17f.tail27726.ts.net   # MagicDNS 同义
ssh -i ~/.ssh/id_ed25519 frads@192.168.50.225                    # 同一局域网
```

`~/.ssh/config` 里**没有**这台机器的条目：连接一律用上面这些显式参数调用 ✓。

实测事实：

- 登录用户 `frads` 是**管理员**，从 SSH 拿到的是 High integrity，所以注册/启动计划任务要在 SSH 里做（见上节）。
- 授权文件是 `C:\ProgramData\ssh\administrators_authorized_keys`（管理员用户的标准位置），**用户目录下没有** `.ssh\authorized_keys`。改动它需要管理员权限。
- 开发机那把钥匙的公钥指纹：`SHA256:RNMyWZCU294srI7D8Eu5mUeD5KVnttqVKHKxZV5E/+I`（换机器时用它比对）。
- `sshd_config` 里 `PasswordAuthentication` 与 `PubkeyAuthentication` 都还是注释掉的**默认值**，即口令登录仍然开着；端口只在 tailnet 上可见，这是不用口令的唯一理由。要关：
  ```powershell
  Add-Content C:\ProgramData\ssh\sshd_config "`nPasswordAuthentication no"
  Restart-Service sshd     # 会断开现有会话，用新会话验证公钥仍能进
  ```
- 权限的其它边界：不要从 SSH 会话里直接跑 Electron（Session 0 没有交互桌面 ✓），GUI 类工作一律走交互计划任务 ✓。

### 登录与可达性（实机得到的事实）

- **授权 URL 与浏览器所在机器无关**：在另一台能访问身份提供商的机器上打开 `AuthURL`（可从 `tailscale status --json` 读，比 `up` 的 stdout 可靠），入网的是请求登录的那台设备。这对一个登录方式为 Google 而自身网络到达不了 Google 的设备是唯一可行的路。
- **为无法交互登录的宿主关掉密钥过期**（管理后台里该节点的 Disable key expiry）：否则密钥过期后它既掉线、也无法在设备上续期。
- 入网后该设备可从 tailnet 内任意主机以 `<主机名>.<tailnet>.ts.net` 或 `tailscale ip -4` 到达；同一局域网的路依旧可用，两者互不依赖。

## 长任务与掌机省电（远程作业前置）

掌机在电池供电、屏幕熄灭后会挂起并断开 Wi-Fi，长时间的安装或构建会因此中断（已发生过：一次 `pnpm install` 因为没有插电被挂起打断）。远程作业前：**接上电源**，并在“设置 → 系统 → 电源和电池”里把“接通电源后进入睡眠”设为“从不”。不想改设置的话，后台跑一个保持唤醒的进程：

```powershell
Add-Type -Namespace Odk -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
while ($true) { [Odk.Power]::SetThreadExecutionState(0x80000001) | Out-Null; Start-Sleep -Seconds 30 }
```

长步骤一律写成后台任务并把输出写进日志文件，SSH 断了也不影响结果：

```powershell
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "$env:USERPROFILE\step.cmd" -PassThru -NoNewWindow
```

依赖安装可以先用 `--ignore-scripts`：它跳过 Electron 二进制（约 120 MB）的下载，而 Node 套件测试并不需要那个二进制；等要跑窗口类检查时再完整装一次。

## 已知边界

- **工作目录可能未知**：目标进程完整性级别高于 Shell（例如 Pi 以管理员身份运行而 Shell 不是）、受保护进程、或 32 位（WOW64）目标时，读不到就报未知。不会用可执行文件名或命令行去猜。
- **进程表可能被策略拒绝**：原生模块的枚举被拒绝时，Shell 回退到 `powershell.exe` 的托管读取；再失败则如实报没有进程可读，界面不伪造会话。
- **会话存活判定未在本机验证**：存活检查走 `process.kill(pid, 0)`，在 Windows 上对更高完整性级别的 Pi 进程是否仍报存活，需要在你的机器上确认；不成立时该会话会被如实算作已退出。
- **已接受、未修的过度识别（沿用既有规则）**：只要命令行里第一个非选项参数名为 `pi` 的脚本，任何程序都可能被判为 Pi 进程（例如 `notepad.exe C:\tools\pi.js`、`cmd /c "echo pi"`）。这条规则早于 Windows 支持、与 CM5 共用；Windows 侧是继承而不是新发明。识别结果刻意不因是否带重定向而变。后果是极端情况下一个非 Pi 进程可能让它的子会话被判为 worker 而不显示——但那个父进程需要长期存活才会真影响显示，上面这些形态通常是瞬时进程。收紧它需要解释器白名单，会改变 CM5 上的识别结果，本增量只记录、不改。
- **未做**：安装包/便携包、开机自启、Windows 触摸与显示拓扑的真机验收。

## 与 CM5 共用的部分

`src/platform/` 是唯一的平台层：状态目录、逻辑端点命名、可执行名规则、进程来源。Shell 的其余部分——五页桌面、Widget/App 契约、用户应用生命周期、release 工具链——两个宿主共用同一份。