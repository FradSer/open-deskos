# Orange Pi CM5 小尺寸 MIPI AMOLED 选型记录

> 目标：在 Orange Pi CM5 Base Tablet RK3588S 上，通过原生 MIPI DSI 连接一个较小的 AMOLED，同时保留 HDMI 输出给另一台显示器。
>
> 本文是采购与技术预研记录，不代表已完成 CM5 真机验证。

## 目标连接

```text
Orange Pi CM5 HDMI      -> 外部 HDMI 显示器
Orange Pi CM5 MIPI DSI  -> 小尺寸 AMOLED
```

CM5 Base Tablet 用户手册列出 MIPI DPHY TX 显示输出和 HDMI 2.1 输出。手册同时描述了官方 10.1 英寸 MIPI LCD 的转接板、排线和设备树 overlay，但没有明确保证 HDMI 与第三方 MIPI 面板可以同时作为两个独立 DRM 输出。因此双屏功能必须在目标内核、DTB、桌面环境和实际屏幕上验证。

## 当前推荐

### 1. 软件成功率优先：BOE BF060Y8M-AJ0

- [Alibaba 商品线索](https://www.alibaba.com/product-detail/BOE-6-inch-1080-2160-Flexible_1601007665079.html)
- [Linux 主线 panel 驱动](https://codebrowser.dev/linux/linux/drivers/gpu/drm/panel/panel-boe-bf060y8m-aj0.c.html)

已从 Linux 主线驱动确认的参数：

```text
约 5.99 英寸
1080 x 2160
4-lane MIPI DSI
RGB888
Video Mode
控制器：SW43404
Device Tree compatible：boe,bf060y8m-aj0
```

该面板的 4-lane、Video Mode 与 CM5 的 4-lane MIPI TX 方向较匹配，并且已有 Linux DRM panel 驱动，是目前最适合先验证原生 MIPI 双屏链路的候选。缺点是尺寸约 6 英寸，且主线驱动不自动解决 CM5 的 FPC、供电、reset、DSI 路由或触摸配置。

### 2. 尺寸优先：IFANTEK IF032BM26-92C

- [产品页面](https://ifan-display.com/product/3-2-inch-oled-touch-screen-portrait-strip-type-262x928/)

```text
约 3.2 英寸
262 x 928
AMOLED
RM690C0
1-lane MIPI DSI
30-pin
ZT2628 I2C 触摸
```

同规格备选：[Tailor Pixels 3.23-inch Bar AMOLED](https://tailorpixels.com/product/3-23-inch-bar-amoled-with-on-cell-touch-262x928-mipi/)。

这类条形屏最符合小型状态副屏的外形，但目前没有找到可直接复用的 RM690C0 Linux DRM 驱动。需要卖家提供初始化序列、DSI timing、1-lane 配置、电源时序和 FPC pinout，并自行完成 Linux panel/设备树适配。不能把 RM690B0 或 RM67162 的驱动直接当作 RM690C0 驱动。

### 3. 小型矩形屏：DisplayModule 2.4 英寸

- [产品页面（RM690B0 版本）](https://www.displaymodule.com/products/2-4-inch-rigid-amoled-450x600-mipi-dsi-1-lane)

页面资料显示：

```text
2.4 英寸
450 x 600
1-lane MIPI DSI
RM690B0（另一页面同 SKU 写成 ICNA3312）
```

该供应商同一/相近 SKU 存在 ICNA3312 与 RM690B0、不同电源轨和不同价格的冲突描述。在收到卖家书面确认、实物标签、匹配 datasheet 和完整 pinout 之前，不应购买或据此设计电源。部分资料包含 ELVDD/ELVSS 及负电压要求，不能猜测供电。

### 4. 极小实验屏：DisplayModule DM-OLED12-667

- [产品页面](https://www.displaymodule.com/products/1-2-inch-round-amoled-display-390x390-full-color-with-mipi-spi)

```text
1.2 英寸圆形
390 x 390
MIPI Command Mode + SPI
24-pin
AUO W022
```

页面提供较明确的部分 pinout，但需要外部电源架构、上电时序和自定义初始化/驱动；没有明确触摸。适合实验性状态屏，不适合首个 CM5 显示验证。

## 5.5 英寸采购线索

Alibaba 上存在多种 5.5 英寸 AMOLED 商品线索，例如：

- [1080x1920、30-pin、4-lane、on-cell touch](https://www.alibaba.com/product-detail/5-5-Inch-1080-1920-FHD_1601042767900.html)
- [720x1280、4-lane、E555HBM2](https://www.alibaba.com/product-detail/5-5-inch-OLED-Screen-720x1280_1600368476028.html)
- [720x1280、SH1386、30-pin](https://www.alibaba.com/product-detail/-IN-STOCK-5-5-Inch_1601243030628.html)
- [1080x1920、4-lane](https://www.alibaba.com/product-detail/5-5-AMOLED-LCD-display-1080_1600947579221.html)

这些页面多数没有可靠公开控制器型号、FPC pinout 或 Linux 驱动，现阶段只能作为询价线索。优先寻找以下完整规格：

```text
5.5 英寸
1080 x 1920
4-lane MIPI DSI
60 Hz
Video Mode
30-pin
带触摸
Linux DRM/RK3588 设备树
```

## HDMI AMOLED 备选（不符合原始双屏目标）

以下产品的软件接入风险较低，但实际占用 HDMI：

- [Waveshare 5-inch HDMI AMOLED](https://www.waveshare.com/5inch-hdmi-amoled.htm)：5 英寸、960x544、USB 触摸。
- [Waveshare 5.5-inch HDMI AMOLED](https://www.waveshare.com/5.5inch-hdmi-amoled.htm)：5.5 英寸、1080x1920、USB 触摸。
- [DFRobot DFR1262 / 6.67-inch Flexible AMOLED](https://www.dfrobot.com/product-3113.html)：2400x1080，MIPI 面板配 HDMI 驱动板，约 199 美元。

它们适合快速验证 AMOLED 效果，但连接关系是 `CM5 HDMI -> AMOLED`，不能同时把同一个 HDMI 输出留给另一台 HDMI 显示器。

Waveshare 1.64/1.8/2.06/2.41 英寸以及 LILYGO T-Display-S3 AMOLED 主要是 ESP32-S3 的 QSPI AMOLED 开发板，不是可直接连接 CM5 MIPI DSI 的裸面板。

## 购买前的硬性检查

向卖家索取以下资料，未获得前不要批量购买：

1. 实际面板型号和背面标签照片；
2. 驱动 IC 型号；
3. 完整 FPC pinout、连接器型号和触点方向；
4. MIPI DSI lane 数、lane mapping、时钟和 timing；
5. Video Mode 或 Command Mode、RGB565/666/888；
6. VDDI、VCI、ELVDD、ELVSS 及完整上电/断电时序；
7. reset、TE、power-enable 和背光/面板电源定义；
8. 触摸控制器、I2C 地址、中断和 Linux 驱动；
9. Linux DRM panel 驱动或设备树示例；
10. 明确确认转接板是原生 MIPI-DSI，而不是 HDMI-to-MIPI；
11. 使用同一 Orange Pi CM5 Base Tablet 的测试视频；
12. HDMI + MIPI DSI 同时工作的 `modetest -c` 或 `xrandr` 输出。

建议发给卖家的核心问题：

```text
I am using an Orange Pi CM5 Base Tablet RK3588S.
I need to connect this panel to the native MIPI DSI TX output
while keeping HDMI available for another monitor.

Please provide the exact panel model, controller IC, complete FPC pinout,
MIPI lane count and timing, power/reset sequence, initialization commands,
Linux DRM/device-tree example, and touch-controller details.
Please confirm that any included board is a native MIPI-DSI adapter,
not an HDMI-to-MIPI converter, and provide a test of independent HDMI
and MIPI displays on the exact Orange Pi CM5 carrier.
```

## 推荐决策

| 目标 | 推荐 |
|---|---|
| 首先验证成功率 | BOE BF060Y8M-AJ0，4-lane、Video Mode、已有 Linux panel 驱动 |
| 5.5 英寸尺寸和接口平衡 | 5.5 英寸 1080x1920、30-pin、4-lane AMOLED，但先拿到驱动资料 |
| 3 英寸左右小型状态屏 | IFANTEK/Tailor Pixels RM690C0，接受自定义驱动开发 |
| 2.4 英寸矩形屏 | 先解决 DisplayModule SKU/IC 规格冲突 |
| 最快验证 AMOLED | Waveshare 5 英寸 HDMI AMOLED，但占用 HDMI |

**建议流程：**先询价并索取资料，只买一片样品；验证型号、供电、FPC 和驱动后，再制作 CM5 转接和设备树。原生 MIPI AMOLED 的双屏能力必须以目标内核、DTB、桌面环境和真实硬件测试为准。
