# Open DeskOS MVP 实施规格

> **本文是子系统实施规格,不是产品总纲。** 2026-07-07 起顶层总纲为 [OPEN-DESKOS.md](OPEN-DESKOS.md);本文按其 §2 处置表"沿用为子系统实施规格",但带**三处修订**(见下"本文与总纲的偏差"小节)。冲突时以 OPEN-DESKOS.md 为准。
> MVP = 纯有线 USB-HID 智能设备,仅 ESP32-P4 + ESP32-C6;含 ESP-NOW 外设数据交换与自研主机客户端。
> 返回 [OPEN-DESKOS.md](OPEN-DESKOS.md) | [PROJECT-OPEN-DESKOS.md](PROJECT-OPEN-DESKOS.md) | [DESIGN-EXTENSIONS.md](DESIGN-EXTENSIONS.md) | [FACT-CHECK.md](FACT-CHECK.md)

---

> **本文与总纲的偏差(以 OPEN-DESKOS.md §2 修订 1–3 为准)**:
> 1. §四"显示内容"清单已被 Open DeskOS §5 的 OS 外壳(widget 主屏 + app 全屏)取代——原清单每一项(语音/连接/外设/now-playing/宏/系统状态)映射为 widget 或内置 app,不再是固定状态页。
> 2. §五/§十九"触摸确认后才上屏"从强制改为**可配置**:默认"直出模式"(段级流式注入),确认模式为可选开关(原行为)。§十九验收行据此修订为"段 final ≤2s 上屏"。
> 3. §四触摸 IC 型号本文写 CST3530,但在手实物 bring-up 实测为 **ZT2628**(I2C 0x18/0x58,工作正常,见 [firmware/co6300-mipi-bringup/README](../../firmware/co6300-mipi-bringup/README.md));两者同为 I2C 电容触控,实施 021 任务时以实测定型。

---

## 一、系统框图

```
  ┌──────────────────────────────────────────────────────────────┐
  │                        键盘本体                                │
  │                                                               │
  │  ┌────────────┐  SDIO 4-bit   ┌────────────┐── Wi-Fi 6 ──► 云 ASR/LLM
  │  │  ESP32-P4  │◄─────────────►│  ESP32-C6  │                 │
  │  │  (主控)    │  @40MHz       │  (Wi-Fi +  │── ESP-NOW ──► 桌面外设
  │  │            │  esp-hosted   │   ESP-NOW) │   (快充充电站等)│
  │  │            │               └────────────┘                 │
  │  │  USB-HS ───┼──► USB-C ──► PC (复合 HID + 自研客户端)      │
  │  │  MIPI-DSI ─┼──► AMOLED 触摸屏 (262×928, 3.19")            │
  │  │  I2S TX ───┼──► ES8311 ──► NS4150 ──► 喇叭               │
  │  │  I2S RX ───┼◄── MEMS 麦克风 (LMA3729T421-OA1)            │
  │  │  GPIO ─────┼──► 矩阵行列 (数字机械轴,可后置)             │
  │  │  GPIO ─────┼◄── 语音键 (低电平触发)                       │
  │  └────────────┘                                              │
  └──────────────────────────────────────────────────────────────┘
```

**数据路径说明**:

| 路径 | 方向 | 协议/接口 | 职责 |
|---|---|---|---|
| P4 ↔ C6 | 双向 | SDIO 4-bit @40MHz, esp-hosted RPC (protobuf) | P4 借 C6 上网;C6 作为 Wi-Fi 协处理器,对上层呈现标准 ESP-IDF Wi-Fi API;ESP-NOW 载荷经 Peer Data Transfer API 交换(见 §六) |
| P4 → PC | 出 | USB 2.0 HS (480 Mbps), TinyUSB | 复合 HID:键盘 + 消费控制 + 鼠标 + 厂商通道(UAC 声卡属第四期) |
| P4 → 屏 | 出 | MIPI-DSI (大概率 1-lane), ICNA3312 | 262×928 AMOLED,RGB565,LVGL 驱动 |
| 屏 → P4 | 入 | I2C (CST3530 触摸) | 触摸坐标/手势,驱动 UI 交互与可选 HID 鼠标 |
| P4 → 喇叭 | 出 | I2S TX → ES8311 DAC → NS4150 D 类功放 | 音频提示音(UAC 下行属第四期) |
| 麦克风 → P4 | 入 | I2S RX (MEMS 麦克风) | 语音采集,16kHz/16bit 单声道 |
| 矩阵 ↔ P4 | 双向 | GPIO 行列扫描 | 数字机械轴,1000Hz 扫描(可后置,不在 MVP 验收内) |
| 语音键 → P4 | 入 | GPIO 边沿中断 | 触发/停止语音采集 |
| C6 → 云 | 双向 | Wi-Fi 6 (2.4 GHz) | 云端 ASR/LLM 请求与响应;突发流量,非持续流 |
| C6 ↔ 桌面外设 | 双向 | ESP-NOW (锁 C6 当前 Wi-Fi 信道) | 低频状态/指令交换,单包 ≤250B(见 §六) |

**组件角色**:

- **ESP32-P4**:唯一主控。负责矩阵扫描、HID 报告组装、USB 设备栈、LVGL 渲染与触摸交互、语音采集与编排、厂商通道协议、ESP-NOW 载荷的应用层处理、屏状态管理。**TCP/IP(lwIP)与 TLS(mbedTLS)运行在 P4 侧**(经 esp_wifi_remote + esp_netif)。
- **ESP32-C6**:Wi-Fi 协处理器 + ESP-NOW 节点。经 esp-hosted 被 P4 调用;负责 802.11 关联/链路层与 ESP-NOW 收发,自身仅跑一层薄的 ESP-NOW 应用逻辑(见 §六),不跑其他业务。
- **ES8311**:I2S 音频编解码器,提供 ADC(麦克风)与 DAC(功放输入)。
- **NS4150**:D 类功放,驱动板上小喇叭。
- **TS3USB221AR**:USB 2.0 HS 模拟开关,把 P4 USB-HS 引到 Type-C/USB-A 口。

---

## 二、HID 规格

### 2.1 什么是 HID 模拟

USB HID 是免驱的人机接口设备类。设备只要枚举为 HID 键盘,向电脑发**键盘输入报告**(修饰键位图 + 最多 6 个同时按下的 Usage ID,或 NKRO 位图),电脑就当作真键盘。本项目所有"输入"(打字、语音转写文本、宏)都归约为这种报告序列。"把文字打进电脑" = 把字符串逐字符映射为(Usage ID + 是否 Shift)并发出 键down/键up 序列。

### 2.2 有线路径:ESP32-P4 直接做 USB-HID

P4 自带 USB 2.0 HS OTG(集成高速 PHY),用 TinyUSB(ESP-IDF Device Stack,有官方 HID 键鼠示例)枚举为 USB HID。

- **DWC_OTG 每微帧 (125µs) 支持 4 笔非周期 + 4 笔周期事务,共 16 个 host channel**。
- USB-HS 理论可达 8000Hz,但本项目**只把 1000Hz 作为基准**;高轮询仅作为有线模式下的可选项,非设计驱动。
- P4 是"大脑":屏幕 UI、语音编排、宏引擎都在 P4,有线时它直接出 HID。

### 2.3 HID 报告类型(复合设备)

MVP 实现一个**复合 HID 设备**,四个 HID 接口:

- **键盘(Keyboard)**:标准 6KRO boot 报告,承载打字与 ASCII 文本注入;boot protocol 保证 BIOS/UEFI 可用。
- **消费控制(Consumer Control)**:音量/播放/启动应用等多媒体键。
- **鼠标(Mouse)**:触摸屏拖动/双指滚动映射为相对指针/滚轮事件(屏幕交互的输出路径之一)。
- **厂商自定义(Vendor HID)**:与电脑端自研客户端通信(传递中文/Unicode 文本、配置、状态),协议见 §3.6。

### 2.4 文字注入:ASCII 纯 HID,中文/Unicode 经客户端

- HID 发的是**扫描码(物理键位)**,由电脑当前键盘布局解释。**ASCII/英文**纯 HID 即可,真正零软件、跨机通用。
- **中文、emoji、任意 Unicode 没有对应"键"**,纯 HID 打不出。脆弱的 OS 级 Unicode 输入(Windows Alt+小键盘、Linux Ctrl+Shift+U、macOS Unicode Hex Input)依赖 OS/布局且会与中文输入法打架,不可靠。
- **可靠做法(MVP 范围)**:配一个**电脑端自研轻量客户端**,设备经**厂商 HID 通道**(§3.6)把 UTF-8 文本发给它,客户端调用系统文本注入 API(Windows `SendInput` / macOS `CGEventKeyboardSetUnicodeString` / Linux XTEST 或 `zwp_virtual_keyboard_v1`,细节与权限见 §3.6)稳定写入。
- **降级路径**:未装客户端的电脑上,英文/ASCII 功能完整可用;中文文本在屏上提示"需客户端"。

---

## 三、USB 复合设备描述符设计

### 3.1 Configuration Descriptor 树

MVP 为纯 HID 复合设备(UAC 声卡属第四期,届时加接口**须升 bcdDevice 或换 PID**,避免 Windows 复合设备驱动缓存导致新接口不被识别):

| Interface | Class | SubClass | Protocol | Description |
|---|---|---|---|---|
| If 0 | HID (0x03) | Boot (0x01) | Keyboard (0x01) | 键盘(boot 协议,BIOS/UEFI 可用) |
| If 1 | HID (0x03) | 0 | 0 | 消费控制 |
| If 2 | HID (0x03) | Boot (0x01) | Mouse (0x02) | 鼠标(触摸驱动) |
| If 3 | HID (0x03) | 0 | 0 | 厂商通道(64B 中断报告,自研客户端) |

每个接口单一报告类型,**不使用 Report ID**(简化主机端解析与 boot 协议兼容——boot 协议固定报告无 Report ID 字节,声明 boot 的接口混用 Report ID 会困扰部分 BIOS)。**键盘必须固定为 If 0**:部分 legacy BIOS 只枚举复合设备的第一个 HID 接口。

### 3.2 端点分配

| EP | Direction | Type | Max Packet | bInterval (HS) | Usage |
|---|---|---|---|---|---|
| EP1 IN | IN | Interrupt | 8 bytes | 4 (1ms) | 键盘 boot 报告 |
| EP2 IN | IN | Interrupt | 2 bytes | 4 (1ms) | 消费控制报告 |
| EP3 IN | IN | Interrupt | 5 bytes | 4 (1ms) | 鼠标报告 |
| EP4 IN | IN | Interrupt | 64 bytes | 4 (1ms) | 厂商通道 设备→客户端(文本/状态) |
| EP4 OUT | OUT | Interrupt | 64 bytes | 4 (1ms) | 厂商通道 客户端→设备(ACK/配置/指令) |

P4 HS 外设支持 EP0 外 15 个可配置端点、**最多 8 个并发 IN**;本设计占 4 IN + 1 OUT,余量充足(TinyUSB `CFG_TUD_HID = 4`,多 HID 实例自 v0.9.0 支持,P4 HS 设备模式自 v0.18.0 支持)。

### 3.3 带宽与调度

- 全部为中断端点,1ms 轮询:最坏情况 (8+2+5+64) IN + 64 OUT ≈ **143 KB/s**,相对 USB-HS 480Mbps 可忽略。
- DWC_OTG 每微帧 4 笔周期事务上限:5 个 1ms 间隔的中断端点由主机调度器分散到不同微帧,实际每微帧 ≤1–2 笔,远在限额内。
- 第四期加 UAC 后:扬声器 24 B/微帧 + 麦克风 12 B/微帧各占 1 笔等时事务,叠加后仍在 4 笔周期限额内(预留验证项)。

### 3.4 HID Report Descriptor 大纲

- **Keyboard(If 0)**:标准 boot 键盘,modifier bitmap(1 byte)+ reserved(1 byte)+ 6 key slots(6 bytes)= 8 bytes。Usage Page `0x01 (Generic Desktop)`,Usage `0x06 (Keyboard)`。
- **Consumer Control(If 1)**:Consumer Page(`0x0C`),16-bit usage 数组(2 bytes),含 Volume Increment/Decrement、Play/Pause、Scan Next/Previous、Mute 等。
- **Mouse(If 2)**:Usage `0x02 (Mouse)`,buttons(1 byte)+ X/Y 相对位移(2 bytes)+ wheel(1 byte)+ AC Pan(1 byte)= 5 bytes。
- **Vendor(If 3)**:Usage Page `0xFF00`,Usage `0x01`;64-byte Input + 64-byte Output 报告。客户端经 hidapi 免驱读写(选 HID 而非 Vendor class + Bulk,正是为了免 WinUSB/libusb 驱动安装;QMK/VIA Raw HID、Wooting 配套软件同款模式)。

**boot 协议切换(固件必做)**:实现 TinyUSB `tud_hid_set_protocol_cb`——主机发 `SET_PROTOCOL(Boot)` 时,键盘回固定 8B、鼠标回固定 3B(buttons/X/Y)boot 报告,报告协议模式才用上表扩展格式(已在 GRUB/iPXE/企业 BIOS 实测可行的标准做法)。

### 3.5 VID/PID

- **开发阶段**:使用 Espressif 默认 VID (`0x303A`),PID 自选(如 `0x7001`)。
- **量产**:申请独立 VID(USB-IF 会员年费 $6,000,或经代理商获取);PID 自分配。
- **描述符变更纪律**:任何接口增删(如第四期加 UAC)同时递增 `bcdDevice`,Windows 端必要时换 PID。

### 3.6 厂商通道协议(设备 ↔ 自研客户端)

64 字节定长帧(即一个 HID 报告):

```
byte 0      类型: 0x01 TEXT_UTF8 / 0x02 STATUS / 0x03 CONFIG / 0x04 ACK
byte 1      标志: bit0 = 多片消息续传, bit1 = 末片
byte 2      序号: 0–255 循环
byte 3      载荷长度: 0–60
byte 4–63   载荷
```

- **文本注入**:UTF-8 文本按 ≤60B 分片(不得切断多字节字符),逐帧发出;客户端按序号重组,收到末片后注入,并以 ACK 帧(OUT)回执序号。
- **可靠性**:设备对每片等待 ACK,50ms 超时重发,3 次失败后屏上提示"客户端未响应"并丢弃本条。
- **吞吐**:64B × 1000Hz ≈ 60 KB/s 有效载荷,对文本场景充裕。
- **设备访问(hidapi)**:Windows 免权限(各 HID collection 独立枚举,vendor 接口可直接打开);Linux 随客户端安装 udev 规则(`KERNEL=="hidraw*", ATTRS{idVendor}=="303a", TAG+="uaccess"`);**macOS 需 Input Monitoring 权限**(TCC 对 `IOHIDManager` 打开任何 HID 设备生效,不分 usage page),且存在已知缺陷 hidapi #266:带标准键盘接口的复合设备,其 vendor 接口在部分 macOS 版本可能枚举不到——**真机优先验证,失败则启用剪贴板回退通道**。
- **文本注入(分平台)**:Windows `SendInput` + `KEYEVENTF_UNICODE`(逐 UTF-16 code unit,非 BMP 字符发代理对);macOS `CGEventKeyboardSetUnicodeString`(**每事件 ≤20 个 UTF-16 单元,须分块**——enigo/espanso 实证;需 Accessibility 权限,与读设备的 Input Monitoring 是两个独立授权);Linux X11 = XTEST + 动态 XKB 重映射,Wayland = `zwp_virtual_keyboard_v1` 协议(wtype 方案,KDE/GNOME/Sway 均支持);**不用 uinput**(键码层 API,无法可靠注入 CJK,ydotool #249 实锤)。
- **通用兜底**:剪贴板 + Ctrl/Cmd+V 粘贴模式(超长文本、注入不兼容目标、macOS vendor 接口枚举失败时)。
- 客户端**开源**(见 §十六)。
- **CONFIG 帧**还承载 Wi-Fi 凭据下发(见 §5.1)与设备配置读写。

---

## 四、屏幕 UI 与触摸

- **屏幕**:MVP 已选定 **3.19" 262×928 AMOLED,MIPI-DSI 接口**。驱动 IC 为 ICNA3312(Chipone)或兼容 CO6300,已拿到厂商 MIPI 初始化代码。**屏幕硬约束:仅 AMOLED(用户要求)—— 排除 IPS**(故 Waveshare P4 圆/方 IPS 板不在考虑)。
- **触摸(MVP 必选)**:CST3530 电容触摸(I2C),屏幕交互是核心诉求——触摸用于:操作屏上 UI(切页/确认或丢弃转写/触发宏)、可选映射为 HID 鼠标指针/滚动(If 2)。
- **驱动 IC 细节**:初始化文件为 `AM319M262928ZS … BOE3.19_QSPI.txt`(文件名带 QSPI 但内容是 MIPI 版)。含标准 DCS 命令:`0x11` sleep-out、`0x29` display-on、`0x2A` 列地址 6–267(=262)、`0x2B` 行地址 0–927(=928)、`0x35` TE(防撕裂)、`0x51` 亮度。QSPI 专用寄存器已注释并标 `QSPI setting, MIPI remove`。PMIC 为 **ZP3112**(Zinitix AMOLED 升压),**1:6 MUX**。
- **加速**:LVGL + PPA(缩放/旋转/混合,支持 YUV422/GRAY8;官方无"32×32 块尺寸上限"一说),2D-DMA(3 TX + 3 RX)。
- **带宽**:P4 片内 HEX PSRAM 优化后实测约 **185 MB/s**(社区 memcpy 实测;40–60 MB/s 是旧 Quad-SPI,不适用 P4)。262×928 RGB565 单帧 = 486,272 bytes ≈ 475 KB;双缓冲 ≈ 950 KB,在 16/32MB PSRAM 中绰绰有余。30fps 所需带宽 ≈ 475KB × 30 = ~14.3 MB/s,远低于 185 MB/s 上限。
- **已知坑**:ESP32-P4 + MIPI + LVGL 有"直接画能出、LVGL flush 不刷新"的已知问题(多见于 ESPHome,如 issue #16481/#10746);建议走 **ESP-IDF 原生 `esp_lcd` + LVGL port**,按官方例程配缓冲,别用 ESPHome。
- **显示内容**:
  - 语音听写状态(聆听 / 转写中 / 结果确认——触摸确认或丢弃后才上屏)
  - 连接状态(USB 枚举 / 客户端在线 / Wi-Fi 信号 / 云端 ASR/LLM 连通性)
  - ESP-NOW 外设状态(在线/离线、遥测值,如充电站功率)
  - Now-playing(媒体信息,来自消费控制上下文)
  - 宏面板(当前配置、快捷键映射)
  - 系统状态(固件版本等)
  - 配网状态(开发阶段显示 SSID 连接状态)

---

## 五、语音输入子系统

这是本项目的旗舰差异化功能。

**流程**:按住(或单击切换)语音键 → 麦克风采集(I2S DMA 双缓冲)→ VAD 端点检测 → **Opus 编码 → WSS 流式上传**云端 ASR(可选 LLM 润色/生成)→ 文本 → 注入(英文走 HID 扫描码;中文走厂商通道 + 客户端);**屏上显示"聆听 / 转写中 / 结果"并可在上屏前触摸确认或丢弃**,把误识别挡住。

**麦克风**:数字 MEMS(I2S/PDM)直接进 P4,板载 LMA3729T421-OA1 经 ES8311 编解码器 ADC 输入。

**编码与传输(MVP 决策)**:

- **音频在 P4 侧 Opus 编码**(官方 `esp_audio_codec` ≥ v2.4.0,明确支持 P4;S3 实测约 25% 单核 @48kHz,P4 @400MHz + PIE SIMD 更轻),12–24 kbps,带宽较裸 PCM(256 kbps)降约 10 倍——SDIO/esp-hosted 吞吐风险对上行基本失效。
- **传输首选 WSS 流式**:说话期间即持续上传(100–200ms 帧),松键即收尾,流式 ASR 首段转写约 300ms 级;HTTP 整段 POST(Whisper REST 风格)为简化回退,代价是整句缓冲延迟。
- **业界同款先例**:ElatoAI(OpenAI 官方 Cookbook 收录,ESP32-S3,Opus 12kbps + WSS)、小智 ESP32(Opus + WSS,明确支持 P4)、Willow / ESPHome 语音助手。

**ASR/LLM 三方案**:

| 方案 | 处理位置 | 需联网 | 电脑需软件 | 自由听写 | 备注 |
|---|---|---|---|---|---|
| **云端(设备侧发起)** ✓ MVP 选用 | 云(经 C6 Wi-Fi) | 是 | 仅中文需客户端 | **能** | **默认 = 流式 ASR**(Deepgram live / 讯飞 RTASR 等,WSS);LLM 仅在"润色/指令生成"模式串接;音频直入实时多模态(OpenAI Realtime ~$0.30+/min)可选但贵数倍且回传音频弃用;延迟 ~0.3–2s;有隐私与 API 成本 |
| **本地命令词(ESP-SR)** | P4/C6 | 否 | 否 | 不能,仅固定命令 | Espressif ESP-SR(WakeNet 唤醒 + MultiNet 命令词,支持中英);适合"进入听写/快捷指令"(二期) |
| **主机侧(经客户端转发)** | 电脑 | 否 | 是 | 能 | 设备经厂商通道把音频/触发交给客户端,由电脑侧模型转写并注入;可离线、中文最稳(二期可选) |

**MVP 选择**:云端 ASR/LLM(设备侧经 C6 Wi-Fi 发起)。理由:自由听写是核心卖点,本机离线无法实现(无 NPU);英文纯 HID 即可上屏,中文经客户端注入,两者均在 MVP 内。**默认管线 = 流式 ASR;LLM 后处理按需开启**——输出目标是打字文本,语音对话型多模态按分钟计费贵数倍且音频回复用不上,两段式(ASR→LLM)更省、可换供应商。

**文本→注入**:英文 → 直接 HID 扫描码;中文/Unicode → 厂商 HID 通道(§3.6)→ 自研客户端注入。**两条路径均为 MVP 范围。**

**RF 友好**:语音是**突发流量**,听写时不会并发高速游戏,故走 C6 Wi-Fi 做云端 ASR/LLM **不会**像持续 AirPlay 那样恶化共存——是 C6 较舒服的用法。ESP-NOW 遥测同为低频,三者时分可扛。

### 5.1 Wi-Fi 配网流程

| 方案 | 复杂度 | 说明 |
|---|---|---|
| **硬编码 SSID/密码**(MVP 开发用) | 最低 | sdkconfig 中硬编码,仅开发环境 |
| **USB 厂商通道配网**(产品首选) | 低 | 设备本就有线连电脑:客户端经厂商通道 CONFIG 帧下发 SSID/密码,屏显结果——无需手机/App |
| BLE 配网(C6 BLE + 手机 App) | 中 | C6 有 BLE,可用 NimBLE + 自定义 GATT service(备选) |
| SmartConfig(ESP-Touch) | 低 | 需手机端 App 发送配网包 |
| SoftAP + Web 配网 | 中 | C6 起 SoftAP,用户连热点后访问网页配网 |

**MVP 决策**:开发阶段用硬编码;产品阶段**首选 USB 厂商通道配网**(有线设备最自然,且客户端已是 MVP 组件),BLE 为无客户端场景的备选。

### 5.2 esp-hosted 回退方案

**已知问题**:`espressif/esp-hosted-mcu` Issue #184(标记 EHM-206)——入站 TCP 在约 88-105KB 后停滞。"88–105KB"与"SDIO 反压未处理"为 issue 报告方描述。**现状(2026-06 两轮核查,结论存疑)**:一轮经 GitHub API 查得该 issue 已于 2026-05-19 由报告者本人关闭、但**无关联 PR/修复版本记录**(v2.12.8 新增的 SDIO PSRAM 缓冲选项可能缓解症状);另一轮检索显示其仍为开放状态。两说并存,**一律按"未确认修复"对待,实施第一周即在最新版(≥2.12.9)上复测入站大流量**。

**同仓库其他未决缺陷(2026-06 核查均为开放)**:#167(SDIO 状态不可恢复崩溃 err 0x107,Waveshare/4D Systems 等多家硬件可复现,降 SDIO 频率无效)、#180(BLE 扫描约 90s 后停止——MVP 不用 BLE,不受影响)、#144(`sdio_rx_get_buffer` assert)。**#167 影响整条 SDIO 链路(含 ESP-NOW 桥接),P4→C6 心跳超时复位机制(§十五)是唯一恢复路径,MVP 必做。**

**影响(按 Opus 化后重估)**:上行经 Opus 12–24kbps 后仅 ~2–3 KB/s,**上行带宽不再受威胁**(裸 PCM 32KB/s 的"3 秒达 100KB 阈值"问题随默认编码方案消失);#184 为**入站**方向,主要暴露面是 LLM 长文本响应与 TLS 握手证书链下载;#167 则是全链路可用性问题。

**触发回退的判定条件**:

- TCP 吞吐 < 50 KB/s 持续 5 秒
- 单次 ASR 请求失败率 > 30%
- SDIO 通信延迟 > 500ms

**回退选项**(按优先级):

| 选项 | 说明 | 代价 |
|---|---|---|
| A: 分段上传 | 每 2 秒切一段,避开大块传输阈值 | 需服务端支持分段拼接;增加延迟(Opus 化后上行压力已大减,本选项主要针对入站/残余场景) |
| B: 仅本地 ESP-SR | 放弃云端 ASR/LLM,只做命令词识别 | 丧失自由听写能力 |
| C: UART 桥接降级 | C6 不经 SDIO,改 UART 传 ASR 数据(带宽降至 ~1Mbps) | 延迟增大,但避开 SDIO bug |
| D: 转 CM5/S31 迁移分支 | 停止在 P4+C6 规格内继续加回退；另见 [CM5-S31-INTEGRATION.md](CM5-S31-INTEGRATION.md) | RK3588S 直接联网与 S31 host protocol 独立验证，不把 S31 当作已兼容的 esp-hosted slave |

**MVP 实施**:默认管线(Opus + WSS 流式)本身已规避上行风险;入站若触发判定条件,先跑方案 A(分段)缓解,仍不稳则退方案 B 保底(MVP 验收仍可通过命令词演示语音能力,自由听写后置)。

---

## 六、ESP-NOW 数据交换子系统

核心诉求之一:键盘(C6)作为桌面 ESP-NOW 主节点,与其他硬件设备(从节点,如快充充电站,见 DESIGN-EXTENSIONS.md §六)低频交换数据,状态在 P4 屏上可视化、可经触摸下发指令。

### 6.1 实现位置(关键设计决策)

esp-hosted 把 C6 的 Wi-Fi 以标准 API 暴露给 P4,但 **esp_wifi_remote / esp-hosted-mcu 不透传 esp_now_* API**(已核实:截至 v2.12.9(2026-06),111 项 RPC 清单中无任何 ESP-NOW 条目,issue 区亦无相关 feature request)。两条路径:

| 路径 | 说明 | 评估 |
|---|---|---|
| A: API 透传 | P4 直接调 `esp_now_*`,esp-hosted RPC 转发到 C6 | **当前不可用**;仅当未来上游加入 ESP-NOW RPC 后可选 |
| B: C6 驻留 + Peer Data Transfer(**既定方案**) | ESP-NOW 收发逻辑驻留 C6 slave 固件;P4 ↔ C6 经 esp-hosted 官方 **Peer Data Transfer API** 交换**应用层载荷**(外设状态/指令),不暴露原始 esp_now API | **有官方现成机制与示例**(见下),非自造轮子 |

**Peer Data Transfer 实施细节(已核实)**:

- API(host/slave 两侧同形):`esp_hosted_send_custom_data(msg_id, data, len)` 发送 + `esp_hosted_register_custom_callback(msg_id, cb, ctx)` 接收,按 `uint32_t` 消息 ID 路由;单包实测上限约 **8166 字节**(以实际固件版本验证),对 ≤250B 的 ESP-NOW 载荷绰绰有余。
- slave 固件**本就是可扩展的 ESP-IDF 工程**(自编译自烧录,非闭源镜像),`slave/main/` 已内置 Kconfig 可选的并行应用示例(`example_http_client.c`/`example_mqtt_client.c`/`example_peer_data_transfer.c` 约 200 行)——ESP-NOW 胶水层照 `example_peer_data_transfer.c` 模板写:ESP-NOW `recv_cb` → 队列 → `esp_hosted_send_custom_data()` 上送 P4。
- 旧文档称 CustomRPC(v2.8.1 起,RPC ID 388 / 事件 789,protobuf),当前代码内名称为 `custom_data` / Peer Data Transfer,同一机制。

**MVP 决策:路径 B 为既定方案**;应用层报文格式(§6.3)与运输层解耦,未来上游若支持透传可平移到 A。

**故障隔离回退:UART 旁路**。SDIO 驱动存在未决缺陷(#167 状态崩溃 / #184 入站停滞,见 §5.2),载荷走 SDIO 意味着 ESP-NOW 与 Wi-Fi 同生共死。若实测 SDIO 不稳,把 ESP-NOW 载荷改走 P4↔C6 **备用 UART**(921600 波特 ≈ 90KB/s,长度前缀或 COBS 帧),与 SDIO 完全解耦——Wi-Fi 路径故障时外设遥测仍存活。Osptek 板引出 9 个 C6 GPIO,飞线可行;自制 PCB 时预留这对 UART 走线。

### 6.2 信道与共存约束

- ESP-NOW 锁定 C6 **当前 Wi-Fi 信道**;外设从节点须同信道——配对时由键盘告知信道,AP 换信道后须重新同步(心跳丢失触发重扫)。
- 与云端 ASR/LLM 流量共享 C6 单射频:二者均为突发/低频,时分可扛(见 §十七 风险表)。
- 单包 ≤250B(ESP-NOW v2.0 可达 1470B);MVP 报文设计保持 ≤200B,不依赖 v2.0。

### 6.3 报文与节点管理

- **角色**:键盘 C6 = 主节点(1 个);外设 = 从节点(加密 peer 上限 17,MVP 仅 1–2 个)。
- **应用层报文**(ESP-NOW 载荷内):`ver(1B) + type(1B) + seq(1B) + len(1B) + payload(≤196B)`;type:`0x01` 遥测上报 / `0x02` 指令下发 / `0x03` 配对 / `0x04` 心跳。
- **周期**:从节点 1–5s 遥测上报;10s 心跳,连续 3 次丢失判定离线(屏上置灰)。
- **安全**:启用 ESP-NOW PMK/LMK 加密;配对流程 = 键盘屏上进入配对模式 → 广播配对帧 → 从节点应答 → 交换 LMK 入表。
- **实现注意(C6 侧)**:`esp_now` 收发回调运行于 Wi-Fi 任务上下文,**不得阻塞**——回调内只入 FreeRTOS 队列,由独立任务出队后走 Peer Data Transfer/UART 上送 P4;peer 配置 `channel = 0`(自动跟随 STA 当前信道)、`ifidx = WIFI_IF_STA`。

### 6.4 P4 侧呈现

- `task_espnow_bridge`(见 §十二)经 RPC 收发载荷,维护外设状态表 → UI 状态机 → 屏显(在线/离线/遥测值)。
- 触摸屏可向外设下发指令:触摸 → UI 状态机 → RPC → C6 → ESP-NOW 从节点。

### 6.5 验收口径

与 ≥1 个外设节点(可用第二块 C6 或 S31 开发板模拟)双向收发:1 小时内遥测帧丢包 < 5%,指令下发往返 < 200ms,离线检测 < 30s,屏显状态正确。

---

## 七、芯片规格

### 7.1 ESP32-P4(主控)

- **CPU**:双核 RISC-V HP @最高 400MHz(额定上限;v1.3 数据手册公开 CoreMark 在 360MHz 实测,双核约 2490 CoreMark,6.92 CoreMark/MHz)+ LP @40MHz(RV32IMAC,带 FPU/P 扩展/PIE)。
- **内存**:768KB L2MEM、**8KB SPM(Scratchpad,非 TCM)**、32KB LP SRAM、128KB HP ROM(另 16KB LP ROM);片内 PSRAM 16/32MB(OPI/HPI),外部最大 64MB 虚拟地址空间。优化 memcpy 实测 **~185 MB/s**(社区数据,官方 datasheet 未列)。
- **外设**:
  - USB 2.0 HS OTG + FS(每微帧 4+4,16 host channel)
  - MIPI-DSI 2-lane ×1.5Gbps(DPHY v1.1)/MIPI-CSI
  - PPA(像素处理加速器,缩放/旋转/混合)
  - I2S(音频 TX/RX,用于麦克风采集与功放输出)
  - SDIO 3.0 Host(esp-hosted 连接 C6)
  - H.264 硬件编码(datasheet 明示;解码为推断,应为软件)+ JPEG 硬件编解码
  - 双 ADC、2D-DMA(3 TX + 3 RX)、GDMA-AHB
  - **无原生无线**
- **电气**:
  - HP VDD_IO 1.65–3.6V
  - MIPI D-PHY 专用 **2.25–2.75V(典型 2.5V)**
  - 不含外设**最低供电 380mA**(官方)
  - 叠加显示/USB/PSRAM 峰值远超,须留裕量
  - 芯片级深睡为 µA 级;整板功耗官方未公布确定值

### 7.2 ESP32-C6(Wi-Fi 协处理器)

- **CPU**:RISC-V HP @160MHz + LP @20MHz
- **内存**:512KB SRAM
- **无线**:Wi-Fi 6(仅 2.4GHz)、BLE 5.3、802.15.4
- **射频**:**单一共享 2.4GHz 射频与天线**(Wi-Fi/BLE/802.15.4 分时复用同一物理射频;ESP-NOW 走 Wi-Fi MAC,同射频)
- **无蓝牙经典/A2DP**(ESP32 全系仅初代 ESP32 支持蓝牙经典;C6 为 BLE-only)
- **无可做 HID 的原生 USB**(仅 USB-Serial/JTAG)
- **共存**:
  - 功能 `CONFIG_ESP_COEX_SW_COEXIST_ENABLE`:Kconfig 中 `default y`(两栈同启时自动置位)
  - ESP-IDF 官方文档仍要求用户**在 menuconfig 中确认已启用**
  - 仲裁为**动态时分**(非固定 Wi-Fi>BLE>802.15.4);802.15.4 空闲 RX 优先级最低
- **MVP 职责**:Wi-Fi 网卡(esp-hosted)+ ESP-NOW 节点(见 §六);不跑 BLE/802.15.4(MVP 不涉及)

### 7.3 芯片间通信(MVP 相关)

| 链路 | 物理层 | 用途 |
|---|---|---|
| P4 ↔ C6 | SDIO 4-bit @40MHz(esp-hosted)+ SPI/UART(控制;UART 兼作 ESP-NOW 旁路回退) | P4 借 C6 上网(云端 ASR/LLM);ESP-NOW 载荷经 Peer Data Transfer API;对上层如标准 ESP-IDF Wi-Fi API(lwIP/TLS 在 P4 侧) |
| P4 ↔ PC(有线) | USB-HS(480 Mbps) | 复合 HID(含厂商通道) |

esp-hosted SDIO 须严格走线(走内层、地平面包地、限长、避免跨层)。Osptek 开发板已布好此段走线。

---

## 八、MVP 硬件底座

第一期 MVP 不必自制 PCB,可直接用现成的 P4+C6 一体开发板 + MIPI AMOLED 屏做原型。

**选定硬件**:

- **核心板**:Osptek **ESP32-P4-Module(OspreyPi-P4C6)** —— P4 + C6 同板;底板 V1.3 兼容 P4C6 与 P4C5 核心板。
- **屏**:Yuying **AM319M262928ZS** —— 3.19" AMOLED,262×928,MIPI 接口,30-pin,带电容触摸(驱动 IC 为 ICNA3312 或兼容 CO6300 / 触控 CST3530)。
- **官方转接板**:用于把该屏接到模块的 30-pin DSI。

**MVP 需求覆盖(开箱即满足 A–E)**:

| 需求 | 底座提供 |
|---|---|
| (A) 有线 USB-HID | **TS3USB221AR** 把 P4 真 USB 2.0 HS(480Mbps)引到 Type-C/USB-A,可跑 TinyUSB HID;调试用 CH343P USB-串口为独立另一路 |
| (B) C6 联网 + ESP-NOW | 核心板自带 C6,引出 9 个 C6 GPIO,可经 esp-hosted 联网做云端 ASR/LLM,并跑 ESP-NOW |
| (C) 屏幕 | 板载 30-pin 0.5mm **DSI** 接口 + **SY7200** 背光升压;P4 MIPI-DSI 驱 262×928 绰绰有余;**已拿到厂商 MIPI 初始化代码** |
| (D) 语音输入 | **板载硅麦克风 LMA3729T421-OA1 + ES8311 编解码 + NS4150 功放 + 扬声器座**(采集与播放都现成) |
| (E) 按键/扩展 | 2×2×17 排针引出 **55 个 P4 GPIO + 9 个 C6 GPIO**,另有 RESET/BOOT 键、TF 卡槽 |

**显示驱动状态**:已拿到该屏厂商提供的 MIPI-DSI 初始化代码。接口确为 MIPI-DSI(文件名带 QSPI 但内容是 MIPI 版,取用勿错)。驱动 IC 为 ICNA3312(Chipone)或 CO6300(同厂兼容型号)。

**剩余上屏工作**(标准 P4 MIPI 面板移植,非阻塞):

1. 把初始化序列移植成 ESP-IDF `esp_lcd_mipi_dsi` 自定义面板驱动
2. 向 Osptek/BOE 索取 DSI lane 数(262×928 大概率 1-lane)与视频时序(HSA/HBP/HFP/VSA/VBP/VFP + DSI bit clock)——**阻塞项**
3. 像素格式选 RGB565 省带宽
4. 把 RST / TE 接到 P4 GPIO(转接板飞线引出)
5. 触摸 CST3530(I2C)——**MVP 必选**(屏幕交互诉求)

**可复用的开源参考(显示)**:全网/GitHub 搜索结论——**无现成的 ICNA3312 / 262×928 驱动**(搜 ICNA3312 只出 Chipone 的触摸 ICN8505、桥接 ICN6211,非本 AMOLED 驱动),但 MIPI-DSI 面板上屏是成熟流程,可照搬以下脚手架,把初始化序列填进去:

- **Espressif 官方 `esp_lcd` MIPI-DSI 框架/例程**(esp-idf `peripherals/lcd/mipi_dsi`):标准做法 = `esp_lcd_new_dsi_bus` → `esp_lcd_new_panel_io_dbi`(DBI 通用命令口,用 `esp_lcd_panel_io_tx_param` 逐条发 `RFE/Rxx`)→ `esp_lcd_new_panel_dpi`(视频流)→ LVGL。
- **OLIMEX ESP32-P4-DevKit `mipi_dsi` 例程**:用 **1 data lane + 1 clock lane** 的通用 MIPI 面板(ST7701S),最接近本屏大概率的 1-lane 配置,适合做模板。
- **Nicolai-Electronics `esp32-component-st7701` / `mipi-dsi-abstraction`**:干净的 esp_lcd 面板组件结构,照着新建 `esp_lcd_icna3312`。
- **embenix `ESP32-P4-DSI-Support-Hub`、jitenshap `esp32p4_mipi_dsi_hello_world`、esp-arduino-libs `ESP32_Display_Panel`**:P4 + LVGL 上屏样板。
- **触摸 CST3530**:Hynitron CST3xx 系列 I2C,可参考社区 chipone/cst3xx 触摸驱动。

**两条 AMOLED 接口路线(均保 P4 + bar 形态)**:

- **Path A — MIPI-DSI(本方案,沿用 Osptek 整套)**:262×928 bar 经 Osptek 模块 DSI + 转接板。已有模块+转接板+ICNA3312 屏+init code,驱动半定制(ICNA3312 无开源,纯自定义移植),省硬件。
- **Path B — QSPI AMOLED(驱动最省力,备选)**:**ESP32-P4 自身也带 SPI/QSPI(GPSPI),不限 MIPI** —— 故 `espressif/esp_lcd_sh8601`、`kodediy/esp_lcd_co5300`、RM67162/RM690B0 等**成熟 QSPI AMOLED 驱动可直接用在 P4 上**,只是改接 P4 GPIO、不走模块 DSI 口,且需面板的 QSPI 变体。262×928@30–60fps RGB565 在 QSPI 80MHz 带宽内。
  - 换 Tailor Pixels RM690C0 QSPI 版面板(datasheet `TOH323XVT-01C.pdf`,触摸 ZT2628),复用 RM690B0/RM67162 现成驱动。
  - QSPI 接线(信号级):CS / CLK / D0–D3;控制 = RST、TE(可选);触摸 = I2C(SDA/SCL/INT/RST);电源 = VCI/VDDIO + AMOLED 升压。
  - esp_lcd 配置:`*_PANEL_BUS_QSPI_CONFIG(clk,d0,d1,d2,d3,…) → spi_bus_initialize(SPI2_HOST,…,SPI_DMA_CH_AUTO) → panel_io_spi(cs,…) → vendor_config.flags.use_qspi_interface=1, bits_per_pixel=16`。
  - **关键权衡**:Osptek 模块 30-pin 口是 DSI(MIPI),QSPI 面板插不进、也用不上 Osptek 转接板——走 QSPI 要换面板 + 自行解决 BTB 母座对接 + 接 P4 GPIO 头 + 处理面板电源/升压。**省驱动、费硬件**。

**面板货源与更优替代**:262×928 3.19" MIPI bar AMOLED 是多家通用件——Fannal(型号 FN0320E002A)、Tailor Pixels、Osptek/Yuying,及 Alibaba/Made-in-China 众多厂。**关键:同一面板不同厂用不同驱动 IC**:

- **Osptek/Yuying(本方案)= ICNA3312**:已有 MIPI 初始化代码,且已与 Osptek 模块/转接板机械电气匹配;但**无开源驱动**(孤儿 IC),纯自定义移植。
- **Tailor Pixels = Raydium RM690C0**(+ ZT2628 触摸):RM690C0 支持 MIPI/QSPI 多接口,且 Raydium RM69xx 家族(RM67162/RM690B0)有**成熟开源 esp_lcd/LVGL 驱动**(LilyGo T-Display-S3-AMOLED、`esp-lcd-panel-rm67162`、`RM690B0` Micropython/Rust 等)、寄存器手册公开,移植参考远多于 ICNA3312。**代价**:换厂可能不再适配 Osptek 转接板,需自行解决到 P4 DSI 的对接。

**无现成的"ESP32-P4 + bar AMOLED"整合板**:P4 现成显示板都是圆形/矩形 IPS。**完全开箱即用的 bar 显示只在 ESP32-S3 + QSPI**(LilyGo T-Display-S3-Long 180×640 AXS15231B,驱动+触摸现成)——但那放弃了 P4,不适用本 MVP。**结论**:P4 上的 bar AMOLED 注定半定制。若坚持 Osptek 全套,则接受 ICNA3312 纯自定义驱动(已有 init code,可行)。

**落地注意**:接电脑用承载 P4-USB 的 Type-C/USB-A 口(勿接成 CH343 调试口);烧录开关:上=P4,下=C6(RS2233 模拟开关)。

---

## 九、引脚分配表

| 功能域 | 信号 | P4 GPIO | 备注 |
|---|---|---|---|
| MIPI-DSI | DSI_CLK_P/N, DSI_DATA0_P/N | 固定引脚(P4 DSI 专用) | 大概率 1-lane |
| MIPI-DSI | RST | TBD | 转接板飞线 |
| MIPI-DSI | TE | TBD | 防撕裂同步 |
| MIPI-DSI | BL_EN(背光) | TBD | SY7200 控制 |
| I2C(音频+触摸) | SDA, SCL | TBD | ES8311 + CST3530 共享 |
| I2C | INT(触摸) | TBD | CST3530 中断(MVP 必选) |
| I2S(音频) | BCLK, LRCK, DOUT, DIN | TBD | ES8311 |
| SDIO(esp-hosted) | CMD, CLK, D0-D3 | 固定引脚(P4 SDIO 专用) | 板上已连 C6 |
| USB-HS | D+, D- | 固定引脚(P4 USB 专用) | 经 TS3USB221AR 到 Type-C/A |
| 矩阵行 | ROW[0..N] | TBD | 数字机械轴(可后置) |
| 矩阵列 | COL[0..M] | TBD | 数字机械轴(可后置) |
| 语音键 | GPIO | TBD | 低电平触发 |
| 状态 LED | GPIO | TBD | 连接/语音状态 |

**待办**:向 Osptek 索取底板原理图,确认 SDIO/DSI/USB 固定引脚号,据此分配剩余 GPIO。

---

## 十、I2C 地址映射

| 总线 | 设备 | 7-bit 地址 | 功能 |
|---|---|---|---|
| I2C0 | ES8311 | 0x18 | 音频编解码器 |
| I2C0 | CST3530 | 0x5A | 触摸控制器(MVP 必选) |

**注意**:ES8311 地址可通过 AD0 引脚修改(0x18/0x19),以底板实际接线为准。

**建议**:音频/触摸共用 I2C0;若后续加传感器,可分配 I2C1。I2C0 速率建议 400kHz(Fast Mode),满足 ES8311 寄存器配置与 CST3530 触摸坐标读取需求。

---

## 十一、功率预算

| 组件 | 典型电流 (mA) | 峰值电流 (mA) | 来源 |
|---|---|---|---|
| ESP32-P4 芯片(不含外设) | ~300 | 380+ | 典型 ~300mA(官方未公布;380mA 为最低供电能力) |
| ESP32-C6 Wi-Fi 活跃 | ~50 | ~205 | C6 datasheet(典型 50mA @0dBm;峰值 205mA) |
| AMOLED 面板(262×928) | ~20 | ~50 | 面板规格书(待实测) |
| ES8311 编解码器 | ~10 | ~30 | ES8311 datasheet |
| NS4150 功放 + 喇叭 | ~5 | 50-300 | 视音量 |
| SY7200 背光升压 | ~10 | ~30 | 视亮度 |
| MEMS 麦克风 | ~1 | ~2 | — |
| PSRAM 活跃访问 | ~30 | ~100 | 社区实测 |
| DCDC 损耗(~85% 效率) | +15% | +15% | — |
| **合计** | **~420** | **~850-1100** | — |

**USB-C 电流协商**:

- USB 2.0 标准:500mA — **不够**(峰值超 850mA)
- USB-C 默认(无 PD):1.5A — **够用**
- USB-C PD 5V/3A:3A — 充分裕量

**结论**:MVP 必须确保 USB-C 协商到 1.5A 以上。Osptek 底板的 USB-C 口应已配置 CC 电阻(5.1kΩ 下拉),默认 1.5A。到手后实测确认。

**电源轨设计**(当前底板已实现):

- USB-C 5V → DCDC 3.3V(P4 VDD_IO / C6 / 编解码)
- 3.3V → LDO 2.5V(MIPI D-PHY)
- 3.3V → DCDC 核心轨(P4 VDD_HP)

每入口 10µF + 100nF 去耦。

**MVP 验收门限**:整板峰值功耗实测 < 1.2A(含 20% 裕量),否则需检查 DCDC 效率或降低背光/音量。

---

## 十二、固件架构与任务调度

### 12.1 FreeRTOS 任务清单

| 任务名 | 核心 | 优先级 | 栈大小 | 职责 |
|---|---|---|---|---|
| `task_hid_report` | Core 1 | 最高(20) | 4KB | HID 报告组装 + USB 发送,1ms 周期 |
| `task_matrix_scan` | Core 1 | 高(18) | 4KB | 矩阵扫描 + 去抖,0.5ms 周期(矩阵可后置) |
| `task_usb_device` | Core 1 | 高(17) | 8KB | TinyUSB 设备栈事件处理(含厂商通道收发) |
| `task_voice_capture` | Core 1 | 高(16) | 8KB | I2S DMA 双缓冲管理 + VAD |
| `task_cloud_llm` | Core 0 | 中(13) | 24KB | 音频上传 + ASR/LLM 结果接收 + 文本分发;**含 P4 侧 mbedTLS,栈按握手实测调整** |
| `task_lvgl_render` | Core 0 | 中(12) | 16KB | LVGL 渲染 + 触摸输入,33ms 周期 |
| `task_esp_hosted` | Core 0 | 中(11) | 8KB | SDIO 通信管理 + Wi-Fi 状态 |
| `task_espnow_bridge` | Core 0 | 中(10) | 4KB | 经 Peer Data Transfer(或 UART 旁路)收发 ESP-NOW 载荷,维护外设状态表 |
| `task_ui_state` | Core 0 | 低(8) | 4KB | UI 状态机(语音状态/连接状态/外设状态/菜单) |
| `task_watchdog` | Core 0 | 低(5) | 2KB | 心跳 + 看门狗喂狗 |

### 12.2 核心分配策略

- **HP Core 1 = 强实时**:HID 报告、矩阵、USB 设备栈、语音采集。不放任何网络/TLS/渲染负载,保证 1ms HID 周期不被挤占。
- **HP Core 0 = 网络 + UI**:lwIP/TLS(随调用任务执行)、云端上传、esp-hosted、ESP-NOW 桥接、LVGL、状态机、看门狗。
- **已知权衡**:ASR 上传(TLS 加密)与 LVGL 渲染同核,听写瞬间 UI 可能掉帧——可接受(HID 完整性优先);若实测掉帧明显,把上传分块降优先级。
- **LP Core**(40MHz):待机维持 + RTC 唤醒(低功耗模式时使用)。

Core 0 与 Core 1 之间通过 FreeRTOS 队列(`xQueueSend`/`xQueueReceive`)与事件组(`xEventGroupSetBits`/`xEventGroupWaitBits`)通信,避免直接共享可变状态。

### 12.3 中断优先级(P4 RISC-V CLIC)

| 优先级 | 中断源 | 说明 |
|---|---|---|
| 最高 | USB SOF | 125µs 周期,不可丢失 |
| 高 | I2S DMA 完成 | 音频双缓冲切换 |
| 高 | SDIO DMA | esp-hosted 数据就绪 |
| 中 | GPIO 边沿 | 语音键按下/释放;触摸 INT |
| 低 | 定时器 | LVGL 刷新、矩阵扫描周期 |

### 12.4 DMA 使用策略

| DMA 控制器 | 通道 | 用途 |
|---|---|---|
| 2D-DMA(3 TX) | TX0 | LVGL 帧缓冲 → MIPI-DSI |
| 2D-DMA(3 RX) | RX0 | PPA 渲染输出 |
| GDMA-AHB | CH0 | I2S RX(麦克风数据 → 环形缓冲) |
| GDMA-AHB | CH1 | I2S TX(音频播放数据 ← 缓冲) |
| GDMA-AHB | CH2 | ADC 连续采样(若用霍尔轴;MVP 不用) |
| SDIO DMA | — | esp-hosted 数据搬运 |

### 12.5 内存映射

| 区域 | 容量 | 用途 |
|---|---|---|
| L2MEM(768KB) | 200KB | 代码段 + .data + .bss |
| L2MEM | 96KB | FreeRTOS 任务栈(10 任务,合计约 82KB,留裕量) |
| L2MEM | 100KB | USB DMA 描述符 + HID 报告缓冲 |
| PSRAM(16/32MB) | ~1MB | LVGL 帧缓冲(262×928×2 bytes RGB565 × 2 双缓冲 ≈ 950KB) |
| PSRAM | ~320KB | 音频环形缓冲(16kHz/16bit × 5s × 2 = 320KB) |
| PSRAM | ~512KB | ASR 音频上传缓冲 |
| SPM(8KB) | 8KB | ISR 向量 + 关键中断处理代码(零等待) |

**关键约束**:SPM(Scratchpad Memory)8KB 为 P4 特有的紧耦合内存,访问零等待。把 USB SOF ISR 和 I2S DMA 完成 ISR 的处理代码放入 SPM,确保 125µs 周期中断不被缓存缺失拖累。

---

## 十三、物理键矩阵

物理键盘是标准件、非本项目难点,且**可后置——不在 MVP 验收门槛内**(软输入为主,硬键为辅)。**不追 8000Hz,用标准数字机械轴**。

**主线(纯有线):矩阵单主控 = P4。** 矩阵行列直接由 P4 扫描,**无需 TMUX1574 双主控隔离**(只有一个主控,不存在寄生漏电/ghosting 的双主控问题)。TMUX1574 双主控隔离仅在可选无线扩展(P4 有线 + nRF54L15 无线共享同一矩阵)时才需要。

**矩阵方案**:标准数字机械轴,行列 GPIO 直驱,P4 以 0.5ms 周期扫描(2000Hz 扫描率,保证 1000Hz HID 报告率),硬件去抖(典型 5ms 去抖窗)。

### 13.1 关于霍尔模拟轴(不推荐)

若坚持霍尔轴:P4 ADC 上限约 100Ksps(~10µs/次),80 键全扫描 = 800µs ≫ 8000Hz 的 125µs 周期,**全键 8000Hz 数学上不可行**;只能"部分扫描 + 主键区 8000Hz + 全键 1000Hz"硬凑。本项目既不追采样率,**直接用数字机械轴消除该问题**。

---

## 十四、启动序列

1. **P4 上电** → 电源轨稳定(5V → 3.3V DCDC → 2.5V LDO for D-PHY)
2. **P4 Boot ROM** → 二级引导(Secure Boot v2 验签)→ 应用固件
3. **P4 外设初始化**(可并行):
   - GPIO matrix 配置(行列引脚方向、上下拉)
   - I2C 总线初始化 → ES8311 寄存器配置(采样率、增益、路由)→ CST3530 触摸就绪
   - I2S 初始化(DMA 双缓冲配置)→ DMA 启动
   - MIPI-DSI 初始化 → 发送 ICNA3312 初始化序列 → 背光点亮
4. **LVGL 初始化** → 首帧渲染(显示 boot logo)
5. **USB 设备启动** → TinyUSB 初始化 → 首次枚举(可不等 Wi-Fi)
6. **C6 启动/复位** → C6 固件启动 → esp-hosted SDIO 握手
7. **Wi-Fi 连接** → C6 连 AP(MVP 开发阶段硬编码 SSID)→ P4 侧获取 IP
8. **ESP-NOW 初始化**(C6 侧)→ 锁定当前 Wi-Fi 信道 → 加载已配对外设表 → P4 侧 `task_espnow_bridge` 就绪
9. **矩阵扫描启动**(若装配矩阵)→ 去抖状态机就绪
10. **语音子系统就绪** → VAD 引擎启动,等待语音键
11. **UI 状态机就绪** → 显示"已连接"状态(USB/客户端/Wi-Fi/外设)

**并行窗口**:步骤 3 的各外设初始化可并行(分别在不同 FreeRTOS 任务或顺序初始化中);步骤 5-8 可并行(USB 枚举不依赖 Wi-Fi)。

**总启动时间目标**:< 3 秒(上电到 USB HID 可用)。Wi-Fi 连接可能需要额外 2-5 秒(视 AP 响应),但不阻塞 HID 功能。

---

## 十五、电源域与看门狗

- **USB-C 总线供电**(常驻桌面设备),不建议纯电池。
- **电源轨**:USB-C 5V → DCDC 3.3V(P4 VDD_IO / C6 / 编解码)→ LDO 2.5V(MIPI D-PHY,若用 MIPI 屏)→ 核心轨。C6 Wi-Fi 峰值 180–240mA。每入口 10µF + 100nF 去耦。
- **看门狗 + 心跳**:各芯片独立 WDT;P4 每秒向 C6 心跳,连续 3 次无回复触发复位;链路超时进安全模式(仅 HID 功能,禁用 Wi-Fi/语音/ESP-NOW)。**此机制为 MVP 必做项**——对 esp-hosted #167 类 SDIO 状态不可恢复崩溃,复位 C6 是唯一恢复路径(见 §5.2)。

---

## 十六、安全

- **OTA/安全启动**:固件 ECDSA-P256 签名验签;版本号写 eFuse 防回滚;P4/C6 启用 Secure Boot v2。
- **主机客户端(MVP)**:厂商 HID 通道仅传文本/配置,最小权限;客户端**开源**以建立信任(键盘类设备隐私敏感)。
- **ESP-NOW**:启用 PMK/LMK 加密,配对密钥不明文广播(见 §6.3)。
- **云端凭据**:ASR/LLM API key 存 NVS 加密分区,不进固件镜像。

---

## 十七、风险评估(MVP 相关)

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 中文无法纯 HID 上屏 | 高(确定) | 低 | MVP 即配自研客户端经厂商通道注入(§3.6);未装客户端时英文功能完整 |
| 自由听写依赖云(无离线) | 高(确定) | 中 | 云端 ASR/LLM 为主;本地 ESP-SR 仅命令词(二期);或主机侧转写(二期) |
| esp-hosted SDIO 未决缺陷(#184 入站停滞 / #167 状态崩溃) | 中 | 高 | Opus 化后上行压力消除;入站触发条件:TCP 吞吐 < 50KB/s 持续 5s / ASR 失败率 > 30% / SDIO 延迟 > 500ms,回退:分段 → 仅本地 ESP-SR → UART 桥接;**心跳超时复位 C6 必做(§十五)**;实施第一周在 ≥2.12.9 上复测。CM5/S31 是独立迁移分支，不作为 P4+C6 的运行时回退 |
| ESP-NOW 无法经 esp-hosted 透传 | 高(已核实,v2.12.9 无此能力) | 低 | 既定方案 = C6 驻留 + 官方 Peer Data Transfer API(有现成 slave 示例,§6.1);SDIO 不稳则 UART 旁路 |
| macOS 客户端 vendor HID 枚举异常(hidapi #266) | 低–中 | 中 | 真机尽早验证;失败启用剪贴板回退通道;需在 UX 中引导 Input Monitoring + Accessibility 两项授权(§3.6) |
| C6 单射频多负载(Wi-Fi + ESP-NOW)争用 | 中 | 低 | 均为突发/低频;ESP-NOW 锁 Wi-Fi 信道,时分可扛;遥测丢帧由心跳/重发兜底 |
| DSI 视频时序未获取 | 中 | 高 | 阻塞显示驱动开发;尽早向 Osptek/BOE 索取 HSA/HBP/HFP/VSA/VBP/VFP + bit clock |
| 触摸 CST3530 无现成 ESP-IDF 驱动 | 低 | 中 | 参考社区 cst3xx 驱动自写 I2C 轮询/中断读取(MVP 必选项,提前验证) |
| ESP-IDF P4 API 变动频繁 | 中 | 中 | 锁定 ESP-IDF 版本(≥ 5.3),跟踪 release notes |

---

## 十八、BOM 与工程量估算

### 18.1 BOM 估算(量产参考)

> MVP 原型阶段直接购买现成 Osptek ESP32-P4-Module(P4C6)+ Yuying 3.19" AMOLED + 官方转接板,无需按下表逐件采购。

| 项目 | 估算 (USD) |
|---|---|
| ESP32-P4 | $4–5 |
| ESP32-C6 模块 | $2–4 |
| AMOLED 屏(3.19" 262×928 MIPI) | $8–15 |
| 数字 MEMS 麦克风 | $0.5–1.5 |
| I2S 编解码器(后期音频,ES8388/PCM5102A) | $1–3 |
| PSRAM/flash | $2–4 |
| PCB/天线/被动件/连接器 | $8–15 |
| **键盘本体合计(主线有线)** | **约 $26–48** |
| *可选无线扩展:Nordic nRF54L15(键盘端)* | *~$4.15* |
| *可选无线扩展:dongle(nRF52840 + USB + PCB)* | *约 $6–10* |
| *可选:矩阵双主控 TMUX1574(仅无线扩展)* | *$1–2* |

> 数字机械轴成本最低;若改霍尔轴(80 颗 DRV5055 约 $32)BOM 显著上升。

### 18.2 工程量估算(人月)

| 模块 | 阶段 | 估算 |
|---|---|---|
| 有线 HID(P4 USB)+ 复合 HID(键盘/消费/鼠标/厂商) | MVP | 2–3 |
| P4↔C6 esp-hosted Wi-Fi(云端 ASR/LLM 联网) | MVP | 1.5–2 |
| 屏 UI + 触摸(P4 + LVGL + CST3530) | MVP | 2–3 |
| 语音输入(采集 + 云端 ASR/LLM + 文本注入 + 屏确认) | MVP | 3–4 |
| ESP-NOW 数据交换(C6 节点 + RPC 桥接 + 外设样例) | MVP | 1–1.5 |
| 主机客户端(中文 Unicode 注入 + 厂商通道协议,跨平台) | MVP | 1.5–2.5 |
| **MVP 合计** | — | **约 11–16 人月** |
| 二期体验完善(ESP-SR 唤醒/命令词 + 宏引擎 + BLE 配网) | 二期 | 1.5–2.5 |
| ESP-NOW 生态扩展(多外设 + 充电站对接) | 三期 | 1–2 |
| 有线音频 UAC(复合声卡端点 + I2S 输出) | 四期 | 0.5–1.5 |
| 无线 Nordic 专用射频(nRF54L15 + nRF52840,配对/跳频/重连) | 可选扩展 | 3.5–4.5 |
| 有线/无线切换 + 矩阵 TMUX1574 隔离 | 可选扩展 | 1.5–2 |
| AirPlay(专用模块/路线 A + 键盘集中配网) | 可选扩展(无线) | 3–4 |
| RF 共存调试(仅无线扩展:Nordic + AirPlay + C6) | 可选扩展 | 3–5 |
| 整机集成测试 | 全程 | 2–3 |
| **全程合计(含扩展)** | — | **约 27–40 人月** |

**触发改设计的阈值**:
1. 开 AirPlay 时 C6 的云端 ASR/LLM / ESP-NOW 受扰显著 → 加强天线隔离与 PTA,或 AirPlay 改走路线 A(只用 C6 一颗射频)
2. ~~中文为硬需求 → 主机助手提前至 MVP~~ **已落实**:主机客户端纳入 MVP
3. 仅当做可选无线键盘扩展、且要 4000/8000Hz → dongle 须换 USB-HS 芯片(nRF52840 不够)

---

## 十九、验收基准

MVP(第一期,有线)验收门槛:

| 验收项 | 基准 |
|---|---|
| 有线 USB HID 枚举 | P4 USB 插任意电脑免驱枚举为复合 HID(键盘 + 消费控制 + 鼠标 + 厂商通道) |
| ASCII 文本注入 | 软输入(屏幕 UI/宏)或语音模式下,ASCII 文本稳定上屏,无丢键/乱码 |
| 中文/Unicode 注入 | 经厂商通道 + 自研客户端,中文文本稳定上屏;未装客户端时屏上明确提示 |
| C6 esp-hosted 联网 | P4 借 C6 做 Wi-Fi 网卡,能稳定访问云端 ASR/LLM 服务(HTTPS 请求成功) |
| 语音输入跑通 | 语音键 → 云端 ASR/LLM → 英文文本经 HID 上屏;屏上显示聆听/转写状态,触摸确认/丢弃 |
| ESP-NOW 数据交换 | 与 ≥1 外设节点双向收发:1h 遥测丢包 < 5%,指令往返 < 200ms,离线检测 < 30s,屏显正确 |
| 屏 UI 与触摸 | 显示连接/语音/外设状态,帧率 ≥ 30fps;触摸可切页、确认/丢弃转写结果 |
| 启动时间 | 上电到 USB HID 可用 < 3 秒 |
| 峰值功耗 | 整板峰值 < 1.2A(USB-C 1.5A 协商下,含 20% 裕量) |

> 物理键矩阵不在 MVP 验收门槛内(可后置标准件,见 §十三)。

---

## 二十、外部依赖清单

| 依赖 | 所需版本 | 当前状态 | 风险 |
|---|---|---|---|
| ESP-IDF | ≥ 5.3(esp-hosted-mcu 要求;当前稳定 5.5.3 / 6.0.1) | 已确认版本约束 | 中 — P4 API 仍在演进,锁版本 |
| esp-hosted-mcu | ≥ 2.12.9(2026-06-08,经 ESP Component Registry 分发;3.0.0-rc1 预发布) | 已核实:无 ESP-NOW 透传 → 走 §6.1 路径 B(Peer Data Transfer API,自 v2.8.1,有 slave 示例);#184 状态存疑、#167 开放,需复测 | 高 — 直接影响语音与 ESP-NOW 两大功能 |
| TinyUSB | ESP-IDF 内置版本 | 复合 HID(4 接口)需验证;UAC 验证延至四期 | 中 |
| LVGL | 8.x 或 9.x | 待选定 | 低 — 两版本均有 esp_lcd port |
| Osptek BSP | Board config for ESP-IDF | 待确认是否提供 | 中 — 无 BSP 则需自编 board config |
| usb_device_uac | Espressif component | **四期再验证**(MVP 不含 UAC) | 低(已移出 MVP) |
| ICNA3312 datasheet | 完整寄存器手册 | 未获取(仅有 init code) | 中 — 调试时可能需要 |
| CST3530 驱动 | ESP-IDF 组件 | 待确认是否有现成驱动(MVP 必选) | 中 — 无现成则参考 cst3xx 自写 |
| DSI 视频时序 | HSA/HBP/HFP/VSA/VFP + bit clock | 待向 Osptek 索取 | 高 — 阻塞显示驱动开发 |
| esp_audio_codec(Opus 编码) | ≥ 2.4.0(明确支持 P4) | 已核实组件与 P4 支持 | 低 — S3 实测 ~25% 单核,P4 + PIE 更轻 |
| 云端 ASR/LLM 服务商 | 流式 WSS ASR(Deepgram live / 讯飞 RTASR 等)为默认;LLM 后处理按需;实时多模态为可选 | 待选定 | 中 — 延迟/成本/中文支持差异大 |
| 主机客户端依赖 | hidapi + 分平台注入(SendInput / CGEvent 分块 / XTEST+XKB / zwp_virtual_keyboard_v1)+ 剪贴板兜底 | 自研,各路径均有成熟先例(espanso/wtype/enigo) | 中 — macOS 双权限 + hidapi #266;Wayland 兼容性需逐桌面验证 |

---

**文档完**
