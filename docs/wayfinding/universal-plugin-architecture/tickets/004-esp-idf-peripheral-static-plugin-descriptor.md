# Ticket: ESP-IDF Peripheral Static Plugin Descriptor & Build Pipeline

**ID**: `004-esp-idf-peripheral-static-plugin-descriptor`  
**Type**: `wayfinder:research` (AFK)  
**Parent Map**: [Universal Plugin Architecture Map](../MAP.md)  
**Status**: Closed (Resolved)  
**Assignee**: Agent  
**Resolution Date**: 2026-08-31  

## Question

How should `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/` express firmware drivers (display, touch, SC2336), transport protocols (HID, CDC, Camera Metadata), and pipeline processors (gesture, face inference, physical owner enrollment) as statically registered C plugin descriptors matching Core Manifest semantics, compile-time feature toggles, and independent host-test validation?

## Resolution & Research Findings

### 1. ESP-IDF Static C Plugin Descriptor (`odk_plugin_descriptor_t`)

Firmware plugins use a compile-time static descriptor in `.rodata`, requiring **zero runtime heap allocations** for metadata:

```c
typedef enum {
    ODK_KIND_DEVICE_DRIVER,
    ODK_KIND_TRANSPORT,
    ODK_KIND_PROCESSOR,
    ODK_KIND_SERVICE,
    ODK_KIND_SURFACE,
    ODK_KIND_PROTOCOL,
} odk_plugin_kind_t;

typedef struct {
    const char *interface_uri; /* e.g. "odk.transport.remote/v1" */
    uint16_t version_major;
    uint16_t version_minor;
    bool optional;
} odk_port_desc_t;

typedef struct {
    esp_err_t (*init)(void *host_ctx, const void *config);
    esp_err_t (*start)(void);
    esp_err_t (*pause)(void);
    esp_err_t (*resume)(void);
    esp_err_t (*stop)(void);
    esp_err_t (*destroy)(void);
    esp_err_t (*health)(odk_health_status_t *out_status);
} odk_plugin_lifecycle_t;

typedef struct {
    const char *id;                     /* e.g. "odk.s3.driver.st7789" */
    const char *name;
    uint32_t version;
    odk_plugin_kind_t kind;
    const odk_plugin_lifecycle_t *lifecycle;
    size_t provides_count;
    const odk_port_desc_t *provides;
    size_t requires_count;
    const odk_port_desc_t *requires;
} odk_plugin_descriptor_t;
```

### 2. Pre-Build Codegen & Registration Pipeline (`tools/codegen_plugin_descriptor.py`)

1. **Manifest as Canonical Source**:
   Each firmware plugin has its own `plugin.manifest.json` placed in its directory (e.g. `plugins/driver_st7789/plugin.manifest.json`).
2. **CMake Pre-Build Generator**:
   CMake invokes `python3 tools/codegen_plugin_descriptor.py` during configuration/build.
3. **Artifact Generation**:
   - Validates JSON Schema and capability ports.
   - Generates `odk_generated_plugins.h` and `odk_generated_plugins.c`.
   - Generates the topological startup sequence array `s_active_plugin_descriptors[]`.
4. **Linker Placement**:
   Plugin descriptors reside in flash `.rodata` and are resolved statically.

### 3. Firmware Modularization Map

#### A. ESP32-S3 Remote Peripheral (`peripherals/esp32-s3-remote/`)
- `odk.s3.driver.st7789` (`kind: device-driver`): Panel power, SPI bus, ST7789 init, DMA frame rendering.
- `odk.s3.driver.cst328` (`kind: device-driver`): I2C touch controller, coordinate normalization.
- `odk.s3.processor.gesture` (`kind: processor`): Swipe & tap recognition (100% host-testable in CTest).
- `odk.s3.transport.tinyusb-hid` (`kind: transport`): USB HID keyboard reports (`ArrowLeft` / `ArrowRight`).
- `odk.s3.transport.tinyusb-cdc` (`kind: transport`): USB CDC-ACM JSON Line transport for state frames.
- `odk.s3.surface.remote-ui` (`kind: surface`): 240x320 UI renderer, AIODI styling, fallback "Connecting".

#### B. ESP32-P4 Camera Peripheral (`peripherals/esp32-p4-camera/`)
- `odk.p4.driver.sc2336` (`kind: device-driver`): SCCB I2C, MIPI-CSI, frame DMA streaming.
- `odk.p4.processor.face-inference` (`kind: processor`): On-device NPU face detection & landmark pipeline.
- `odk.p4.service.owner-enrollment` (`kind: service`): Physical button ISR, one-shot enrollment gating.
- `odk.p4.transport.tinyusb-cdc` (`kind: transport`): Stream framed inference metadata to CM5.
- `odk.p4.diagnostic.snapshot` (`kind: processor`): Optional still-frame dump (gated by Kconfig).

### 4. Zero-Hardware Host Testing (CTest)

- Pure algorithms (e.g. `navigation_gesture.c`, `p4_camera_protocol.c`) remain isolated from FreeRTOS/ESP-IDF drivers.
- Executed on macOS/Linux host via standard `cmake -S tests/host -B build/host && ctest`.
- Build failures in target IDF do not invalidate host contracts, and vice versa.
