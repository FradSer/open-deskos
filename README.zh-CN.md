# Open DeskOS

Open DeskOS 是以 CM5/RK3588S Linux 为主体的桌面伴侣运行时。Electron 外壳直接运行在桌面显示屏上；在硬件外设分别完成验收前，CM5 基础外壳仍可通过直接触控和键盘使用。

## 当前架构

```text
runtime/linux/                         CM5 Electron 桌面运行时
peripherals/esp32-s3-remote/           ESP32-S3 触控 Remote Control
peripherals/esp32-p4-camera/           ESP32-P4 SC2336 Camera Peripheral
integrations/remote-bridge/            CM5 ↔ Remote 传输服务
experiments/vision/face-agent/         可选视觉与 owner-recognition 实验
```

ESP32-S3 Remote Control 和 ESP32-P4 Camera Peripheral 是目标 CM5 系统架构的组成部分，但各自拥有独立硬件验收门。基础 CM5 安装和直接操作不会等待任一开发板。Face Agent 和 owner recognition 仍是显式启用的实验。

## 开发 CM5 运行时

```sh
cd runtime/linux
pnpm install
pnpm styles
pnpm test
pnpm run e2e
bash tests/smoke.sh
./run.sh
```

CM5 安装与设备验收请见 [runtime/linux/README.md](runtime/linux/README.md)。

## 构建目标外设

```sh
# ESP32-S3 触控 Remote Control
cd peripherals/esp32-s3-remote
 eim run 'idf.py set-target esp32s3' v6.0.1
 eim run 'idf.py build' v6.0.1

# ESP32-P4 SC2336 Camera Peripheral
cd ../esp32-p4-camera
 eim run 'idf.py set-target esp32p4' v6.0.1
 eim run 'idf.py build' v6.0.1
```

Remote 协议见 [peripherals/esp32-s3-remote/README.md](peripherals/esp32-s3-remote/README.md)。P4 Camera 协议和物理录入实验见 [peripherals/esp32-p4-camera/README.md](peripherals/esp32-p4-camera/README.md)。

## 保留的 P4+C6 研究线

[research/esp32-p4-c6-deskos/](research/esp32-p4-c6-deskos/) 保存以前并行探索的 P4+C6 DeskOS 设备 OS：ESP-IDF 固件、LVGL/Lua/AIODI 外壳、native simulator、板级测试、规格和 Apple USB companion。它被保留以确保实验可复现，但不属于当前运行时，也不定义 CM5 产品的需求或发布门。

## 产品权威

- [当前产品定义](PRODUCT.md)
- [CM5 运行时架构上下文](runtime/linux/CONTEXT.md)
- [架构决策记录](runtime/linux/docs/adr/0002-cm5-runtime-and-preserved-p4-research.md)
- [保留的 P4+C6 研究文档](research/esp32-p4-c6-deskos/docs/)
