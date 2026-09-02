# Ticket: Core Manifest v1 Schema & Capability Port Contract

**ID**: `001-core-manifest-schema-and-capability-ports`  
**Type**: `wayfinder:grilling` (HITL)  
**Parent Map**: [Universal Plugin Architecture Map](../MAP.md)  
**Status**: Closed (Resolved)  
**Assignee**: Agent / FradSer  
**Resolution Date**: 2026-08-31  

## Question

How should the universal Core Manifest v1 (`manifest.json` / static C descriptor schema) define metadata, plugin kinds (`surface`, `application`, `service`, `transport`, `device-driver`, `processor`, `protocol`, `integration`, `system`), lifecycle phases, provides/requires port capabilities, config schema, health checks, and signature verification across JS, Python, and ESP-IDF C?

## Resolution & Specification

### 1. JSON Schema Specification (`odk-plugin-manifest.v1.json`)

All plugins across JS, Python, and ESP-IDF C are defined by a canonical `manifest.json` adhering to Schema Version 1:

```json
{
  "$schema": "https://open-deskos.org/schemas/plugin-manifest.v1.json",
  "schemaVersion": 1,
  "id": "odk.transport.usb-cdc",
  "name": "USB CDC Remote Transport",
  "version": "1.0.0",
  "kind": "transport",
  "host": "remote-bridge",
  "description": "Transport adapter providing bidirectional JSON Lines over USB CDC",
  "author": "Open DeskOS Core Team",
  "entry": {
    "module": "./usb-cdc-adapter.js",
    "symbol": "createPlugin"
  },
  "dependsOn": [
    { "id": "odk.protocol.remote-message", "version": "^1.0.0" }
  ],
  "provides": [
    { "interface": "odk.transport.remote/v1", "description": "Remote Link framed stream transport" }
  ],
  "requires": [
    { "interface": "odk.driver.serial/v1", "optional": false }
  ],
  "permissions": [
    "hardware:serial:readwrite",
    "system:state:publish"
  ],
  "configSchema": {
    "type": "object",
    "properties": {
      "reconnectDelayMs": { "type": "integer", "default": 1000 }
    }
  },
  "health": {
    "mode": "active",
    "intervalMs": 5000,
    "timeoutMs": 1500
  },
  "distribution": {
    "source": "system",
    "signature": "sha256:..."
  }
}
```

### 2. Universal 8-Phase Lifecycle State Machine

All runtimes (JS, Python, ESP-IDF C) enforce the same 8-phase state transition model:

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

- **Core Lifecycle**:
  1. `register(hostContext)`: Validates manifest, binds port capabilities, registers in registry.
  2. `init(config, ports)`: Allocates buffers, binds dependencies, configures hardware/sockets.
  3. `start()`: Starts active polling, timers, listeners, or tasks.
  4. `pause()`: Suspends active timers/capture without losing state.
  5. `resume()`: Resumes execution from paused state.
  6. `stop()`: Halts timers, drops socket connections, powers down sensors/peripherals.
  7. `destroy()`: Frees heap allocations, destroys queues/mutexes, unregisters ports.
  8. `health()`: Active health probe returning `{ status: 'healthy' | 'degraded' | 'failed', details }`.
- **UI Surface Hook Extension**: Surface and Application plugins (`kind: 'surface' | 'application'`) extend this state machine with UI mounting hooks:
  - `mount(element, uiContext)`: Attaches DOM / LVGL object tree to host viewport.
  - `unmount(element, uiContext)`: Detaches and cleans up view hierarchy.

### 3. Versioned Capability Port Contract

- **`provides`**: Array of versioned interface URIs (e.g. `odk.transport.remote/v1`, `odk.face.presence/v1`).
- **`requires`**: Declares required or optional port dependencies with semver compatibility. Host Kernel constructs the directed acyclic graph (DAG) and rejects circular dependencies or unsatisfied required ports.
- **`permissions`**: Granular capability tokens (`hardware:serial:*`, `hardware:camera:*`, `network:unix-socket`, `ui:dialog`, `shell:state:read`) checked during port injection. Unrequested capabilities are unavailable.

### 4. ESP-IDF C Static Descriptor Mapping

For ESP-IDF firmware (`peripherals/esp32-s3-remote/`, `peripherals/esp32-p4-camera/`):
- CMake runs a pre-build generator (`tools/codegen_plugin_descriptor.py`) parsing each `plugin.manifest.json`.
- Emits static `odk_plugin_descriptor_t` definitions in `.rodata` with zero runtime heap allocation for manifest metadata.
- Compile-time feature flags toggle inclusion of descriptors and corresponding component sources.
