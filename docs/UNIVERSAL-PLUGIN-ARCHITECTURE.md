# Open DeskOS Universal Plugin Architecture Specification (v1.0)

**Authority Status**: Approved Architectural Target & Implementation Reference  
**Scope**: Entire active Open DeskOS Codebase (`runtime/linux/`, `integrations/remote-bridge/`, `peripherals/esp32-s3-remote/`, `peripherals/esp32-p4-camera/`, `experiments/vision/face-agent/`)  
**Derived From**: Wayfinding Map `docs/wayfinding/universal-plugin-architecture/MAP.md`

---

## 1. Executive Summary & Core Principle

Open DeskOS enforces a strict universal design rule across all active platforms:

> **All product features, UI surfaces, system services, drivers, and transports are independent plugins. Each runtime environment retains only a minimal, non-pluggable Host Kernel.**

The Host Kernel is strictly limited to:
1. Manifest discovery & schema validation
2. Dependency DAG topological sorting
3. Universal 8-phase lifecycle state machine orchestration
4. Granular capability injection & permission gating
5. Active health probing, fault isolation, and truthful degradation
6. Configuration persistence & low-level OS bootstrap

---

## 2. Universal Core Manifest Schema (`odk-plugin-manifest.v1.json`)

Every plugin across JS, Python, and ESP-IDF C declares its identity, dependencies, and capabilities in a canonical `manifest.json`:

```json
{
  "$schema": "https://open-deskos.org/schemas/plugin-manifest.v1.json",
  "schemaVersion": 1,
  "id": "odk.category.plugin-name",
  "name": "Human-readable Name",
  "version": "1.0.0",
  "kind": "surface | application | service | transport | device-driver | processor | protocol | integration | system",
  "host": "electron-main | electron-renderer | remote-bridge | esp32-s3 | esp32-p4 | python-agent",
  "entry": {
    "module": "./index.js",
    "symbol": "createPlugin"
  },
  "dependsOn": [
    { "id": "odk.other.plugin", "version": "^1.0.0" }
  ],
  "provides": [
    { "interface": "odk.interface.name/v1", "description": "Exported capability URI" }
  ],
  "requires": [
    { "interface": "odk.required.port/v1", "optional": false }
  ],
  "permissions": [
    "hardware:serial:by-id",
    "network:unix-socket",
    "ui:surface:tile"
  ],
  "configSchema": {
    "type": "object",
    "properties": {}
  },
  "health": {
    "mode": "active",
    "intervalMs": 5000,
    "timeoutMs": 1500
  },
  "distribution": {
    "source": "system | user | dev",
    "signature": "sha256:..."
  }
}
```

---

## 3. Universal 8-Phase Lifecycle State Machine

All runtimes implement identical transition states and cleanup semantics:

```text
[Unregistered] ── register ──> [Registered] ── init ──> [Initialized]
                                                            │
                                                          start
                                                            │
                                                            ▼
 [Destroyed] <── destroy ── [Stopped] <── stop ─── [Running] <───┐
                                                       │          │
                                                     pause      resume
                                                       │          │
                                                       ▼          │
                                                   [Paused] ──────┘
```

- **Core Lifecycle**: `register(hostCtx)` ➔ `init(config, ports)` ➔ `start()` ➔ (`pause()` / `resume()`) ➔ `stop()` ➔ `destroy()`, plus periodic `health()`.
- **UI Extension**: Visual plugins (`kind: 'surface' | 'application'`) extend this with `mount(element, uiCtx)` and `unmount(element, uiCtx)`.

---

## 4. Subsystem Architecture Realization

### A. CM5 Linux Runtime (`runtime/linux/`)
- **Main Host Kernel (`src/main/kernel.js`)**: Owns single-instance locks, GPU switches, Kiosk window management, strict CSP, and capability-gated IPC dispatch. Monolithic code is modularized into `src/main/plugins/` (`remote-bridge`, `opencode-go`, `face-agent-status`, `app-manager`).
- **Renderer Host Kernel (`src/renderer/core/kernel.js`)**: Dynamic ES Module loader (`import()`), DAG scheduler, and declarative layout composer (`desktop_layout.js`).
- **Error Boundaries**: Uncaught plugin errors display truthful AIODI Degradation Cards (`.w-degraded`) without crashing neighboring widgets or window navigation.

### B. Remote Bridge (`integrations/remote-bridge/`)
- **Transport Host Kernel (`RemoteBridgeHost`)**: Manages priority arbitration across transports (`usb-cdc` priority 100 > `c6-uart` / `esp-now` priority 50).
- **Socket Persistence**: Electron's Unix domain socket connection persists through transport failovers; links emit clean `syncing` ➔ `usb` / `wireless` state transitions.

### C. ESP-IDF Peripherals (`esp32-s3-remote` & `esp32-p4-camera`)
- **Static C Descriptors (`odk_plugin_descriptor_t`)**: Generated pre-build by CMake (`tools/codegen_plugin_descriptor.py`) into `.rodata` with zero heap allocation.
- **S3 Remote Modules**: `driver.st7789`, `driver.cst328`, `processor.gesture`, `transport.tinyusb-hid`, `transport.tinyusb-cdc`, `surface.remote-ui`.
- **P4 Camera Modules**: `driver.sc2336`, `processor.face-inference`, `service.owner-enrollment`, `transport.tinyusb-cdc`, `diagnostic.snapshot`.
- **100% CTest Isolation**: Pure algorithms and protocol encoders/decoders testable on host without hardware.

### D. Face Agent (`experiments/vision/face-agent/`)
- **Functional Pipeline**: Partitioned into `transport.py`, `normalizer.py`, `state.py`, and `server.py`.
- **Transitional Caveat**: Marked as an opt-in experimental sub-service; returns fail-closed `camera-unavailable`/`no-frame` status without blocking base CM5 operation.

### E. CLI Management & Packaging (`open-deskos plugin`)
- **Discovery Scopes**: `plugins.dev/` (development symlinks), `~/.config/open-deskos/plugins/` (user installed), `/opt/open-deskos/runtime/plugins/` (system signed).
- **CLI Commands**: `list`, `validate`, `add` (interactive consent), `remove`, `link`, `enable`, `disable`, `diagnose`, `update`.
- **Development Hot-Reload**: Live `<200ms` hot-reloading for renderer plugins during development.
