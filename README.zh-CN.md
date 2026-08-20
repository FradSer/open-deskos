# Open DeskOS ![](https://img.shields.io/badge/status-active_development-orange)

[![硬件](https://img.shields.io/badge/hardware-ESP32--P4%20%2B%20ESP32--C6%20%7C%20ESP32--S3-blue)](docs/open-deskos/OPEN-DESKOS.md) [![固件](https://img.shields.io/badge/firmware-ESP--IDF-green)](firmware/open-deskos/)

[English](README.md) | **简体中文**

Open DeskOS 是一套桌面伴侣操作系统，运行在 ESP32-P4 显示设备、ESP32-C6 网络协处理器、紧凑型 ESP32-S3 变体上，并配套 Apple 平台客户端。

## 仓库内容

### 固件

生产固件位于 `firmware/open-deskos/application/open_deskos/`（ESP-IDF 工程名 `open_deskos`），支持两块开发板：

- **Guition JC4880P443C**（`guition/jc4880p443c`，ESP32-P4 + ESP32-C6，480x800 ST7701S MIPI-DSI，GT911 触摸）——主桌面设备。
- **Waveshare ESP32-S3 Touch LCD 2.8**（`waveshare/esp32_s3_touch_lcd_2_8`，ESP32-S3，240x320 ST7789 SPI，CST328 触摸）——紧凑型变体，布局与服务按目标条件编译。

两块板共同构成 `firmware-scope.feature` 约束的产品范围。唯一受支持的应用路径是 `application/open_deskos`，旧的 `edge_agent` 路径和其他厂商板级目录不在产品构建范围内。当前产品方向和硬件边界见 [docs/open-deskos/OPEN-DESKOS.md](docs/open-deskos/OPEN-DESKOS.md)。

### Native SDL 模拟器

`firmware/open-deskos/sim/native_sdl/` 可以在桌面环境运行 Guition JC4880P443C 固件的 Lua/LVGL UI，不需要 ESP-IDF 或 Emscripten。macOS 直接运行 `./run.sh` 会打开 SDL Cocoa 交互窗口，不需要设置 `DISPLAY` 或 `WAYLAND_DISPLAY`；Linux 需要 X11 或 Wayland 会话。无界面检查时设置 `ODK_SIM_SHOT`，也可以通过 `ODK_SIM_TAP` 注入触摸。它使用 IO/PARTIAL 渲染路径，不能验证 P4 的 MIPI-DSI adapter 路径。详见 [`firmware/open-deskos/sim/native_sdl/README.md`](firmware/open-deskos/sim/native_sdl/README.md)。

```bash
cd firmware/open-deskos/sim/native_sdl
./run.sh
# 无界面：ODK_SIM_SHOT=/tmp/opendeskos-sim.bmp ODK_SIM_SHOT_FRAMES=30 ./run.sh
```

### Apple 客户端

`app/apple/` 包含 SwiftUI 客户端和仅 macOS 使用的 `OpenDeskOSCLI` target（产物 `odkctl`）。CLI 负责 Wispr Flow 健康检查，并把 OpenCode Go 订阅快照桥接到设备。

```bash
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/open-deskos-cli build
```

### 产品与实现文档

- [产品规格](docs/open-deskos/OPEN-DESKOS.md)
- [固件 README](firmware/open-deskos/README.md)
- [Waveshare S3 板级说明](firmware/open-deskos/application/open_deskos/boards/waveshare/esp32_s3_touch_lcd_2_8/README.md)
- [Apple 客户端说明](app/README.md)
- [BDD 场景](firmware/open-deskos/tests/features/)

## 编译和烧录固件

P4 显示路径要求 ESP-IDF 6.0.1 或更高版本，S3 变体同样使用 ESP-IDF 6.0.1 构建。使用 [`eim`](https://github.com/espressif/idf-im-ui) 安装工具链，并通过指定版本运行每条 ESP-IDF 命令：

```bash
# 一次性安装 ESP-IDF 和目标工具。
eim install -i v6.0.1 -t esp32p4
eim install -i v6.0.1 -t esp32s3

cd firmware/open-deskos/application/open_deskos

# Guition JC4880P443C（P4 + C6，480x800）
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8（S3，240x320）——独立构建目录
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1
```

在 macOS 上，端口通常是 `/dev/cu.usbmodem*`；在 Linux 上通常是 `/dev/ttyACM0`。如果设备没有自动进入下载模式，按住 BOOT 的同时重置开发板，然后重新运行烧录命令。使用 `Ctrl-C` 退出监视器。

上面的 board ID 对应 `firmware/open-deskos/application/open_deskos/boards/guition/jc4880p443c/board_info.yaml` 和 `firmware/open-deskos/application/open_deskos/boards/waveshare/esp32_s3_touch_lcd_2_8/board_info.yaml`。生产固件不要选择其他 board ID。

## 测试

Host 测试和 BDD 相关 harness 位于 `firmware/open-deskos/tests/`，关键场景包括 `firmware-scope.feature`（双板生产范围）和 `s3-small-board.feature`（240x320 布局与目标门控）。

```bash
cd firmware/open-deskos
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

Native simulator 与 host 构建覆盖不同路径，因此模拟器通过不代表 ESP-IDF 构建也能通过。

## 参与开发

产品决策写入 `docs/open-deskos/OPEN-DESKOS.md`。固件修改请遵循 `firmware/open-deskos/AGENTS.md` 中的本地规则；新增行为前，先在 `firmware/open-deskos/tests/features/` 添加或更新场景。

## 许可证

当前仓库根目录没有包含 license 文件，固件子目录自带 `firmware/open-deskos/LICENSE`。
