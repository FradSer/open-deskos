# Open DeskOS 固件

本目录包含 Open DeskOS 生产固件及三个受支持的 board-manager 目标：

- **Guition JC4880P443C**：ESP32-P4 主处理器、ESP32-C6 Wi-Fi/ESP-NOW 协处理器、ST7701S MIPI-DSI 480×800 竖屏、GT911 触摸。
- **Waveshare ESP32-S3 Touch LCD 2.8**：ESP32-S3、ST7789 SPI 240×320 显示屏、CST328 触摸。
- **M5Stack PaperColor**：ESP32-S3、ED2208 SPI 400×600 墨水屏、M5PM1 PMIC。

生产固件工程位于 [`application/open_deskos/`](application/open_deskos/)。板级定义位于
[`application/open_deskos/boards/`](application/open_deskos/)，支持的 ID 是
`jc4880p443c`、`esp32_s3_touch_lcd_2_8` 和 `m5papercolor`。上游独立示例工程不属于当前固件树。

## 编译与烧录

使用 ESP-IDF 6.0.1 或更高版本。P4 MIPI-DSI 显示路径不支持上游项目使用的旧版
IDF。

```bash
cd research/esp32-p4-c6-deskos/firmware/application/open_deskos
# Guition JC4880P443C（P4 + C6）
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8（独立构建目录）
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1

# M5Stack PaperColor（独立构建目录）
eim run "idf.py bmgr -c ./boards -b m5papercolor" v6.0.1
eim run "idf.py -B build-m5paper build" v6.0.1
eim run "idf.py -B build-m5paper -p PORT flash monitor" v6.0.1
```

board-manager 步骤会在 `components/gen_bmgr_codes/` 生成板级组件。删除构建目录或修改板级定义后，需要重新执行该步骤；S3 目标使用独立的 `build-s3` 目录。

需要时，C6 网络镜像单独构建并嵌入：

```bash
cd research/esp32-p4-c6-deskos/firmware
tools/build_c6_espnow_slave.sh
```

## Native 模拟器

SDL2 模拟器无需 ESP-IDF 或 Emscripten，即可在桌面运行相同的 Lua/LVGL UI 源码。
macOS 支持交互窗口，也支持 CI 使用的脚本化无界面运行。详见
[`sim/native_sdl/README.md`](sim/native_sdl/README.md)。

```bash
cd research/esp32-p4-c6-deskos/firmware/sim/native_sdl
./run.sh
```

## 验证

Host 测试不需要 ESP-IDF：

```bash
cd research/esp32-p4-c6-deskos/firmware
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

Native 模拟器使用 SDL2 IO/PARTIAL 渲染路径。模拟器通过不代表生产 P4 MIPI-DSI adapter 或 S3 SPI 路径通过；烧录真机前必须执行对应目标的 ESP-IDF 构建验证固件。
