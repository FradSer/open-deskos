---
name: p4-module-schematic-pins
description: "用户 P4 模块原理图 GPIO 权威表(LCD_TE=4, LCD_RST=5, TP_RST=6, I2C 7/8, VCI_EN=20, TP_INT=21, GPIO22=FREE); 两个 15-pin FFC LEFT=CSI RIGHT=DSI(J6); 三块板 map 别混"
type: project
---

AUTHORITATIVE GPIO map for the user's ESP32-P4 dev/carrier board (from its schematic). Display/touch control pins differ from the Osptek EXAMPLE firmware — schematic wins.

| 功能 | GPIO | 备注 |
|------|------|------|
| LCD_TE | 4 | 来自面板, P4 输入 |
| LCD_RST | 5 | P4 输出, 面板复位 |
| TP_RST | 6 | P4 输出, 触控复位 |
| I2C (SDA/SCL) | 7/8 | 触控 I2C 总线 |
| VCI_EN | 20 | 面板电源使能 (高电平=开) |
| TP_INT | 21 | 触控中断, P4 输入 |
| GPIO22 | 22 | FREE (未连接) |

**FFC 插座:** P4 模块两个 15-pin FFC 插座 — **LEFT (靠近 USB-C) = CSI 勿用, RIGHT (J6) = MIPI-DSI 接口**。反插短路 3V3→GND 发热即断电。15-pin 单独点不亮面板, 需要转接板；CO6300 分支的电源/FFC 闸口见 `firmware/co6300-mipi-bringup/README.md`。

**三块板 map 不要混:** Guition JC4880P443C / P4 模块 / LUMINA-P4 各有一份不同的 GPIO 分配。csvke BSP 是 Guition 的权威参考(见 [[cerberus-p4-display-lit]])。

**Why:** 三块板 GPIO 分配不同；错板(如误用 LUMINA-P4 的 I2S map 于 Guition)会空白面板。

**How to apply:** 查硬件 pin 先确认是哪块板, 再查对应 map。Guition 参考 csvke BSP, P4 模块参考上表, LUMINA-P4 参考其独立的板配置。

**Related:** [[cerberus-p4-display-lit]]