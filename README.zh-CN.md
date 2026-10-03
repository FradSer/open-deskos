# Open DeskOS

Open DeskOS 是跨平台桌面伴侣。Linux、64 位 Windows 和 macOS 共用一个 Electron Display Shell，CM5/RK3588S Linux 面板是参考主机。外设分别完成硬件验收前，基础外壳仍可通过直接输入使用；各主机的能力与设备验收单独记录。

## 当前架构

```text
runtime/shell/                         Linux、Windows、macOS 共用的 Electron Shell
peripherals/esp32-s3-remote/           ESP32-S3 触控 Remote Control
peripherals/esp32-p4-camera/           ESP32-P4 SC2336 Camera Peripheral
integrations/remote-bridge/            CM5 ↔ Remote 传输服务
```

ESP32-S3 Remote Control 和 ESP32-P4 Camera Peripheral 是目标 CM5 系统架构的组成部分，但各自拥有独立硬件验收门。基础 CM5 安装和直接操作不会等待任一开发板。P4 Camera 是通用 UVC webcam 与 UAC 麦克风，无人脸识别与身份存储。

## 开发 Shell

```sh
cd runtime/shell
pnpm install
pnpm styles
pnpm test
pnpm run e2e
bash tests/smoke.sh
./run.sh
```

CM5 安装与设备验收请见 [runtime/shell/README.md](runtime/shell/README.md)。

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
- [Shell 架构上下文](runtime/shell/CONTEXT.md)
- [架构决策记录](runtime/shell/docs/adr/0002-cm5-runtime-and-preserved-p4-research.md)
- [保留的 P4+C6 研究文档](research/esp32-p4-c6-deskos/docs/)
