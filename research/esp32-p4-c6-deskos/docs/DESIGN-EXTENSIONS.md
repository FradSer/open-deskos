# Open DeskOS 可选扩展设计

> 本文档记录 MVP 之后可能构建的功能参考设计。MVP 实施者无需阅读本文档。
> 返回 [PROJECT-OPEN-DESKOS.md](PROJECT-OPEN-DESKOS.md) | [SPEC-MVP.md](SPEC-MVP.md) | [FACT-CHECK.md](FACT-CHECK.md)

## 一、无线 HID 链路(Nordic 专用射频)

### 1.1 数据流

```
  P4(大脑/UI/语音) ──SPI──► nRF54L15(专用 2.4G 发) ──ESB/Gazell 2.4G──► nRF52840 dongle ──USB──► PC
                                                                            (枚举为 USB HID)
```

- **链路用独立射频**(Nordic),不经 C6,因此 C6 的 Wi-Fi(云 ASR/AirPlay)负载**不会**饿死 HID 链路——这是射频隔离的核心收益。
- **dongle 必须自带可做 HID 的 USB**:nRF52840 自带 USB 2.0 FS,直接枚举为 USB HID。(C6 只有固定功能 USB-Serial/JTAG,不能做任意 HID,故 dongle 不用 C6。)
- nRF52840 USB 为全速 (FS, 12Mbps),HID 轮询上限 1000Hz —— 与"1000Hz 基准"一致。

### 1.2 2.4G 链路选型:采用 Nordic 专用射频

**射频隔离是硬需求**:HID 链路绝不能被 C6 的 Wi-Fi(云 ASR/AirPlay)流量饿死。C6 是单射频时分,任何 C6 协议(含 ESP-NOW)做 HID 都会与 Wi-Fi 抢同一射频——故**否决 ESP-NOW 方案**,改用 **Nordic 专用射频**:

| 项 | 方案 |
|---|---|
| 设备端 | **Nordic nRF54L15**(Cortex-M33 @128MHz,ESB/Gazell,专用 2.4G 射频与天线,无 USB——做发射端无妨)。也可两端都用 nRF52840 简化为单一物料。 |
| dongle 端 | **Nordic nRF52840**(自带 USB-FS,枚举为 USB HID;ESB/Gazell) |
| 协议 | **ESB/Gazell**(GFSK,1/2Mbps;nRF54L15 可达 4Mbps);Gazell 叠加 AFH 跳频与共存 |
| 隔离效果 | HID 链路有**独立射频/天线**,与 C6 的 Wi-Fi 物理隔离,二者可同时工作,互扰靠 AFH/信道规划/PTA/天线布局管理,而非单射频硬抢 |

代价:多一家供应商/工具链(Nordic SDK)、设备内多一颗射频(故仍需本文档 §五 的天线隔离与 PTA)。但这是换取 HID 链路确定性、避免"后续被 Wi-Fi 干扰"问题的必要成本。

> 注:nRF52840 dongle 为 USB-FS,无线回报率封顶 **1000Hz**(与基准一致)。若某天真要 4000/8000Hz 无线,dongle 须换 USB-HS 芯片(nRF52840 不够)。
> 此前被否决的 ESP-NOW 关键参数(供参考):≤20 对等(加密 ≤17/默 7)、单包 ≤250B(v2.0 1470B)、1Mbps、锁 Wi-Fi 信道、通信反馈 1.115ms(arXiv 2507.16594,为通信分量)。

### 1.3 Nordic 设备端与 dongle 详细规格

- **设备端 nRF54L15**:Cortex-M33 @128MHz,1.5MB NVM/256KB RAM,2.4G 私有(ESB/Gazell,最高 4Mbps),**无 USB**(做发射端无妨)。矩阵扫描用 GPIOTE + PPI/DPPI(Nordic 无 Telink 那种硬件键扫控制器)。
- **dongle 端 nRF52840**:自带 USB 2.0 FS(可枚举 HID)、ESB/Gazell、BLE 5(参考 PCA10059)。职责:经 ESB 接收 nRF54L15 的 HID 报文并以标准 USB HID 呈现。USB-FS → 1000Hz。
- **ESB**:GFSK,星型(1 PRX + 最多 8 PTX),自动重传 + ACK 携带载荷;**Gazell** 叠加跳频/共存(用于与 C6 的 Wi-Fi 共存)。
- **简化选项**:两端都用 nRF52840(单一物料、最成熟);nRF54L15 仅在需要 4Mbps/更低功耗时用。
- 这是把 HID 链路从 C6 上彻底剥离、实现射频隔离的关键。

### 1.4 芯片间通信(无线扩展)

| 链路 | 物理层 | 用途 |
|---|---|---|
| P4 ↔ nRF54L15 | SPI/UART | 无线模式的 HID 报文与状态 |
| nRF54L15 ↔ nRF52840 dongle | ESB/Gazell 专用 2.4G | 无线 HID 报文(独立射频) |

---

## 二、矩阵双主控隔离(有线/无线切换)

仅当做可选无线扩展(P4 有线 + nRF54L15 无线**共享同一矩阵**)时才适用。

### 2.1 双主控矩阵共享与电气隔离

矩阵在 P4(有线)与 nRF54L15(无线扫描)间共享时,休眠芯片的 GPIO 经 ESD 二极管会形成寄生漏电→误触发/漏电/ghosting。用 TI **TMUX1574**(4 通道 2:1,**断电保护**:VCC=0V 全 I/O 高阻;**导通电阻 ~2Ω**,max 4.5Ω;封装 TSSOP-16 / SOT-23-THIN-16 / UQFN-16 2.6×1.8mm,无 3×3mm QFN)隔离,任一时刻仅一个 MCU 驱动矩阵。

### 2.2 模式切换状态机

P4 控制 TMUX1574 SEL:

| SEL | 状态 | 描述 |
|---|---|---|
| SEL=0 | P4 扫描 | 有线 HID 模式 |
| SEL=1 | nRF54L15 扫描 | 无线模式 |
| VCC=0V | 全隔离 | 两路均断开 |

切换经握手 + 10ms 稳定窗,失败则强制切换并复位对端。

---

## 三、AirPlay 音频

> **绑定原则:有线模式不含任何 AirPlay;音频走 USB Audio Class (UAC)。AirPlay 只在无线模式才需要。** 有线时音频源就是所连电脑,经 USB 直送即可——设备枚举为**复合 USB:HID 键盘 + UAC 声卡(+ 可选 UAC 麦克风)**,电脑音频 → P4 → 板上 ES8311 + NS4150 + 喇叭;延迟毫秒级、对电脑零驱动、**无需第 2 颗 Wi-Fi 射频/第 3 根天线/MFi 授权**,约 0.5–1.5 人月。无线时设备脱离电脑、无 USB 承载音频,才需 AirPlay。

### 3.1 路线 A:P4 + C6(esp-hosted)自实现

不加芯片,P4 解码 + C6 做 Wi-Fi 网卡,移植 airplay-esp32(参考 shairport-sync)。**难、风险高**:esp-hosted 入站 TCP 卡顿(espressif/esp-hosted-mcu #184)、P4 跑 AirPlay 2/AAC 吃力、延迟 0.5–2s;且 shairport-sync 为逆向实现,**商用 AirPlay 2 需 Apple MFi 授权**,它不合规(个人/原型可用)。约 3–4 人月。

### 3.2 路线 B(推荐):加一颗专用 Wi-Fi 音频流模块

如 **Linkplay / Arylic Up2Stream** 系:**原生 AirPlay 2**(+ aptX HD/DLNA/Spotify Connect/多房间)、**I2S/SPDIF 输出** + **UART/HTTP/TCP 控制**,自带 Wi-Fi。把 AirPlay 全部复杂度(协议/解码/esp-hosted 卡顿/CPU)外包,且**模块厂通常已持 AirPlay 授权,顺带解决商用 MFi 合规**。

代价:
- ① 多一套 2.4G Wi-Fi 射频(连同 Nordic HID + C6 共 3 个射频,需天线隔离/PTA,见本文档 §五;但高带宽 AirPlay 流被隔到该模块,反而不挤 C6);
- ② 成本/板面积;
- ③ 受模块固件/生态约束。

**结论**:既然接受加芯片,**路线 B 更省事、更高质量、且解决 AirPlay 2 授权**——P4 经 I2S 接管模块音频(或模块直驱 ES8311/喇叭)。路线 A 仅在不想加芯片且只做个人/原型时考虑。

### 3.3 WiFi 统一管理模型(键盘集中管控 + 专用芯片)

AirPlay 芯片保留自己的 Wi-Fi 射频(AirPlay 须在局域网被 mDNS 发现,无法借用 C6 单射频),但**键盘是唯一 WiFi 管理面**——用户只在键盘屏配一次网,键盘存凭据并经**控制链路(UART/SPI)把 SSID/密码下发给 AirPlay 芯片**、令其连同一 AP,并读回连接/播放状态。这对选型提出硬要求:**AirPlay 芯片必须支持经有线链路无头配网/控制**(不能只靠自家 App 配网)。

据此:

- **ESP32-S3 + airplay-esp32(AirPlay 1 模式)**:Wi-Fi 完全由你的固件经 UART/SPI 掌控(最契合"键盘集中管理"),但仅 AirPlay 1、MFi 非官方。(`shairport-esp32` 作为独立项目名未确认存在,实际应为 airplay-esp32,见 FACT-CHECK.md。)
- **Linkplay/Up2Stream(AirPlay 2 + 授权)—— 无头配网已核实(2026-06)**:**可无头配网,但只能走 HTTP API,不能走 UART**。LinkPlay HTTP API 有 `wlanConnectApEx`(hex SSID / 信道 / WPA2PSK / AES / hex 密码)、`wlanGetApListEx`(扫描)、`wlanGetConnectState`(状态),可由程序直接推凭据连网、**无需 4STREAM App**;模块未配网时跑 SoftAP。但 **UART API 不能设 Wi-Fi**(仅 `WIF`/`WSS` 查状态、`WRS` 触发"进 App 配网模式"),UART 只管放音/控制/状态。
- **AirPlay 2 + 完全掌控 Wi-Fi** 的唯一组合是 Linux 模块(Pi Zero 2W 等)跑 shairport-sync,但 AirPlay 2 非官方(商用 MFi)、体积/功耗更大。

**据此键盘如何集中管 Linkplay 的 Wi-Fi**:键盘 C6 连模块 SoftAP → HTTP `wlanConnectApEx` 推目标 AP 凭据 → `wlanGetConnectState` 轮询;UART 同时跑放音/状态。即"键盘集中管理"**成立(无需 App)**,但**配网经 HTTP/SoftAP 而非 UART**,含一次 SoftAP 引导步骤。若想连配网都走干净的有线链路 → 选 ESP32-S3(AirPlay 1)。两路 Wi-Fi(C6 + AirPlay 芯片)由键盘下发**同一 AP/信道**降互扰(连同 Nordic HID 共 3 射频,见本文档 §五)。

### 3.4 音频编解码器选项

I2S 输出经:

- **PCM5102A**:纯 DAC,音质佳(112dB SNR / 384kHz)
- **ES8388**:带耳放与 mic(ESP-ADF 支持)
- **MAX98357A**:DAC + D 类功放,直驱扬声器(3.2W@4Ω filterless)

### 3.5 A2DP 不可行证明

**A2DP 在 C6 上根本不可能**:ESP32 全系仅初代 ESP32 支持蓝牙经典/A2DP;C6/S3/P4 等均 BLE-only(ESP-NimBLE 文档逐字)。`pschatzzimmer/ESP32-A2DP` 库 Wiki 逐字:"…do not support Classic Bluetooth, so A2DP is not possible.";编译期对不支持芯片报错(`BluetoothA2DPCommon.h` 中实际 `#error "ESP32C3, ESP32S2, ESP32S3... do not support A2DP"`,经 GitHub 源码 commit f275b82f 核实;见 Issue #745)。

### 3.6 esp-hosted TCP 停滞风险

esp-hosted 入站 TCP 大流量卡顿(espressif/esp-hosted-mcu #184 / EHM-206,收到约 88–105KB 后停滞;issue 已于 2026-05-19 关闭但无确认修复记录,见 FACT-CHECK.md),AirPlay over esp-hosted 须实测验证。

### 3.7 AirPlay 2 CPU 门槛

AirPlay 2 需 CPU ≥ 树莓派 2 / Zero 2 W(shairport-sync 当前 AIRPLAY2.md;旧版写 Pi Model B);延迟约 0.5–2s(非低延迟用途)。开源实现:squeezelite-esp32(AirPlay 1)、airplay-esp32(AirPlay 2,参考 shairport-sync)。

---

## 四、生态枢纽

> **基础 ESP-NOW 数据交换(C6 主节点 + 单外设从节点)已提前至 MVP**,详见 SPEC-MVP.md §六。本节指 MVP 之后的扩展:更多外设类型、组网规模化、802.15.4 接入 Zigbee/Thread/Matter。

C6 做 ESP-NOW 主节点协调多个桌面外设(低频状态同步);或经 802.15.4 接入 Zigbee/Thread/Matter。HID 链路已在 Nordic 专用射频上(无线扩展时),故 ESP-NOW 只与 **C6 自身的 Wi-Fi(云 ASR/AirPlay)** 分时,不影响 HID 链路;仍宜低频(ESP-NOW ≤250B/包、锁 C6 当前 Wi-Fi 信道)。

**典型外设:多协议快充充电站(ESP-NOW 从节点)—— 见本文档 §六。**

---

## 五、RF 共存(多射频场景)

### 5.1 设备内并存的 2.4GHz 射频(3 射频场景)

当做可选无线扩展时,设备内最多三套射频:

1. **Nordic 专用 HID 链路**(nRF54L15,独立射频/天线)
2. **C6 Wi-Fi**(云 ASR + ESP-NOW 生态)
3. **AirPlay 芯片的 Wi-Fi**(无线音频)

- **HID 链路与 Wi-Fi 已经物理隔离**(不同芯片/天线),二者**可同时工作**,互扰靠 AFH + 信道规划 + PTA + 天线布局管理,而非单射频硬抢——这正是采用专用射频(而非 ESP-NOW)的核心收益。
- C6 内部 Wi-Fi/BLE/802.15.4 仍共享其单射频,Wi-Fi 流量增大仍会压低 802.15.4(生态)性能;但这只影响 C6 自身的生态/音频,**不波及 HID 链路**。

### 5.2 多个 WiFi 芯片不能共用一根天线

- C6 之所以能用**一根**天线跑 Wi-Fi/BLE/802.15.4,是因为它们是**同一颗芯片里的同一个射频** + 内置时分仲裁器;**两颗独立芯片没有这个共享仲裁器**。
- C6 与 AirPlay 芯片的 Wi-Fi **同在 2.4G**,无法用双工器/合路器按频率分离;硬接到一根天线:一方发射会灌入另一方接收前端造成 **desense**,且彼此无隔离。
- 唯一的"共用"是**外接 RF 开关 + 时分仲裁、任一时刻只一个射频工作**——但 AirPlay 是**持续流**,会长期霸占天线饿死 C6,等于放弃并发,不可取。
- **结论:每个独立 2.4G 射频各用一根天线**(Nordic / C6 / AirPlay 芯片 = 3 根),靠间距(> 20mm)、地平面开槽、屏蔽罩、极化正交做隔离(15–20dB);两路 Wi-Fi 由键盘下发**同一 AP/信道**、Nordic 跑 AFH、可接 PTA 处接 PTA。
- **设计含义**:每加一颗独立 Wi-Fi 芯片(如 AirPlay 路线 B)= 多一根天线 + 多一份共存负担。若要把无线电/天线数压到最少 → AirPlay 走**路线 A**(P4+C6 esp-hosted,Wi-Fi 仅 C6 一颗),但软件更难(见本文档 §三)。

### 5.3 天线隔离现实与缓解

- 设备内天线隔离通常只有 **15–20 dB**(Silicon Labs UG103-17 典型值;金属/紧凑下更低),远不及所需的 45/50 dB(AN1017:+20dBm Wi-Fi 100% 占空需 50dB 收 -92dBm BLE / 45dB 收 -80dBm 802.15.4),小设备只能靠 **PTA** 与时分管理。

**缓解措施**:

1. **信道规划**——Gazell 做 AFH 跳频并错开 C6 当前 Wi-Fi 信道,跨 2.4G ISM 协同规划
2. **PTA**——用 GPIO 连 nRF 与 C6 的 PTA 接口做硬件仲裁,P4 作主时钟协调射频时间窗
3. **物理布局**——两天线间距 > 20mm、地平面开槽、屏蔽罩、极化正交
4. **错峰**——AirPlay 等持续 Wi-Fi 流尽量不与高频输入常态并发(语音 ASR 为突发,影响小)
5. **失败退路**——若仍超标,把 AirPlay 接收移到 dongle 侧/外置设备

### 5.4 决策门

已采用 Nordic 专用射频。若开启 AirPlay 时 HID 链路仍丢包 > 1% 或抖动 > 1ms(即 AFH+PTA+天线隔离仍不足)→ 把 AirPlay 接收移到 dongle 侧/外置设备,或加强天线隔离与 PTA。

---

## 六、快充充电站(ESP-NOW 外设)

> 本节为概要设计。详细设计应另建 DESIGN-CHARGER.md。

Open DeskOS 生态的一个桌面外设:支持多协议快充的充电站,内置 ESP32-C6 作 **ESP-NOW 从节点**,向键盘的 ESP-NOW 主节点(键盘 C6,MVP 已落地,见 SPEC-MVP.md §六)上报充电状态、接受指令。

**架构(C6 绝不在大电流路径)**:

```
  AC/DC 适配器(或 DC 输入)
          │
          ▼
   多协议快充 IC(SW3518S 等) ── USB-C/A 口 ──► 被充设备
          │ I2C(电压/电流/协议/温度/功率)
          ▼
     ESP32-C6 ── ESP-NOW 2.4G ──► 键盘 C6(主节点)
          ▲ 3.3V(从 DC 轨独立降压)
```

**快充 IC 选型(需带 I2C 遥测,供 C6 读状态/配置)**:

- **SW3518S(智融 iSmartWare)**:A+C 双口,全协议(PD3.0/PPS/QC4+/QC/AFC/FCP/SCP/PE/SFCP/VOOC),内置 5A 同步 buck + 电流 ADC,**I2C(100K/400K)可读电压/电流/协议并配置** —— 最契合本需求。
- 备选:IP2726(英集芯,多协议 + 内置电流 ADC);需更精确功率计量可外加 INA226(I2C 电流/功率监测)。

**C6 / ESP-NOW 职责**:周期性(低频,如 1–5s)经 I2C 读 IC 状态 → ESP-NOW 上报主节点(电压/电流/功率/协议/温度/端口占用);接受主节点指令(限功率、关端口、查询)。ESP-NOW ≤250B/包足够;锁键盘 C6 当前 Wi-Fi 信道,与 AirPlay/云 ASR 分时,**只做低频遥测,不做实时电源环路**(电源环路由快充 IC 硬件闭环,C6 只读/配)。

**键盘屏联动**:键盘 P4 屏显示 now-charging(端口/功率/协议/温度),把充电状态可视化——生态枢纽典型用例。

**安全/合规(真功率产品,务必重视)**:

- C6 仅做遥测/配置,**绝不进大电流路径**;功率路径由快充 IC + 合规 MOSFET/电感/e-marker(100W 线)处理。
- 需 OVP/OCP/OTP 保护与热设计;市电输入需安规隔离(用成熟 AC-DC 模块)与认证(充电器认证比键盘更严:UL/CCC/CE/PSE 等)。
- C6 供电从 DC 轨经独立 buck 取 3.3V,与功率路径布局隔离。

**工程量(粗估)**:快充硬件(选成熟 IC/模块)+ C6 固件(I2C 遥测 + ESP-NOW)约 2–3 人月;安规/认证另计。

---

## 七、Telink 备选

### 7.1 TLSR9218

- **CPU**:RISC-V @96MHz
- **Flash**:1MB(9218A)/ 2MB(9218H)
- **无线**:BLE 5.3,genfsk/TPLL 500k/1M/2Mbps
- 可作为 Nordic nRF52840 的替代 dongle 方案

### 7.2 TL3228 / TL322x(2026 新品)

- **CPU**:192MHz
- **无线**:BT 6.0,私有 HDT 6Mbps
- 面向 8000Hz 无线回报率场景(CES 2026 演示)
- 若未来需超高轮询率无线 HID,Telink TL322x 是比 nRF52840(USB-FS → 1000Hz 上限)更有潜力的候选
