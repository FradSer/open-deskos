# GUITION-JC4880P443 — ESP32-P4+C6 开发板资料（原样导入自 pulse-esp）

> 本文档从 `pulse-esp`（同一开发者名下另一个 ESP32-P4+C6 项目，路径
> `/Users/FradSer/Developer/FradSer/pulse-esp/`）原样整理导入，记录该项目在
> Guition JC4880P443 开发板上完整跑通显示+触摸+USB 链路后沉淀的全部硬件事实
> （2026-07-02 ~ 07-03 现场调试所得，均已在真实硬件上验证）。**主要参考仓库**：
> [`buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation`](https://github.com/buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation)
> ——本文档中的 ST7701 初始化序列、GT911 触摸配置均以此仓库为主要依据。
>
> **与 Open DeskOS 自身的 [LUMINA-P4.md](../lumina-p4/LUMINA-P4.md) 无直接关系**——LUMINA-P4
> 是 Open DeskOS 从零设计的定制 PCB（便携大功率 HiFi 音箱），用的是不同的屏幕控
> 制器（ICNA3312 / CO6300 / RM690C0，非本文档的 ST7701）和不同的触摸芯片
> （CST3530 / ZT2628，非本文档的 GT911），目前原型验证阶段用的是 Osptek
> ESP32-P4-Module（OspreyPi-P4C6），不是本文档描述的 Guition 板。是否／如何
> 在 Open DeskOS 中使用这块 Guition 板（例如作为额外的引导期验证板、或仅作芯片
> 级踩坑经验的对照参考）留待后续决定——本文档目前只是资料留存，未与
> Open DeskOS 现有文档建立引用关系。

---

## 一、板卡身份

| 项 | 值 | 来源 |
|---|---|---|
| 型号（项目内简称） | Guition JC4880P443 | pulse-esp `CLAUDE.md` |
| 型号（USB/丝印识别全称） | JC4880P443C_I_W | `pulse-esp-guition-p4-board` 备忘录 |
| 主控 | ESP32-P4（RISC-V，400MHz） | 同上 |
| 无线协处理器 | ESP32-C6-MINI-1U-N4，经 ESP-Hosted 传输连接 | 同上 |
| 屏幕 | 4.3" 480×800，ST7701，MIPI-DSI 接口 | 同上 |
| 触摸 | GT911，I2C 电容触摸 | 同上 |
| 音频编解码 | ES8311（麦克风+扬声器共用一条总线，不能边放音边唤醒词监听） | 同上，pulse-esp 中**明确不用** |
| PSRAM / Flash（实测探测值） | 32MB PSRAM，16MB Flash（Boya，QIO） | 同上 |
| PSRAM / Flash（固件配置值） | 32MB Hex PSRAM，16MB Flash | `sdkconfig.defaults.esp32p4` |
| 出厂固件 | 小智（Xiaozhi）v2.0.4，基于 ESP-IDF v5.5.1，标准 dual-OTA 分区表 | `pulse-esp-guition-p4-board` 备忘录 |
| USB 身份（原始检测） | `/dev/cu.usbmodem101`，VID:PID `303A:1001`，MAC `30:ed:a0:e1:9e:2a` | 同上 |
| 采购/供应商链接 | **未在任何已读源中找到**——pulse-esp 全部源文件与备忘录均无购买链接或数据手册 URL | — |

⚠ 出厂固件启动日志显示 C6 协处理器固件版本 `0.0.0` vs 主控固件 `2.8.0`，版本不
匹配（"networking likely broken until the C6 slave firmware is
reflashed/upgraded"）。此现象来自出厂小智固件检测阶段，与 pulse-esp 自身无
关（pulse-esp 完全不用 C6/WiFi）。

---

## 二、显示（ST7701 MIPI-DSI）

### 2.1 分辨率 / 引脚

| 宏 | 值 |
|---|---|
| `P4_LCD_H_RES` | 480 |
| `P4_LCD_V_RES` | 800 |
| `P4_LCD_RST_PIN`（LCD 复位） | GPIO5 |
| `P4_BACKLIGHT_PIN`（背光 PWM） | GPIO23 |

### 2.2 DSI 通道数 / 码率 / DPI 时钟 —— **这两个数必须成对使用，不能单独换**

- `P4_DSI_LANE_MBPS = 500`，`P4_DPI_CLK_MHZ = 34`
- `bus_config.num_data_lanes = 2`
- 板级真实调试历史（源码注释原文转述）：
  1. 500Mbps / 34MHz ＋ `esp_lcd_st7701` 组件**内置默认 init 序列** → 全黑屏
     （面板完全没有点亮）。
  2. 550Mbps / 28MHz（厂商 demo 参数）＋ 同样的内置默认 init 序列 → 依然全
     黑屏。
  3. 换成 ESPHome 已验证可用的自定义 init 字节序列，但**仍用** 550/28 的时
     钟 → 画面出现但**花屏/损坏，触摸无响应**。
  4. **最终可用组合**：34MHz DPI / 500Mbps DSI ＋ 下面 2.4 节的自定义 init
     序列，两者必须配对，缺一不可。

结论：**`espressif/esp_lcd_st7701` 组件自带的通用默认 init 序列在这块面板上
完全不work**（伽马/GIP 时序表 0xB0/0xB1、0xE0-0xEF 是面板玻璃厂家专属数
据，组件默认值对不上这块 Guition 面板）。

### 2.3 行/场时序（Porch）

来自 `dpi_config.video_timing`：

| 字段 | 值 |
|---|---|
| `h_size` | 480 |
| `v_size` | 800 |
| `hsync_pulse_width` | 12 |
| `hsync_back_porch` | 42 |
| `hsync_front_porch` | 42 |
| `vsync_pulse_width` | 2 |
| `vsync_back_porch` | 8 |
| `vsync_front_porch` | 166 |
| `num_fbs` | 1 |

### 2.4 颜色格式

- `dpi_config.in_color_format = LCD_COLOR_FMT_RGB565`
- `dpi_config.out_color_format = LCD_COLOR_FMT_RGB565`
- `panel_config.bits_per_pixel = 16`，`rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB`
- 面板 COLMOD 命令字节：`0x3A, 0x55`（RGB565）

⚠ **踩坑记录**：最初只设置了 `in_color_format`，`out_color_format` 是零初始
化（不是合法的 RGB565 值），导致 DPI 硬件输出给面板的像素格式和 LVGL 实际渲
染的格式对不上——这很可能就是"DSI 信号锁定后依然花屏"的真正原因。**ESP-IDF
v6.0.2 把这个字段拆成了两个**（`in_color_format`/`out_color_format`），老版
本/Arduino 捆绑的 IDF 用的是单一的 `pixel_format` 字段，照抄老参考代码时这
个坑很容易被忽略。

### 2.5 完整 ST7701 初始化命令表（逐字节，硬件验证可用）

来源：ESPHome 已合并的 `guition.py`（`esphome/components/mipi_dsi/models/guition.py`,
PR #12068），作者确认"本机测试通过"；同时与**主要参考仓库**
[`buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation`](https://github.com/buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation)
（`esp_lcd_st7701_mipi.c` 生效代码块）逐字节一致。伽马/GIP 分组（0xB0/0xB1、
0xE0-0xEF）为面板玻璃厂家专属数据。

```c
#define ST7701_CMD(cmd, ...) \
    { cmd, (const uint8_t[]){__VA_ARGS__}, sizeof((const uint8_t[]){__VA_ARGS__}), 0 }

static const st7701_lcd_init_cmd_t s_st7701_init_cmds[] = {
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x13),
    ST7701_CMD(0xEF, 0x08),
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x10),
    ST7701_CMD(0xC0, 0x63, 0x00),
    ST7701_CMD(0xC1, 0x0D, 0x02),
    ST7701_CMD(0xC2, 0x10, 0x08),
    ST7701_CMD(0xCC, 0x10),
    ST7701_CMD(0xB0, 0x80, 0x09, 0x53, 0x0C, 0xD0, 0x07, 0x0C, 0x09, 0x09, 0x28, 0x06, 0xD4, 0x13, 0x69, 0x2B, 0x71),
    ST7701_CMD(0xB1, 0x80, 0x94, 0x5A, 0x10, 0xD3, 0x06, 0x0A, 0x08, 0x08, 0x25, 0x03, 0xD3, 0x12, 0x66, 0x6A, 0x0D),
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x11),
    ST7701_CMD(0xB0, 0x5D),
    ST7701_CMD(0xB1, 0x58),
    ST7701_CMD(0xB2, 0x87),
    ST7701_CMD(0xB3, 0x80),
    ST7701_CMD(0xB5, 0x4E),
    ST7701_CMD(0xB7, 0x85),
    ST7701_CMD(0xB8, 0x21),
    ST7701_CMD(0xB9, 0x10, 0x1F),
    ST7701_CMD(0xBB, 0x03),
    ST7701_CMD(0xBC, 0x00),
    ST7701_CMD(0xC1, 0x78),
    ST7701_CMD(0xC2, 0x78),
    ST7701_CMD(0xD0, 0x88),
    ST7701_CMD(0xE0, 0x00, 0x3A, 0x02),
    ST7701_CMD(0xE1, 0x04, 0xA0, 0x00, 0xA0, 0x05, 0xA0, 0x00, 0xA0, 0x00, 0x40, 0x40),
    ST7701_CMD(0xE2, 0x30, 0x00, 0x40, 0x40, 0x32, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00),
    ST7701_CMD(0xE3, 0x00, 0x00, 0x33, 0x33),
    ST7701_CMD(0xE4, 0x44, 0x44),
    ST7701_CMD(0xE5, 0x09, 0x2E, 0xA0, 0xA0, 0x0B, 0x30, 0xA0, 0xA0, 0x05, 0x2A, 0xA0, 0xA0, 0x07, 0x2C, 0xA0, 0xA0),
    ST7701_CMD(0xE6, 0x00, 0x00, 0x33, 0x33),
    ST7701_CMD(0xE7, 0x44, 0x44),
    ST7701_CMD(0xE8, 0x08, 0x2D, 0xA0, 0xA0, 0x0A, 0x2F, 0xA0, 0xA0, 0x04, 0x29, 0xA0, 0xA0, 0x06, 0x2B, 0xA0, 0xA0),
    ST7701_CMD(0xEB, 0x00, 0x00, 0x4E, 0x4E, 0x00, 0x00, 0x00),
    ST7701_CMD(0xEC, 0x08, 0x01),
    ST7701_CMD(0xED, 0xB0, 0x2B, 0x98, 0xA4, 0x56, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xF7, 0x65, 0x4A, 0x89, 0xB2, 0x0B),
    ST7701_CMD(0xEF, 0x08, 0x08, 0x08, 0x45, 0x3F, 0x54),
    ST7701_CMD(0xFF, 0x77, 0x01, 0x00, 0x00, 0x00),
    // 以下是标准 MIPI DCS 命令，ESPHome 框架本会自动追加（不在上面的面板专
    // 属伽马/GIP 数据里）：
    ST7701_CMD(0x36, 0x00),  // MADCTL：不镜像/不翻转（如画面镜像需调整）
    ST7701_CMD(0x3A, 0x55),  // COLMOD：RGB565，与 DPI 像素格式一致
    { 0x11, nullptr, 0, 120 },  // SLPOUT，之后延时 120ms（ST7701 数据手册最小值）
    { 0x29, nullptr, 0, 20 },   // DISPON，之后延时 20ms
};
```

共 38 条命令（34 条面板专属伽马/GIP/寄存器命令 ＋ MADCTL ＋ COLMOD ＋
SLPOUT ＋ DISPON）。

### 2.6 LDO 通道 / 电压

- `chan_id = 3`，`voltage_mv = 2500`，通过 `esp_ldo_acquire_channel()` 获取。
- 说明：MIPI DSI PHY 需要一路 2.5V 供电，来自 P4 内部 LDO 稳压器（通道 3）——
  软件控制，不是 GPIO（`LDO_VO3 -> VDD_MIPI_DPHY` 是 ESP32-P4 的标准硬件接
  法，在多个参考源和 Espressif 官方 EV-board 上均一致确认）。

### 2.7 DBI/IO 配置

- `virtual_channel = 0`，`lcd_cmd_bits = 8`，`lcd_param_bits = 8`

### 2.8 复位/背光 GPIO 与 PWM

| 项 | 值 |
|---|---|
| LCD 复位 GPIO | 5 |
| 背光 GPIO | 23（LEDC PWM，低速模式，timer 0，channel 0） |
| PWM 频率 | 20kHz（`hw_test_p4` 诊断 App 里是 5kHz，与正式固件不一致，记录留痕） |
| PWM 分辨率 | `LEDC_TIMER_10_BIT` |
| 默认背光电平 | 50%（`LCD_Backlight = 50`） |
| 背光占空比映射 | `duty = Light * 10`（0-100 → 0-1000/1023，`duty==1000` 时钳到 1024） |

`PWR_Init()` 在 pulse-esp 中是空实现——这块板子没有找到类似 Waveshare S3 板
的 PWR_KEY/PWR_Control 电源锁存电路，调研未发现该 Guition 板有文档化的
PWR_EN/LCD_EN GPIO。

### 2.9 渲染模式与缓冲策略（及背后两个硬件根因）

- `LV_DISPLAY_RENDER_MODE_PARTIAL`，两块离屏条带缓冲，`strip_lines = 80`
- 单块缓冲大小：480 × 80 × 2 = **76,800 字节**（注释称"~75KB x2 strips"）
- 分配方式：优先 `heap_caps_aligned_alloc(64, ..., MALLOC_CAP_INTERNAL |
  MALLOC_CAP_8BIT)`（内部 SRAM，P4 有 768KB L2MEM），分配失败时回退
  `MALLOC_CAP_SPIRAM`
- LVGL 刷新周期：16ms
- flush 回调必须走 `esp_lcd_panel_draw_bitmap()`，不能直接 memcpy

两个在真实硬件上定位到的根因，都要求必须用这套策略，缺一个都不行：

1. **flush 空实现会跳过缓存回写** —— 大部分渲染像素根本没有真正写入物理
   PSRAM，屏幕显示大量陈旧垃圾且看起来"卡住不刷新"。修复：
   `esp_lcd_panel_draw_bitmap()` 同时完成 CPU→PSRAM 拷贝**和** DSI DMA 需要
   看到的 `esp_cache_msync`（C2M）缓存回写。
2. **就算加了 msync，直接往 framebuffer 里画依然会在滚动时闪烁** —— DSI 硬
   件在持续扫描 framebuffer，会把 LVGL 画到一半的中间状态也显示出来。修复：
   离屏条带 + flush 时整块拷贝，扫描永远只看到画完的内容。"与 S3 驱动架构相
   同"。

坐标注意：`x2`/`y2` 在 LVGL 里是闭区间，在 esp_lcd 里是开区间——所以传参时
要 `+1`。

### 2.10 一处代码里标注为"未经真实头文件验证"但实测正确的风险点

`st7701_vendor_config_t` 的字段嵌套（`vendor_config.mipi_config.dsi_bus` /
`.mipi_config.dpi_config`）是参照其他 Espressif MIPI-DSI 厂商驱动（例如
`ek79007_vendor_config_t`）写的，因为写代码时本地还没拉取
`esp_lcd_st7701` 的真实头文件。迁移记录确认：真正拉取到该托管组件后首次编
译即通过，字段嵌套猜对了。

---

## 三、触摸（GT911）

| 项 | 值 |
|---|---|
| I2C 总线号 | `I2C_NUM_1` |
| SDA / SCL | GPIO7 / GPIO8 |
| I2C 速率 | 100kHz（注释：与本板的走线/上拉配置更匹配，400kHz 可能过快导致通信不稳） |
| GT911 I2C 地址 | 主 `0x5D`，备 `0x14`（**两个地址在这块板的物理总线上都会 ACK**，运行时两个都探测，不写死一个） |
| I2C 总线配置 | `glitch_ignore_cnt = 7`，`flags.enable_internal_pullup = true` |
| 探测方式 | `i2c_master_probe(bus, addr, 50)`（50ms 超时） |
| 触摸坐标范围 | `x_max = 480`，`y_max = 800` |
| RST / INT GPIO | `GPIO_NUM_NC`（两个都不接主控——poll 模式，GT911 靠自身上电电路复位） |

⚠ **关键踩坑（2026-07-02 真实硬件定位）**：GT911 的 IO 配置**必须**显式设置
`flags.disable_control_phase = 1`（连同 `control_phase_bytes = 1`、
`dc_bit_offset = 0`、`lcd_cmd_bits = 16`）——否则 IO 层会在 GT911 的 16 位
寄存器地址前多插入一个 control-phase 字节，导致每一次 I2C 事务都被破坏，触
摸完全无响应（GT911 的 ID 寄存器读回全零）。组件自带的
`ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG` 宏本身带了这个字段，但**该宏在 C++ 里
因为指定初始化器顺序问题无法直接用**（`hw_test_p4` 诊断 App 是纯 C，直接用
宏；正式固件的 `.cpp` 文件手动逐字段赋值，等价替换）。

- API：使用 `esp_lcd_touch_read_data()` + `esp_lcd_touch_get_data()`，**不是**
  已废弃的 `esp_lcd_touch_get_coordinates()`——`esp_lcd_touch` 组件锁定到
  1.2.1 版本后该函数标了 `[[deprecated]]`，C++ 下 `-Werror` 直接报错。
  `get_data()` 本身不做 I2C 读取，读取要先调用 `read_data()`。
- GT911 ID 校验方法：正确通信时 TouchPad_ID 读回 ASCII "911"
  （`0x39,0x31,0x31`）；全零即通信有问题。
- 资源泄漏修复：`esp_lcd_touch_new_i2c_gt911()` 失败时，之前分配的
  `esp_lcd_panel_io_i2c` 句柄会泄漏——补了 `esp_lcd_panel_io_del(io)`。

---

## 四、电源 / 芯片版本相关 Kconfig

| Kconfig | 值 | 原因 |
|---|---|---|
| `CONFIG_ESP32P4_SELECTS_REV_LESS_V3` | `y` | 实测这颗芯片是 silicon rev v1.0，但 ESP-IDF v6.0 默认要求 rev v3.0+，不设此项编译出的固件在真实硬件上会 panic（"Instruction access fault"） |
| `CONFIG_SPIRAM_MODE_HEX` | `y` | P4 的 PSRAM 只有 Hex 模式（不像 S3 的 Octal） |
| `CONFIG_SPIRAM_SPEED_200M` | `y` | 250MHz 需要 rev v3.0+，这颗芯片没有；且与出厂固件启动日志里 "Speed: 200MHz" 一致 |
| `CONFIG_ESPTOOLPY_FLASHMODE_QIO` | `y` | 与出厂固件启动日志一致（"flash io: qio"）——**注意这与 S3 板正相反**，S3 被强制用 `dio`（QIO 会导致 S3 那颗 flash 在 1st-stage ROM loader 阶段挂死引导循环） |
| `CONFIG_ESPTOOLPY_FLASHSIZE_16MB` | `y` | 实测/丝印一致 |
| `CONFIG_ESP_MAIN_TASK_STACK_SIZE`（两块板共用） | `16384` | IDF 默认 3584B 主任务栈在 LVGL 初始化+渲染循环下溢出，真实硬件上表现为 "Guru Meditation Error: Core 0 panic'ed (Stack protection fault)"，且是在"Pulse Monitor ready"之后、第一次渲染循环迭代时发生，不是初始化阶段 |

- **烧录时 Bootloader 偏移**：P4 是 `0x2000`（S3 是 `0x0`）——务必以
  `build.<target>/flash_args` 为准，不要假设两块板一致。
- 实际烧录时使用的分区偏移：`0x2000` / `0x8000` / `0x10000`，`--flash_mode
  dio`（注意：烧录命令本身用的是 `dio`，即便 sdkconfig 默认值是 `qio` ——
  两者不矛盾，`--flash_mode` 只影响烧录工具写入 flash 头的方式）。
- 必须显式调用 `nvs_flash_init()`（Arduino 的 `Preferences` 隐式做了这件
  事，原生 `nvs_open()` 不调用初始化会静默失败，现象是每次开机都打印
  `[Config] NVS open failed, loading defaults`）。
- `CONFIG_FREERTOS_HZ = 1000`。

---

## 五、ESP32-C6 协处理器状态

- pulse-esp 中**明确不用**：只做 USB-link 的显示看板，没有 WiFi/BT/音频需
  求，两块板（S3 与 P4）都是 USB-only。
- 芯片型号：ESP32-C6-MINI-1U-N4，经 ESP-Hosted 传输连接。
- 出厂固件启动日志里观察到的版本不匹配（C6 协处理器固件 `0.0.0` vs 主控
  `2.8.0`）来自小智出厂固件阶段的检测，与 pulse-esp 本身无关，pulse-esp 从
  未尝试驱动这颗 C6。

---

## 六、USB / 串口身份

| 项 | 值 |
|---|---|
| 出厂检测时 VID:PID | `303A:1001` |
| 出厂检测时 MAC | `30:ed:a0:e1:9e:2a` |
| 出厂检测时设备节点 | `/dev/cu.usbmodem101` |
| pulse-esp 刷入后、当前部署设备节点（frad-nas） | `/dev/ttyACM0` |
| USB 序列号字符串 | 未在任何已读源中记录（只抓到了 VID:PID 和 MAC） |

- 正式固件的 `usb_link.cpp` 独占原生 USB-Serial/JTAG 外设做 pulse-link 帧协
  议——必须**同时**设置 `CONFIG_ESP_CONSOLE_NONE=y` **和**
  `CONFIG_ESP_CONSOLE_SECONDARY_NONE=y`（只设前者不够：真实硬件上确认
  `ESP_LOG` 输出仍会和帧协议流交织在一起）。
- `hw_test_p4/` 诊断 App 刻意保留了 console（明文 log，走同一根 USB-Serial-
  JTAG，不走帧协议），方便硬件调试。

---

## 七、其它跨主题坑点

- `idf_component.yml` 里 P4 专属托管组件：`espressif/esp_lcd_st7701 ^2.0.2`、
  `espressif/esp_lcd_touch_gt911 ^1.1.3`（在 S3 目标上"无害但不会被用
  到"）。`esp_lcd_touch` 本体在一次 manifest 重新锁定后解析到 1.2.1 版本，
  是这个版本把 `esp_lcd_touch_get_coordinates` 标记为废弃的。
- `lvgl/lvgl ^9.5.0`——注释标明这是写代码当时（2026-07-02）GitHub 和 ESP
  组件仓库都一致的最新版本，故意把下限打在最新版，让固件和
  `sim/CMakeLists.txt` 的 `GIT_TAG` 保持同一（最新）版本。
- `main/CMakeLists.txt` 里 P4 目标专属的 `REQUIRES`：`esp_hw_support`（用
  `esp_ldo_regulator.h`）、`esp_lcd_st7701`、`esp_lcd_touch`、
  `esp_lcd_touch_gt911`——刻意不放进 S3 目标的 REQUIRES，让纯 S3 迭代周期不
  用拉取/编译这些组件。
- **板级专属的 pin/PWM 宏必须写在 `display_driver_p4.cpp` 自己文件里**，绝
  不能放进 `display_driver.h`/`touch_driver.h` 这两个两块板共用的头文件——
  之前有一次一个宏定义在共用头文件里，和 S3 板同名的本地常量撞车，直接搞
  坏了 S3 那边的编译。
- init 命令表结构体格式：`{cmd, param_bytes_ptr, param_bytes_len,
  delay_ms}`；`SLPOUT`/`DISPON` 这两条纯 DCS 命令用 `nullptr`/`0` 作为参数，
  分别带 120ms、20ms 的命令后延时。
- **完整现场调试时间线**（2026-07-02 ~ 07-03）：黑屏 → 自定义 init 序列修
  复；花屏 → cache msync ＋ out_color_format 双修；滚动闪烁 → PARTIAL 条带
  缓冲修复；触摸无响应 → GT911 `disable_control_phase` 修复。用户最终确认
  原话："闪烁消失，一切正常"。
- `hw_test_p4/` 是独立的最小 ESP-IDF 诊断工程，三阶段：Stage A 用
  `esp_lcd_dpi_panel_set_pattern()` 输出纯硬件生成的横/竖条纹图案（零 CPU
  像素写入/零缓存参与，用来隔离 DSI 链路/init/时序问题）；Stage B 整屏纯色
  循环（红/绿/蓝/白/黑，走 `esp_lcd_panel_draw_bitmap`）；Stage C 做 I2C 总
  线扫描（`0x08`–`0x77`）＋ GT911 触摸循环（触摸出现白色小方块）。构建命
  令：`idf.py -C hw_test_p4 -B build.hwtest -DSDKCONFIG=<abs>/build.hwtest/sdkconfig ...`。
- 参考来源：
  [`buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation`](https://github.com/buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation)
  （注意仓库名是 `P433C`，和板子本身丝印的 `P443` 拼写不同，原样保留、非笔
  误）以及 ESPHome PR #12068（`esphome/components/mipi_dsi/models/guition.py`）。

---

## 来源

- **主要参考**：
  [`buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation`](https://github.com/buccaneer-jak/JC4880P433C-lvgl_v9_sw_rotation)
  （GitHub，LVGL v9 + 软件旋转，本文档 ST7701 初始化序列/GT911 配置的主要
  依据）
- pulse-esp `CLAUDE.md`
- pulse-esp `src/display_driver_p4.cpp`、`src/touch_driver_p4.cpp`
- pulse-esp `sdkconfig.defaults`、`sdkconfig.defaults.esp32p4`
- pulse-esp `main/CMakeLists.txt`、`main/idf_component.yml`
- pulse-esp `hw_test_p4/main/hw_test_main.c`
- pulse-esp 项目记忆：`pulse-esp-guition-p4-bringup-data`、
  `pulse-esp-guition-p4-board`、`pulse-esp-idf-migration`
- ESPHome PR #12068（`esphome/components/mipi_dsi/models/guition.py`）
