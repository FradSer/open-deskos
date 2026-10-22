# Open DeskOS ESP32-P4 SC2336 Camera Subsystem

ESP32-P4 + SC2336 MIPI CSI Camera Peripheral for the CM5/Linux Open DeskOS architecture.
It exposes the sensor as a standard USB Video Class (UVC) MJPEG webcam and the board microphone as a standard USB Audio Class input.
There is no on-device face detection, owner recognition, expression classification, metadata protocol, or biometric storage in this firmware.
It is distinct from the preserved prior P4+C6 DeskOS device OS under `research/esp32-p4-c6-deskos/firmware/`.

## Architecture

```text
SC2336 RAW8 → ESP32-P4 MIPI CSI → hardware JPEG encode
  → standard UVC MJPEG isochronous stream on native USB → CM5 V4L2 video device
ES8311 microphone → I2S0 → standard UAC2 PCM stream on the same USB → CM5 ALSA capture
```

The P4 reports no vendor-specific camera metadata.
The CM5 opens the camera like any generic webcam (`v4l2-ctl`, `ffplay`, browsers) and the microphone like any USB audio input (`arecord`).

## Hardware Pinout

| Signal | ESP32-P4 Pin | Notes |
|---|---:|---|
| MIPI CSI-2 Data0 | D0P / D0N | Differential lane 0 |
| MIPI CSI-2 Data1 | D1P / D1N | Differential lane 1 |
| MIPI CSI-2 Clock | CLKP / CLKN | Differential clock lane |
| SCCB SDA | GPIO 7 | I2C master data |
| SCCB SCL | GPIO 8 | I2C master clock at 100 kHz |
| Camera Reset | GPIO 26 | Active-low reset |
| Power Down | -1 | Unconnected |

## USB Camera and Microphone

The native ESP32-P4 USB device port enumerates as a composite device with a stable identity (`303a:7002`):

- UVC carries one MJPEG function: 1280x720 at 30 fps over an isochronous endpoint.
- UAC2 exposes signed 16-bit mono PCM at 16 kHz for standard Linux ALSA capture.

The OSPTEK V1.3 schematic defines ES8311 I2S0 wiring.
MCLK uses GPIO 13; BCLK/SCLK uses GPIO 12; WS/LRCK uses GPIO 10.
ES8311 `ASDOUT` enters P4 capture on GPIO 11.
GPIO 9 is the opposite playback direction (`DSDIN`) and is not used by this microphone-only implementation.
ES8311 and SC2336 share I2C SDA GPIO 7 and SCL GPIO 8.
The codec uses wire-format address `0x30`, corresponding to 7-bit address `0x18`.

The P4 native USB pair uses GPIO 24/25 through the TS3USB221ARSER mux.
Connect the CM5 to the board's native USB **data** Type-C connector; the separate CH343P debug Type-C connector cannot carry UVC video or UAC audio.

For explicitly authorized live sensor acceptance on CM5, run as the kiosk user or root:

```sh
bash runtime/shell/scripts/p4-camera-acceptance.sh
bash runtime/shell/scripts/p4-microphone-acceptance.sh
```

The camera check requires USB identity `303a:7002`, resolves the V4L2 video device, and captures one bounded MJPEG frame to `/tmp/p4-camera-frame.*.mjpg`, removed on exit.
The microphone check requires the same USB identity and resolves its ALSA card.
It streams bounded raw PCM through a pipe without writing speech to disk.
It rejects silence, constant data, clipping, and truncated capture.
After acceptance, set `ODK_PERSONAL_AGENT_AUDIO_DEVICE=plughw:CARD=Microphone,DEV=0` in the device-local Personal Agent environment rather than hardcoding a numeric card index in a release.

The board-level wiring authority is the OSPTEK [`esp32-p4c6-module-dev-board`](https://gitee.com/osptek/esp32-p4c6-module-dev-board) repository at the reviewed V1.3 baseboard schematic.
The camera implementation follows the SC2336 MIPI CSI configuration demonstrated by [osptek/camera-mipi-csi-sc2336](https://github.com/osptek/camera-mipi-csi-sc2336), retaining its compatible SC2336 pins and `esp_video` capture boundary.
The capture-to-JPEG-to-UVC pipeline mirrors the official `esp_video` UVC example; the USB descriptors are app-owned so the UVC camera and UAC microphone share one composite device.

## Flash Layout

The 16 MB flash carries only firmware; no model or biometric partitions exist:

| Partition | Offset | Purpose |
|---|---:|---|
| `factory` | `0x10000` | Firmware app |

## Build and Flash

Flashing is separately authorized; compilation alone does not establish USB/video/audio acceptance.

Use ESP-IDF **6.0.1**:

```sh
cd peripherals/esp32-p4-camera
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
eim run 'idf.py -p PORT flash monitor' v6.0.1
```

Flashing may use the USB-UART bridge, but the CM5 camera and microphone connection must use the P4 native USB device port.

## Native Component Plugins

[`p4_camera_main.c`](main/p4_camera_main.c) starts six trusted native plugins through the shared [native host](../common/README.md).
The build generates lifecycle descriptors from [`main/plugins`](main/plugins).
Default initialization retains the storage, I2C, sensor, USB, microphone, and video order.
USB identity, descriptors, video geometry, PCM format, and hardware pins remain unchanged.

| Plugin | Published port | Required ports |
|---|---|---|
| Storage | `odk:p4/storage/v1` | None |
| I2C | `odk:p4/i2c/v1` | Storage |
| Camera | `odk:p4/camera/v1` | I2C |
| USB | `odk:p4/usb/v1` | Camera |
| Microphone | `odk:p4/audio/v1` | I2C, USB |
| Stream | `odk:p4/stream/v1` | Camera, USB; optional Audio |

[`p4_plugin_ports.h`](main/p4_plugin_ports.h) defines the typed port contracts.
The camera publishes capture and encoder device names.
The USB transport publishes video callbacks and audio binding operations with their context.
The stream and microphone consume these published values.
The optional Audio dependency preserves boot order without requiring an enabled microphone for video.

[`p4_camera_plugins.h`](main/p4_camera_plugins.h) exposes the resident host to the firmware lifecycle owner.
All plugins start enabled.
Replacement factories must publish the same required port contracts.
Cleanup retains providers while a dependent plugin still owns resources.

Microphone stop removes its USB source binding after in-flight callbacks complete.
A timeout retains capture resources for a later attempt.
An interface close failure can leave driver cleanup unresolved because the SDK frees that interface.
The microphone then blocks replacement and retains its remaining dependencies.
A failed UAC initialization remains failed until successful shared USB and UAC cleanup.

The video extension retains a detected CSI sensor when device registration fails.
It also retains pending sensor and SCCB resources across cleanup retries.
DVP cleanup remains upstream; this board uses CSI.

The TinyUSB build extension lets the USB worker complete its current callback before it exits.
Cleanup retains the task context and descriptors if the worker misses its exit deadline.
Stack and PHY cleanup retain ownership after failure and retry incomplete phases.
Early stack initialization can allocate resources before the SDK records its initialized state.
The extension retains that unresolved state and blocks replacement because the SDK cannot confirm cleanup.
Hardware USB, camera, microphone, and DMA acceptance have not run.

Run the isolated host fixtures with:

```sh
uv run --with pytest pytest -q peripherals/esp32-p4-camera/tests peripherals/common/tests
```

## TinyUSB Lifecycle

[`extend_tinyusb_lifecycle.py`](../../tools/extend_tinyusb_lifecycle.py) generates reviewed task, driver, and device-event sources in the build directory.
It verifies each source hash before generation and does not edit managed dependencies.
One lifecycle owner must serialize driver installation and cleanup.
The task copies its descriptor configuration before startup.
Descriptor data must remain valid until cleanup completes; this firmware uses static data.
The worker checks cancellation between device callbacks and exits through its own loop.
Cleanup waits for exit before it releases the stack, descriptors, and PHY.
The event group remains initialized across restarts to preserve its kernel lock.
Startup timeout retains the worker context and PHY while initialization remains active.
A stack or PHY failure retains ownership for the next cleanup attempt.
Successful cleanup phases do not run again.
The current firmware uses the default bus-powered configuration.
Self-powered VBUS interrupt teardown needs separate review before this firmware enables it.

Run the generated-code fixtures after you install the managed dependencies:

```sh
uv run --with pytest pytest -q peripherals/esp32-p4-camera/tests/test_tinyusb_lifecycle.py
```

## Audio Lifecycle Extension

The build extends the reviewed UAC dependency in its build directory.
It does not edit managed dependency sources.
[`extend_uac_lifecycle.py`](../../tools/extend_uac_lifecycle.py) requires the exact reviewed source hash.
A dependency update requires source review before extension generation can succeed.

[`p4_uac_lifecycle.h`](main/p4_uac_lifecycle.h) exposes cleanup for the shared USB driver configuration.
One lifecycle owner must serialize UAC initialization and cleanup.
Stop the shared TinyUSB driver before you call cleanup.
The audio tasks exit through their own loops.
A timeout retains their shared state for a later cleanup attempt.
The event group remains initialized across restarts to preserve its kernel lock.
Cleanup refuses standalone UAC configurations that own their TinyUSB task.

The native plugin host now controls the P4 boot sequence.
Host fixtures and target compilation do not establish device acceptance.

Run the generated-code lifecycle fixtures after you install the managed dependencies:

```sh
uv run --with pytest pytest -q peripherals/esp32-p4-camera/tests/test_uac_lifecycle.py
```

## Video Lifecycle

[`p4_uvc_stream.h`](main/p4_uvc_stream.h) exposes separate stop and cleanup operations.
One lifecycle owner must serialize initialization, start, stop, and cleanup.
The capture task signals its exit before cleanup releases video resources.
A stop timeout retains the task, descriptors, and buffers for a later attempt.
Initialization refuses an instance that still owns resources.
The exit event group remains initialized across restarts.
Restart restores capture and JPEG buffer queues cleared by the driver during stop.
A queue retry preserves each buffer already queued.

Stream and buffer cleanup failures retain their remaining resources for retry.
A descriptor close failure leaves driver cleanup unresolved.
The adapter blocks replacement because ESP-IDF removes the descriptor even when the driver close fails.
That state requires device recovery; repeating close could affect a reused descriptor.

The build extends the reviewed video receive and ioctl sources in its build directory.
[`extend_video_lifecycle.py`](../../tools/extend_video_lifecycle.py) requires all reviewed source hashes before it writes any file.
The extension does not edit managed dependency sources.

The lifecycle owner binds its running flag before the capture worker starts.
Bound receivers check that flag during semaphore waits without changing frame delivery.
Stopping the owner cancels an empty receive wait.
Unbound receivers retain the original driver wait behavior.
Cleanup removes each binding after worker exit and before descriptor close.
The flag must remain valid until all bound workers exit.

Cancellation does not interrupt a codec operation already in progress.
A stop timeout retains its task and resources until the operation completes.
Target compilation and staged fixtures do not establish hardware cancellation timing.

Run the video lifecycle fixtures with:

```sh
uv run --with pytest pytest -q peripherals/esp32-p4-camera/tests/test_uvc_lifecycle.py peripherals/esp32-p4-camera/tests/test_video_cancel.py
```

## BDD Contract

Behavior scenarios are maintained in [`tests/features/p4-camera.feature`](tests/features/p4-camera.feature).

## Development

`main/p4_camera_main.c` composes the native component plugins.
Sensor, video, microphone, USB transport, and descriptors have separate source owners.
See the native component table for their port contracts.
Scenarios live in `tests/features/p4-camera.feature`.
Use 4-space ESP-IDF C, `snake_case`, and explicit `esp_err_t` handling.
Preserve the documented pinout, MIPI capture boundary, and generic UVC/UAC behavior.
Do not manually edit `build/`, `managed_components/`, `sdkconfig`, `sdkconfig.old`, or dependency output.
Keep raw captures and biometric data out of the repository.
