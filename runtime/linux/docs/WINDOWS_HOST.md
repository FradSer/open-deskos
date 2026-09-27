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
| 语音 Agent（Remote MIC、转写、录音） | 不可用：链路与采集（ALSA）均未移植 |
| Desk Link / Hosted Pi 远程控制 | **可用**：宿主通道监听 TCP（默认 8765，令牌来自 `ODK_DESK_LINK_TOKEN_FILE`），运行时通道绑定为命名管道 `\\.\pipe\open-deskos-desk-link`，由通道令牌认证 |
| 外部应用控制端点 | **已创建**：命名管道 `\\.\pipe\open-deskos-user-app-control`，由通道令牌认证。Shell 内的 Widget/App 安装、更新、回退、卸载不受影响 |
| P4 摄像头 tile | 如实报 unavailable：`v4l2-ctl` 与 `/dev/open-deskos-p4-camera` 在 Windows 上不存在，代码无需改动 |
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

## 状态与配置位置

| 内容 | Windows 位置 |
|---|---|
| 已安装 Widget/App 与状态 | `%LOCALAPPDATA%\open-deskos\` |
| Pi 会话与认证 | `~\.pi\agent`（`PI_AGENT_DIR` 可覆盖） |
| 设备本地配置 | `runtime\linux\.env.local`，或用户环境变量 |
| Shell 日志 | `run.ps1` 前台输出；kiosk 场景请重定向到文件 |

## 真机验证记录（2026-09 于一台 1280×800 掌机）

下面每一条都是在真机上得到的事实，不是推断：

| 事实 | 证据 |
|---|---|
| 显示为 **1280×800 横屏**，缩放 100%，工作区 1280×776 | `screen.getPrimaryDisplay()`：`size 1280x800, workAreaSize 1280x776, scaleFactor 1`（WMI 的 `CurrentHorizontalResolution/CurrentVerticalResolution` 会报 800×1280，是面板原生方向，不可信） |
| 桌面在该设备上按自身尺寸开出窗口 | `node tests/smoke.mjs` → `{"ok":true,"width":1280,"height":776}` |
| 验收与密度门禁均通过 | `ALL SMOKE CHECKS PASSED`；`WIDGET_DENSITY_RESULT {"ok":true,...,"violations":0}` @1280×776 |
| 完整套件通过 | 457 测试 / 436 通过 / **0 失败** / 21 跳过（跳过项在 `tests/not-ported.js` 里逐条说明） |
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
| 重编译原生模块前必须先停桌面 | 桌面（Electron）加载了 `odk_process.node`，文件被占用，`node-gyp rebuild` 会在 unlink 阶段报 `EPERM`。先停 `OdkDesk` 任务再编译，否则 kiosk 循环几秒内就把桌面拉回来重新占用 |
| 原生进程读取器已构建并可用 | 构件 `native/odk-process/build/Release/odk_process.node`（约 145 KB，N-API，故 Node 与 Electron 都能加载）：`rows=213 withCwd=197`，样例 `winlogon.exe → cwd C:\WINDOWS\system32\` |

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

kiosk 窗口本身在 `src/main.js` 里**先 show、再 fullscreen**：Windows 上对尚未 show 的窗口请求 fullscreen 会让它留在不可见状态，而 Windows 的 kiosk 模式会按工作区尺寸建窗并锁死几何（这正是面板底部那条桌面缝的来源）。顺序与每宿主的取法由 `tests/kiosk-window-order.test.js` 钉住。

停止面板：

```powershell
Stop-ScheduledTask -TaskName OdkDesk
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process
```

注意：**计划任务自身不能再注册任务**（Windows 用受限令牌阻止这种链式持久化，会报“拒绝访问”）。要用任务包装的脚本里不要调 `Register-ScheduledTask`/`schtasks /Create`；从你的登录会话（或 SSH）里注册。

## Tailscale（从网络外部到达这台设备）

Desk 从网络外部被操作：SSH、传文件、远程作业。Tailscale 是那条路径，所以它是**部署的一部分**，而不是可选件（决策见 [ADR-0024](adr/0024-tailscale-is-provisioned-and-a-host-install-is-reused.md)）。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1            # 缺失才装
powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1 -Report     # 只看状态，永不安装
```

**复用规则（重点）**：宿主机已经装了 Tailscale（`C:\Program Files\Tailscale\tailscale.exe` 存在）就**直接用它自己的**——不覆盖、不代登录、不改它的配置。脚本只在命令缺失时才装，且可重复执行。

安装需要管理员权限（提权会话，或你点一次 UAC），所以它不是外壳启动的一部分；**登录也永远不自动化、不存凭据**：`tailscale up` 会打印一个 URL 让你打开，或用托盘应用。Desk 只如实报状态：`connected` / `needs-login` / `stopped` / 其它，拿不到就说原因。

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