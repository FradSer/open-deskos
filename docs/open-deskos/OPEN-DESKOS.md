# Open DeskOS —— 桌面伴侣操作系统:产品定义与执行总纲

> 2026-07-07 直接撰写(非 brainstorming 流程产物)。本文把 Open DeskOS 从"以 HID 模拟为核心的富功能输入设备"重新定位为**桌面 OS 设备**,统一收编既有的 MVP 规格、App Center 重设计与 ESP-NOW 子系统,并给出可直接开工的硬门/里程碑/任务映射。
> 阅读本文前不需要读其他文档;实施某个子系统时按 §2 的处置表跳到对应规格。

## 1. 产品定义

**Open DeskOS**:运行在 ESP32-P4 + ESP32-C6 上的桌面操作系统,设备常驻键盘旁(928×262 横置触摸条形态),经 USB-C 连接 Mac,搭配 macOS 常驻 app 构成完整体验。

> **CM5/S31 迁移候选**：Orange Pi CM5（RK3588S）可作为 Linux/NPU 主脑，ESP32-S31 可作为 Wi‑Fi 6、Bluetooth 5.4 和 ESP-NOW 无线协处理器。该路线的验证边界和限制见 [CM5-S31-INTEGRATION.md](CM5-S31-INTEGRATION.md)；不改变当前 P4+C6 主线结论。

五大产品支柱(即本轮需求的五条,逐条映射到子系统):

| # | 支柱 | 一句话 | 承载章节 |
|---|---|---|---|
| P-1 | 语音输入(typeless 式) | 对着设备说话,文字出现在 macOS 光标处;支持润色/翻译 | §7 |
| P-2 | 应用平台（概念归档，后续重构） | 用户用自己的 prompt 生成 app，或安装扩展包（旧 App Center 实现已从仓库移除） | §6 |
| P-3 | Widget 桌面 | AI 订阅用量、服务器状态等以 widget 常驻主屏;widget 可由 Lua 自动生成;点击即进入 app(iOS 语义) | §5 |
| P-4 | 内置 app 套件 | 番茄钟、日历、AI Chatbot 等,围绕"键盘旁 + 连着 Mac"场景设计 | §8 |
| P-5 | ESP-NOW 设备中枢 | C6 作桌面其他设备(充电头/花盆/便利贴等)的状态监控枢纽 | §9 |

**产品形态锁定**:
- 屏幕横置为默认形态(928×262 bar,面板原生 262×928 竖向,需 90° 旋转,见 HG-4);
- 设备 = 复合 HID(键盘 + 消费控制 + 厂商通道)+ 触摸屏 + 麦克风 + 语音键;物理键矩阵沿用 [SPEC-MVP.md](SPEC-MVP.md) §十三结论:可后置,不在验收门槛;
- macOS 常驻端(menu bar 常驻)是产品的"主机侧半身",不是可选配件(中文注入、日历/用量数据、包侧载都经它)。

## 2. 与既有文档的关系(先读这张表)

本文**不重写**已锁定的子系统规格,只做收编与三处实质变更。每份文档的处置:

| 文档 | 处置 | 说明 |
|---|---|---|
| [PROJECT-OPEN-DESKOS.md](PROJECT-OPEN-DESKOS.md) | **产品定位与路线图由本文取代**;芯片角色、硬约束、风险表沿用 | 原"第一~五期"路线图重排:原第一期(MVP)吸收进本文 M1/M4;原二期(ESP-SR/宏)、三期(Matter)、四期(UAC)、五期(无线)全部移入 §13 "v1 之后" |
| [SPEC-MVP.md](SPEC-MVP.md) | **沿用为子系统实施规格**,三处修订(见下) | §二~三 HID/USB/厂商通道、§五 语音管线、§六 ESP-NOW、§八 硬件底座、§九~十六、§二十依赖清单原样有效 |
| [2026-06-12 MVP 设计] (archived) + [2026-06-13 实施计划] (archived) | **域逻辑/客户端/协议任务全部沿用**;骨架类任务(013/020/022)被 esp-claw fork 基座修订 | 逐任务处置见 §11.3。这同时解决了此前悬而未决的冲突:06-13 计划的 from-scratch 骨架 vs 07-04 重设计 FR-1 的 fork 基座——**裁决:fork 基座胜出** |
| [2026-07-04 App Center 重设计] (archived) | **平台核心全部沿用**(包格式/沙盒硬化/商店/权限/LVGL 9.3 锁);**FR-11 反转**(见 §6.2) | 除 FR-11/R-5 外的 FR/NFR/CON 与 architecture/bdd-specs/best-practices 三件套继续是平台实施依据 |
| [2026-07-02 P7 设计] (archived) / [讨论纪要] (archived) | 维持"已取代/决策已落定"状态,不受本文影响 | 决策树回溯用 |
| [2026-07-03 P7.2 语音场景设计] (archived) | 属 LUMINA-P4 产品线,不受本文影响 | 平台核心按重设计 NFR-12 两产品共享 |

**对 SPEC-MVP 的三处修订**(本文为准,后续修订 SPEC 时落回):

1. **§四"显示内容"清单** → 由本文 §5 的 OS 外壳(widget 主屏 + app 全屏)取代。原清单里的每一项(语音状态/连接状态/外设状态/now-playing/宏面板/系统状态)都映射为 widget 或内置 app,不再是固定状态页。
2. **§五/§十九"触摸确认后才上屏"** → 从强制改为**可配置**:默认"直出模式"(段级流式注入,零摩擦,typeless 式),设置里可开"确认模式"(原行为)。验收行同步修订(§11.2 M1)。
3. **§四触摸 IC 型号**:SPEC 写 CST3530;现役 Guition JC4880P443C 板为 Goodix **GT911**(board_peripherals.yaml / setup_device.c 已按 GT911 落地)。实施 021 任务时以现役板实物为准。
4. **硬件支持目标**:固件生产支持 Guition JC4880P443C (P4+C6 480×800 MIPI-DSI)、Waveshare ESP32-S3 Touch LCD 2.8 (240×320 SPI)、以及 M5Stack PaperColor (ESP32-S3, 400×600 ED2208 电子墨水屏) 三款硬件。

## 3. 系统总览

```
┌─────────────────────────── Open DeskOS 设备 ───────────────────────────┐
│  ESP32-P4(Open DeskOS)                ESP32-C6(协处理器)          │
│  ├─ OS 外壳: 状态栏 + widget 主屏       ├─ esp-hosted slave(Wi-Fi)  │
│  ├─ App Manager/Runtime: Lua 沙盒 + 生命周期 ├─ ESP-NOW hub(外设中枢) │
│  ├─ Shell: LVGL widget + Peek + State Store  └─ Peer Data Transfer / UART │
│  ├─ 听写服务(native): I2S→VAD→Opus            ▲                    │
│  ├─ pkg: 安装器 + 商店客户端 + 侧载             │ ESP-NOW            │
│  ├─ infra: USB 复合 HID / DSI / 触摸    ┌──────┴──────────┐         │
│  └─ SDIO ◄──────────────────────────►  │ 充电头 / 花盆 /   │         │
└──────────┬────────────────────────────  │ 便利贴 / …(peer)│         │
           │ USB-HS(复合 HID + 厂商通道)  └─────────────────┘         │
┌──────────▼──────────────┐    ┌────────────────────────────────────┐
│ macOS 常驻端(Rust)     │    │ 云与商店                            │
│ ├─ Unicode 注入(CGEvent)│    │ ├─ 流式 ASR(WSS)                  │
│ ├─ 配网/设置 UI          │◄──►│ ├─ LLM(Anthropic/OpenAI 兼容)     │
│ ├─ 数据提供者(日历/用量) │    │ └─ 包目录(静态 HTTP,LuaRocks 式) │
│ └─ 包侧载 + 生成工作台   │    └───────────────▲────────────────────┘
└─────────────────────────┘         C6 Wi-Fi 直连(设备不依赖 Mac 联网)
```

四条数据路径:

1. **注入路径**(P-1):ASCII → HID 扫描码直出;中文/Unicode → 厂商通道 64B 帧([SPEC §3.6](SPEC-MVP.md))→ macOS 端 CGEvent 注入。
2. **主机数据下行**:macOS 端经厂商通道向设备推日历/AI 用量/Mac 状态,以及侧载 `.cerb-pack`(§10.3)。
3. **云路径**(P-1/P-2/P-4):P4 →(SDIO esp-hosted)→ C6 → Wi-Fi → ASR/LLM/商店。设备自持 Wi-Fi,Mac 睡眠不影响 widget 刷新。
4. **外设路径**(P-5):peer → ESP-NOW → C6 →(Peer Data Transfer,SDIO 不稳则 UART 旁路)→ P4 状态表 → widget/通知。

## 4. 硬件现实与硬门(前置,不可软绕)

所有 UI 可见性最终堵在同一个地方。三个硬门(HG = hard gate),每个带当前状态与 pivot:

| 门 | 内容 | 当前状态 | 判据 | pivot(失败分支) |
|---|---|---|---|---|
| **HG-2** | esp-hosted SDIO 并发可行性(= task-026 / G-4) | 未复测。#184 入站停滞修复未确认、#167 状态崩溃开放 | [SPEC §5.2](SPEC-MVP.md) 判定条件(吞吐/失败率/延迟三阈值) | 分段上传 → UART 旁路 → 换 S3 协处理器(SPEC §5.2 优先级表) |
| **HG-3** | 音频链路 bring-up | 硬件已在开发板上(LMA3729T421 硅麦 + ES8311 + NS4150 + 扬声器,[SPEC §八](SPEC-MVP.md));软件未动 | I2S 采集 16kHz/16bit 稳定 5 分钟 + Opus 编码实时率 <50% 单核 | 换 PDM 直采(绕过 ES8311)或外接 codec 小板 |
| **HG-4** | 横置渲染性能(新增) | 未验证。面板原生竖向,横置 bar 需 90° 旋转:PPA SRM 硬件旋转优先,LVGL 软旋转兜底 | 928×262 横置下 LVGL 满帧 ≥30fps、无撕裂 | 竖屏 UI 布局(widget 纵向堆叠),产品形态降级但不阻塞 |

**关键执行原则:屏幕不亮 ≠ 全线停工。**

- M1"打字机"里程碑(§11.2)**显式无屏可跑**:语音键→说话→Mac 上屏,状态用 LED/日志表达。旗舰功能与面板硬件门解耦。
- OS 外壳/widget/沙盒全部先跑 **LVGL host simulator**(SDL,928×262 与 262×928 双目标,任务 NT-2),硬件门通过后一次性上真机。

## 5. 交互模型与 OS 外壳

### 5.1 屏幕布局

- 分辨率 928×262(横置)。顶部**状态栏 28px**:时间、USB/客户端在线、Wi-Fi、mic 采集指示(红点,硬规则见 §7)、通知点。内容区 928×234。
- 初始网格(实施期可调):边距 8px、槽间距 8px,4 槽制。widget 三档:**S = 222×218**(1 槽)、**M = 452×218**(2 槽)、**L = 912×218**(整行)。

### 5.2 导航模型

| 手势/输入 | 行为 |
|---|---|
| 主屏左右滑 | widget 翻页(页数不限,首页默认系统页) |
| 点按 widget | 打开所属 app 全屏(可带路由参数,如设备中枢直达某 peer 详情)——iOS 语义 |
| 长按 widget/空白 | 编辑模式:拖排序、删除、"+"进 widget 库(来自已装包的 widget 声明) |
| 屏幕左边缘右滑 或 状态栏点按 | 返回主屏(app 转入后台/休眠) |
| **语音键**(物理) | 任意界面呼出**听写 overlay**(系统级浮层,不切换前台 app;§7) |
| 通知横幅点按 | 跳转来源 app |

### 5.3 Widget 框架(P-3 核心)

当前实现把 Widget 定义为 Shell 持有的 LVGL 视图，而不是独立的活跃进程。Shell 是唯一的 LVGL owner；主页和底部 Peek 都在同一个 Shell Lua state 内构建。

- Widget 点击后直接调用 Shell 的 App open seam；主页 Tile 和底部 Peek 在常驻 Shell 上挂载全尺寸 App frame，再让不透明的纯色遮罩从来源 widget 的绝对矩形快速展开到全屏。App 内容树不参与缩放，因此不会出现文字和控件被压缩的视觉；返回时沿同一 Hero 遮罩路径收缩后销毁 runtime。此路径不使用渐隐渐显、方向滑屏或 Z 轴旋转。
- Peek 由 Shell 持有，保存最近打开的 `app_id`。主页 Widget、Peek 和 App 通过 State Store 的同名 namespace 共享数据；返回主页只销毁 App screen/runtime，不销毁 namespace。
- 当前 App 包的唯一入口是 `app/main.lua`，返回带 `on_start(ctx)` 的 Lua App module。XML widget 包、独立 widget refresh 队列和编辑模式属于后续增量，不是当前 v2 manifest 的隐式兼容面。

### 5.4 App 生命周期与前后台

当前 v2 生命周期是唯一的 canonical App contract：`on_start(ctx)` 必填，`on_pause(ctx)`、`on_resume(ctx)`、`on_tick(ctx)`、`on_stop(ctx)` 可选。Shell 同时只允许一个 foreground UI App；App screen/runtime 在 `on_stop` 后释放，State Store namespace 跨返回主页继续存在。Service App 由 C App Manager 在独立的 App Manager worker 上驱动；UI App 的 LVGL 回调始终回到 Shell/LVGL owner task，不创建 App 专属 LVGL task。

### 5.5 通知

- 来源:peer 告警(§9)、安装完成/失败、转写失败、包故障升级(重设计 FR-21)。
- 呈现:状态栏横幅 3s + 通知点;可在设置里按来源开关"转发到 macOS 通知中心"(经厂商通道 → companion → UNUserNotification)。

## 6. 应用平台(App Center 概念归档与后续重构,P-2)

> **清理说明（2026-08）**：App Center 独立主屏页面与旧目录存根已被移出当前活跃概念与主屏排版，相关代码与文档已从仓库移除，后续将基于 v2.0 模块化插件体系（`core/plugin_registry.lua`）进行统一重构。

### 6.1 沿用重设计的全部平台核心

当前实现采用 v2 App package contract：`schema_version: 2`、`app_id`、`version`、`name`、`kind`、`entry: "app/main.lua"`、`capabilities`、`dependencies` 和 `files`。安装器执行 staging、SHA-256、授权、原子 rename、provenance/index 更新；App Manager 注册 `ui`/`service` descriptor，Runtime 为每个 live App 创建独立 Lua sandbox。旧 `package_id`、`script/main.lua`、旧生命周期回调和 `odk_app_host` 均不再是兼容输入。

### 6.2 FR-11 反转:运行期 LLM 恢复为一等公民

重设计 FR-11/R-5 曾把 prompt→UI 定位为 dev-time only(fork 时移除运行时 HTTP LLM 后端)。本轮需求(P-2"基于自己的输入生成 app"、P-4 AI Chatbot、P-1 润色/翻译)推翻该定位——**运行期 LLM 是产品主张本身**,esp-claw 的 chat-as-creation 回路保留不拆。R-5 列举的四重风险(幻觉/成本/延迟/云依赖)改用四条补偿约束:

1. **生成包永远走安装管线**:设备生成路径产出 v2 App package，经 staging→校验→**权限确认**→原子安装。LLM 对文件系统与能力零直接访问；沙盒不变式不因生成来源松动。
2. **模板约束生成**:当前生成范围是 `app_v2` 的 `app/main.lua` Lua module skeleton + manifest slots；LLM 只填充受限 JSON slots，不直接取得包根目录或运行时能力。`cerb ui` 仍是显式的开发/演示入口，不是绕过安装器的生产 App 分发路径。
3. **系统级用量配额**:LLM 请求走统一 `svc_llm`,NVS 计数,默认日配额(如 50 次/日,可在设置调整);配额与花费直接显示在"AI 用量"widget——产品自己监控自己(P-3 自举)。
4. **成本可见**:Chatbot/生成/润色每次会话尾部显示 token 消耗。

### 6.3 生成通道两条

| 通道 | 路径 | 适用 |
|---|---|---|
| 设备直连 | 设备 Chatbot/语音 →(C6 Wi-Fi)→ 云 LLM → 模板填充 → 本机安装管线 | 简单 widget("给我一个显示北京天气的 widget") |
| macOS 生成工作台 | companion 调 LLM(云或本地 Ollama/LM Studio,OpenAI 兼容)→ 生成完整包 → 厂商通道侧载 | 复杂 app、迭代调试、开发者路径(原 FR-11 的 dev-time 链路降级为此通道,不再是唯一通道) |

### 6.4 `hid.*` 能力特别策略(输入设备特有的高危面)

第三方包拿到 `hid.inject` 等于能向 Mac 打字。策略:安装时红色高危警示(区别于普通能力)+ **仅前台 app 可调** + 必须在用户触摸交互后 5s 窗口内 + 每会话首次注入弹状态栏横幅。系统听写服务是 native 代码,不经此通道。

### 6.5 商店

静态目录沿用重设计 FR-6。当前分发单元是 v2 App package，按 `kind=ui` 或 `kind=service` 区分前台 UI 与无头服务；独立 widget/peer package 需要在未来扩展 manifest，而不是由当前安装器猜测。

## 7. 语音输入(typeless 式,P-1,旗舰)

管线沿用 [SPEC §五](SPEC-MVP.md) 不变:I2S DMA → VAD → Opus 12–24kbps → WSS 流式 ASR(首段转写 ~300ms 级)→ 文本 → ASCII 走 HID 扫描码 / 中文经厂商通道 + companion 注入。esp-hosted 回退阶梯沿用 SPEC §5.2。本文新增**体验层**:

### 7.1 三种听写模式

| 模式 | 行为 | 延迟预算 |
|---|---|---|
| **直出**(默认) | **段级流式注入**:VAD 断句,每段 final 立即注入光标处;partial 只显示在设备屏(overlay),不注入(HID 注入不可撤回,不做词级回改) | 首 partial 屏显 ≤1s;段 final→上屏 ≤2s |
| **润色** | 整条说完 → LLM 清口癖/补标点/按提示改写(如"正式语气")→ 注入 | 直出 +1–2s |
| **翻译** | 说中文 → 出目标语言文本(默认英文)→ 注入 | 同润色 |

- **确认模式**(SPEC 原行为:屏上确认/丢弃后才注入)保留为全局开关,默认关。
- 口述编辑指令("回车""删掉上一句"→ 注入编辑键序列)列入 v1 之后(§13)。

### 7.2 系统级 overlay

听写不是 app,是 OS 服务:任意界面按语音键呼出底部 overlay(不夺走前台 app 的 owner 资格,overlay 属外壳),显示波形/partial/模式切换;松键收尾后 overlay 自动退出。

### 7.3 隐私硬规则

麦克风采集中,状态栏红点常显 + 无屏阶段(M1)LED 常亮。无例外,不可由包或设置关闭。

### 7.4 降级链

无 Wi-Fi → overlay 直接提示,不采集;客户端离线 → 仅 ASCII 注入并提示(SPEC §十九原行为);ASR 中断 → 已出段保留,当前段丢弃并提示。

## 8. 内置 App 套件(P-4)

**原则:内容型 app 一律做成预装 Lua 包**——第一方 app 用与第三方完全相同的 SDK/管线,是平台成立的自证(dogfooding);强实时或需系统权限的做 native。

| App | 形态 | 数据源 | Widget | 说明 |
|---|---|---|---|---|
| 听写 | native 服务 + overlay | ASR/LLM | —(状态栏红点) | §7,不是 app |
| App Center | native | 商店目录/侧载 | S(待装更新数) | §6（概念已归档，后续重构） |
| 设置 | native | NVS | — | Wi-Fi(经 companion 配网,SPEC §5.1)、听写模式、LLM key 与配额、通知转发、亮度 |
| 设备中枢 | native 框架 + peer 设备包 | ESP-NOW 状态表 | 每 peer 一个 S/M | §9,含配对 UX |
| **AI Chatbot** | 预装 Lua 包 | `svc_llm`(流式 C 绑定,Lua 轮询读增量) | S(快捷入口) | 对话;答案可"发送到 Mac"(注入);兼 §6.3 设备直连生成入口 |
| **番茄钟** | 预装 Lua 包 | 本地定时 | S(剩余时间)/M(+今日统计) | 开始/结束可联动 macOS 专注模式(companion 执行 `shortcuts run`) |
| **日历一览** | 预装 Lua 包 | companion 推送(EventKit) | M(下一会议倒计时)/L(今日时间轴) | Mac 睡眠时显示"数据 xx 分钟前";点按会议可让 companion 打开会议链接 |
| **AI 用量** | 预装 Lua 包 | companion 拉取为主(API key 存 macOS Keychain);设备直拉为备(key 存 NVS) | S(本月花费)/M(+按供应商拆分) | Anthropic/OpenAI 用量与额度;与 §6.2 配额计数联动展示本机消耗 |
| **服务器状态** | 预装 Lua 包 | 设备直连 HTTP 探测(状态码/延迟),或消费 Uptime-Kuma/Glances API | M/L(每主机红绿灯 + 延迟) | 设备自持 Wi-Fi,Mac 关机也在监控;探测周期 ≥30s |

候选池(不进首发,留给商店/社区):剪贴板历史(隐私,默认不做)、Mac 系统状态(CPU/内存/电池)、Now-playing(消费控制上下文,SPEC §四曾列)、世界时钟、倒数日。

## 9. ESP-NOW 设备中枢(P-5)

传输与协议底座**全部沿用 [SPEC §六](SPEC-MVP.md)**:路径 B(ESP-NOW 驻留 C6 + Peer Data Transfer `custom_data` API,单包实测 ~8166B)、UART 921600 旁路、应用层帧 `ver(1B)+type(1B)+seq(1B)+len(1B)+payload(≤196B)`、type `0x01 遥测/0x02 指令/0x03 配对/0x04 心跳`、1–5s 遥测 + 10s 心跳 ×3 判离线、PMK/LMK 加密、信道跟随 C6 STA、回调零阻塞入队。验收口径沿用 SPEC §6.5(1h 丢包 <5%、指令往返 <200ms、离线检测 <30s)。

本文在其上扩展四件事:

### 9.1 设备类型注册表

遥测帧 payload 首字节 = `device_type`:`0x01` 充电头 / `0x02` 智能花盆 / `0x03` 智能便利贴 / `0x04–0x7F` 官方保留 / `0x80–0xFF` 私有实验。注册表落在 `protocol/` 单一事实源。

### 9.2 遥测 TLV

`device_type` 之后是 TLV 数组:`{metric_id(1B), type(1B: u8/u16/i16/u32/str), len(1B), value}`。通用 metric(`0x01` 电量 `0x02` 温度 `0x03` 功率 …)官方分配,`0x80+` 设备私有。指令帧(0x02)同构反向。

### 9.3 peer 设备包

每种 `device_type` 对应一个商店里的 **peer 设备包**(纯 widget 包 + 告警规则声明):声明该设备的 widget 模板(XML,绑定 TLV metric)与阈值告警(如花盆湿度 < 20% → 通知)。未安装设备包的 peer 显示通用"原始遥测"卡片。这使"支持一种新桌面设备"= 发一个包,不动固件。

### 9.4 配对 UX 与容量

设备中枢 app → "添加设备" → C6 进入配对窗口(60s)→ 屏显发现列表 → 点按确认 → LMK 交换入表(SPEC §6.3 流程)。加密 peer 上限 17(SPEC 已注),**v1 目标 ≤6** 留余量。

### 9.5 外设参考实现

`protocol/` 下出 `open-deskos-peer` 单头文件参考实现(ESP-IDF + Arduino 双例:广播遥测 + 收指令 + 配对),供充电头/花盆/便利贴等外设项目(pulse-esp 等姊妹仓库)接入;验收用第二块 C6 devkit 烧 beacon 模拟器(SPEC §6.5 同款)。

## 10. macOS 常驻端(companion)

定位从"注入客户端"升级为 OS 的主机侧半身。技术栈沿用 06-13 计划:Rust workspace(tasks 009–012 原样有效),menu bar 常驻(tray),launchd LaunchAgent 自启;TCC 双权限:Accessibility(注入)+ Input Monitoring(hidapi 读 HID),hidapi #266 复合设备枚举缺陷的剪贴板兜底沿用 [SPEC §3.6](SPEC-MVP.md)。

### 10.1 职责清单

| # | 职责 | 依赖 |
|---|---|---|
| 1 | Unicode/中文注入(CGEvent ≤20 UTF-16 单元分块 + 剪贴板兜底) | tasks 010–012 |
| 2 | 配网与设备设置(厂商通道 CONFIG 帧,SPEC §5.1 首选路径) | task-008 |
| 3 | **数据提供者**:EventKit 日历、AI 用量拉取(key 在 Keychain)、Mac 状态;按订阅周期推送 | 新任务 NT-13 |
| 4 | **包侧载通道 + 生成工作台**(§6.3):本地/云 LLM 产包 → 推给设备安装 | NT-14 |
| 5 | 专注模式/快捷指令桥(`shortcuts run`,番茄钟联动) | NT-13 |
| 6 | 基座固件更新:提示 + 触发设备走 Wi-Fi `esp_https_ota`(A/B 分区,§11.4;这是 `esp_https_ota` 唯一合法用途,与 NFR-10 不冲突) | NT-19 |

### 10.2 厂商通道帧类型扩展

在 SPEC §3.6 的 64B 帧 `byte 0` 类型空间上新增:`DATA_PUSH`(日历/用量/状态,分主题)、`PKG_XFER`(包分块传输,复用既有 分片/序号/ACK 机制;60KB/s 有效吞吐下 100KB 包 ≈ 2s)、`NOTIFY`(设备→Mac 通知转发)。具体 ID 分配落 `protocol/` 单一事实源(task-001 扩展)。

### 10.3 生成工作台

图形化最小版:prompt 输入 → 选模板 → 预览(widget XML 渲染预览可后置)→ 生成 `.cerb-pack` → 一键侧载。面向开发者的 CLI 同源(同一 Rust crate 暴露命令行)。

## 11. 执行路线

### 11.1 泳道与依赖

四条并行泳道,里程碑是**验收门**而非串行阶段:

```
泳道 A 硬件门:   HG-2 … HG-3 … HG-4
泳道 B 打字机:   001→002/003/005/007/008 → 009→010/011/012 → 014/015/016/017/019   (无屏可跑)
泳道 C 桌面+平台: NT-2 模拟器 → NT-1 fork → NT-3 沙盒 → 004/NT-4/NT-5/NT-6 → NT-7…NT-11 → NT-18
                                                     └── 真机上屏仅依赖泳道 A ──┘
泳道 D 中枢:     006 → NT-15(C6 hub)→ NT-16/NT-17                            (依赖 015)
收口:            022(修订)→ 023/024 → NT-19 → GAUNTLET
```

### 11.2 里程碑与验收

| 里程碑 | 内容 | 验收判据 |
|---|---|---|
| **M0 硬件解锁** | HG-2~4 三个 spike/gate,与一切并行 | 各门判据见 §4 表;每门出书面结论(通过/`pivot` 分支选择) |
| **M1 打字机**(无屏可跑) | 复合 HID + 厂商通道 + companion 注入 + 直出模式听写(段级) | 免驱枚举复合 HID;ASCII 与中文稳定上屏;语音键→说话→Mac 光标处出字,段 final ≤2s;mic LED 指示;1h 连续听写浸泡无死锁(SPEC §十九对应行按 §2 修订 2 执行) |
| **M2 桌面** | esp-claw fork 基座 + 模拟器 + 外壳(状态栏/widget 主屏/编辑模式)+ 沙盒硬化 + 时钟/连接状态两个内置 widget + 设置 | 模拟器与真机双跑;横置 ≥30fps(HG-4 判据);触摸翻页/进出 app/编辑模式全通;上电→可用 <3s |
| **M3 平台** | 安装器 + 商店客户端 + 权限确认屏 + 侧载(USB `PKG_XFER` + SD)+ `svc_llm` 配额 + Chatbot + 设备直连生成 + 生成工作台 + 番茄钟/日历/用量/服务器四个 dogfood 包 | 从目录安装 100KB 包 ≤30s 且断电安全(staging 原子性);侧载全程离线可用;权限屏如实展示能力清单;prompt→widget 生成→安装→主屏出卡全链演示;四个包各出 widget 且点按进 app;沙盒违规只杀脚本不重启(重设计 FR-21) |
| **M4 中枢** | C6 hub 扩展(类型/TLV)+ 设备中枢 app + 配对 UX + `open-deskos-peer` 参考实现 + beacon 模拟器 | SPEC §6.5 全部数值;配对 60s 窗口全流程触摸完成;花盆模拟器触发阈值告警→状态栏横幅→macOS 通知 |
| **M5 收口** | 组合根/双核任务收口(022 修订版)+ CI(023,含模拟器目标)+ HIL(024)+ OTA A/B | 24h GAUNTLET 混合浸泡(听写+widget 刷新+peer 遥测+安装/卸载循环)无重启无泄漏;OTA 升级+回滚各一次成功;峰值电流 <1.2A(SPEC §十九) |

### 11.3 对 2026-06-13 计划 26 任务的处置

| 处置 | 任务 | 说明 |
|---|---|---|
| **沿用** | 001(+帧类型/设备注册表扩展)、002、003、005(+三模式)、006(+TLV)、007、008、009、010、011、012、014、015、016、017、018、019、023(+模拟器目标)、024(+OS 验收) | 域逻辑宿主机测试、客户端 BDD、在板冒烟的测试分层全部不变 |
| **修订** | 004(UI 状态机 → 外壳导航 FSM:主屏/app/overlay/编辑四态,仍宿主机可测)、020(显示实现改走 fork 的 `setup_device.c` lcd factory-entry,重设计 FR-2)、021(触摸 IC 按现役板 GT911 定型)、022(组合根改为 fork 的 `app_main` 集成 + SPEC §十二任务表) | Red-Green 配对与依赖关系保持 |
| **取代** | 013(P4 from-scratch 骨架)→ **NT-1 esp-claw fork bootstrap** | §2 裁决的落点 |
| **等价** | 026 = HG-2;025(AMOLED 面板点亮)已随 CO6300 分支清理从仓库移除 | 已在执行序列最前 |

### 11.4 新增任务(NT)

| ID | 任务 | 里程碑 | 依赖 |
|---|---|---|---|
| NT-1 | esp-claw fork bootstrap:vendored fork、板条目骨架、裁剪清单(保留 Lua/cap/display 核,LLM 后端按 §6.2 保留但接 `svc_llm` 配额层) | M2 | — |
| NT-2 | LVGL host simulator 目标(SDL,双方向),进 CI | M0/M2 | — |
| NT-3 | Lua 沙盒硬化(重设计 architecture §4 五措施 + 白名单审计清单) | M2 | NT-1 |
| NT-4 | OS 外壳(状态栏/widget 主屏/编辑模式/overlay 容器) | M2 | NT-2、004 |
| NT-5 | Shell widget/Peek 与 State Store(共享 namespace、App screen 释放、主页刷新) | M2 | NT-3、NT-4 |
| NT-6 | App Manager + App Runtime(生命周期映射、独立 sandbox、UI/service kind) | M2 | NT-3 |
| NT-7 | 包安装器(staging/SHA-256/原子 rename/SD 索引/sidecar) | M3 | 018 |
| NT-8 | 商店客户端(目录/SD 缓存/离线/权限确认屏) | M3 | NT-7 |
| NT-9 | 侧载(厂商通道 `PKG_XFER` + SD 路径) | M3 | NT-7、002 |
| NT-10 | `svc_llm`(流式、配额计数、成本上报) | M3 | 017 |
| NT-11 | 设备直连生成管线(模板填充→产包→安装管线) | M3 | NT-10、NT-7 |
| NT-12 | 听写体验层(overlay、三模式、段级注入策略) | M1/M2 | 005、017 |
| NT-13 | companion 数据提供者(EventKit/用量/Mac 状态/专注桥) | M3 | 012 |
| NT-14 | companion 侧载 + 生成工作台(GUI 最小版 + CLI) | M3 | NT-9、NT-13 |
| NT-15 | C6 hub 扩展(设备类型/TLV/告警透传) | M4 | 015、006 |
| NT-16 | 设备中枢 app + 配对 UX + peer 设备包机制 | M4 | NT-15、NT-5 |
| NT-17 | `open-deskos-peer` 参考实现 + beacon 模拟器 | M4 | 001 |
| NT-18 | 四个 dogfood 内置包(番茄钟/日历/用量/服务器)+ Chatbot 包 | M3 | NT-5、NT-10、NT-13 |
| NT-19 | 基座 OTA(A/B 分区、companion 触发、回滚) | M5 | 016 |
| NT-20 | 通知系统(横幅/通知点/macOS 转发) | M2/M3 | NT-4 |

### 11.5 分区表提案(16MB flash 假设,以实物为准 → §14)

| 分区 | 大小 | 说明 |
|---|---|---|
| nvs / nvs_keys / phy | ~64KB | NVS 加密(每包 key 隔离,重设计 FR-12) |
| ota_0 / ota_1 | 各 ~4.5MB | 基座 A/B(NT-19);factory 不单设 |
| packages | ~6MB,LittleFS | 重设计 FR-16;已装索引在 SD/此分区文件,不占 NVS |
| coredump | 64KB | 故障归档 |

## 12. 预算汇总(引用既有数字,不新造)

- **任务/核心分配**:沿用 [SPEC §十二](SPEC-MVP.md) 全表(Core 1 强实时 = HID/USB/采集;Core 0 = 网络/LVGL/状态机);App Manager/安装器使用 Core 0 worker，Shell/LVGL 仍由唯一 UI owner task 驱动，App 不创建自己的 LVGL task。
- **PSRAM**:LVGL 双全帧 ~950KB(或 126KB 部分双缓起步)+ 音频环形 320KB + 上传缓冲 512KB + Lua 池 64–128KB × ≤4 state(与 framebuffer/音频不共池,NFR-3)+ 包解析工作区。16/32MB 下宽裕。
- **吞吐**:厂商通道 ~60KB/s(SPEC §3.6);Opus 上行 2–3KB/s;ESP-NOW 帧 ≤200B。
- **优先级不变式**:听写会话 > LVGL 渲染 > widget 刷新 = 下载/安装 > peer 遥测处理(遥测只入队)。

## 13. v1 之后(不做承诺,仅记入口)

原 PROJECT-OPEN-DESKOS 二~五期顺延:ESP-SR 本地唤醒/命令词、口述编辑指令(§7.1)、宏引擎、BLE 配网、UAC 声卡、无线版(Nordic)、Matter;平台侧:包签名(Ed25519,重设计 NFR-9 的解冻条件 = 出现第三方目录)、Windows/Linux companion(SPEC §3.6 注入方案已备)、词级流式注入。

## 14. 开放问题(实施第一周内关闭)

1. **flash 实际容量**(Osptek 模块):决定 §11.5 分区表最终数字。
2. **触摸 IC 实测定型**:已定型——现役 Guition 板为 GT911,SPEC 原文 CST3530 作废(§2 修订 3)。
3. **ASR 供应商选型**:Deepgram live / 讯飞 RTASR / 火山——按中文质量、首字延迟、并发价格打分,M1 前定。
4. **商店目录托管**:静态 HTTP(Cloudflare R2/Pages 顺手)+ `catalog.json` 生成脚本归属(companion CLI 或独立小仓库)。
5. **设备命名**:本文用 "Open DeskOS" 指代固件/系统;产品名沿用 Open DeskOS。

## 15. 术语增补

沿用重设计 Glossary 为准,本文新增:**外壳(shell)**= 状态栏 + widget 主屏 + overlay 容器,唯一 LVGL owner;**widget** = 声明式视图 + 无头数据快照,非活 app;**听写 overlay** = 系统级浮层,不参与前台仲裁;**peer 设备包** = 声明某 `device_type` 的 widget 模板与告警规则的纯内容包;**生成工作台** = companion 侧 prompt→包的创作工具;**companion** = macOS 常驻端。
