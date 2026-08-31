# Open DeskOS Guide

## FATFS Image Layout

Source content for all FAT partitions lives under a single tree, with one
subdirectory per partition:

```text
application/open_deskos/fatfs_image/
├── storage/   # → storage partition (writable, mounted at /fatfs)
└── system/    # → system partition (read-only seed, mounted at /system)
```

Each subdirectory is copied into its own build-time staging directory:

```text
application/open_deskos/build/fatfs_image/        # storage staging
application/open_deskos/build/system_fs_image/    # system staging
```

Each board can also provide optional board-specific FATFS content under its own board directory. This content is overlaid onto the `system` partition:

```text
application/open_deskos/boards/<vendor>/<board>/fatfs_image/
```

During the build, `application/open_deskos/CMakeLists.txt` first copies the base `fatfs_image/system/` directory into the system staging dir, then copies the selected board's `fatfs_image/` directory if it exists. The selected board path comes from the generated `components/gen_bmgr_codes/CMakeLists.txt`, which is produced by `idf.py bmgr`.

If a board-specific file has the same relative path as a base system file, the board-specific file overwrites the base file in `build/system_fs_image/`. This lets a board replace firmware-baked defaults such as skills, scripts, and static assets without changing the shared base image. Board `fatfs_image/` content targets the SYSTEM image only; hidden board folders are not considered.

Skill manifests and built-in Lua scripts/docs are synced into `build/system_fs_image/` so they end up on the read-only system partition; the writable storage partition can be reformatted at runtime and re-seeded from `/system` without losing them.


## Quick Start

### Prerequisites

- ESP-IDF 6.0.1 or newer is installed; use `eim` to select the version. The
  P4 MIPI-DSI path requires this newer toolchain.
- Install the board-manager helper once in the selected ESP-IDF environment:
  `pip install esp-bmgr-assist`

Run commands through the selected toolchain:

```bash
eim run "idf.py --version" v6.0.1
```

### Configuration

1. Generate board support files for the target you are building:

```bash
cd application/open_deskos
# Guition JC4880P443C (ESP32-P4 + C6)
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8
# Keep this target in the separate build-s3 directory below.
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1

# M5Stack PaperColor
# Keep this target in the separate build-m5paper directory below.
eim run "idf.py bmgr -c ./boards -b m5papercolor" v6.0.1
```

The supported board-manager targets are `jc4880p443c`,
`esp32_s3_touch_lcd_2_8`, and `m5papercolor`. Board-specific metadata lives under `boards/`.

2. Configure Wi-Fi, LLM, IM, search engine, and related parameters:

The key demo settings include:

- Wi-Fi SSID / Password
- LLM API Key / Provider / Model
- QQ App ID / App Secret
- Telegram Bot Token
- Brave / Tavily Search Key
- Timezone

Key Notes:

- IM bot token: available from Telegram [@BotFather](https://t.me/BotFather) or [QQ Bot](https://q.qq.com/qqbot/openclaw/login.html)
- LLM API key: available from [Anthropic Console](https://console.anthropic.com), [OpenAI Platform](https://platform.openai.com), or [Alibaba Cloud Bailian](https://bailian.console.aliyun.com/#/api-key)

You can adjust compile-time default values through `menuconfig`:

```bash
eim run "idf.py menuconfig" v6.0.1
```

3. Build and flash the selected target:

```bash
# Guition P4 + C6
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare S3 (separate build tree)
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1

# M5Stack PaperColor (separate build tree)
eim run "idf.py -B build-m5paper build" v6.0.1
eim run "idf.py -B build-m5paper -p PORT flash monitor" v6.0.1
```
