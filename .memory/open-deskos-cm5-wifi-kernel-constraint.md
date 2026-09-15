---
description: "CM5 平板的 AP6256 Wi-Fi 经 SDIO 总线连接，任何内核替换必须保持 CONFIG_BCMDHD_SDIO=y"
type: project
---

Orange Pi CM5 Tablet 的 Wi-Fi 芯片 AP6256（BCM43455）通过 **SDIO 总线**（mmc2，`sdio:c00v02D0dA9BF`）连接 RK3588S。bcmdhd 驱动是编译期选择总线的"一源多 bus"代码：`CONFIG_BCMDHD_SDIO=y` 对应 CM5 Tablet，`CONFIG_BCMDHD_PCIE=y` 对应 Orange Pi 5B 板。

**关键约束：**
- 官方 kernel 1.0.0（CM5 Tablet 默认）编译 `BCMDHD_SDIO=y`（Wi-Fi 正常）。
- 社区 kernel 1.0.8（cse-repon/orangepi-5b-rknpu-0.9.8-update，为 OP5B 编译）使用 `BCMDHD_PCIE=y`——安装在 CM5 Tablet 上会破坏 Wi-Fi。
- rknpu 驱动是 `CONFIG_ROCKCHIP_RKNPU=y`（builtin），要升级 rknpu 到 0.9.8 必须换整个内核镜像，连带切换 Wi-Fi 配置。
- 用 out-of-tree SDIO bcmdhd.ko 替换 builtin PCIe 版本会导致同名驱动冲突使启动过程崩溃（设备失联）。
- 正确路径：用官方 config（SDIO=y）作底、只替换 `drivers/rknpu/` 源码自编译内核。

**Why:** 全网唯一现成的 rknpu 0.9.8 内核是为 OP5B（PCIe Wi-Fi）编译的，在 CM5 Tablet（SDIO Wi-Fi）上不能用。

**How to apply:** 升级 CM5 内核前确认其 bcmdhd 总线配置匹配 CM5 Tablet 的 SDIO；不安装 out-of-tree bcmdhd.ko 替换同名 builtin；优先自编译或回滚到官方 kernel。备份 `/boot`、modules 与 `orangepiEnv.txt`。
