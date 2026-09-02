# Ticket: CM5 Linux Runtime Host Kernel & Plugin Lifecycle Seam

**ID**: `002-cm5-linux-runtime-host-kernel-seam`  
**Type**: `wayfinder:prototype` (HITL)  
**Parent Map**: [Universal Plugin Architecture Map](../MAP.md)  
**Status**: Closed (Resolved)  
**Assignee**: Agent / FradSer  
**Resolution Date**: 2026-08-31  

## Question

How should `src/main.js` and `src/renderer/` be partitioned into a minimal Electron Host Kernel (window policy, IPC gateway, permission boundaries, plugin loader) while decomposing monolithic features (OpenCode Go, Remote Bridge Client, Face Agent status, Windowing/Kiosk logic, App Manager endpoint, and visual surfaces) into standalone, discoverable, lifecycle-managed plugins with intent routing?

## Resolution & Specification

### 1. Dual Host Kernel Architecture (Main + Renderer)

The CM5 Electron runtime is partitioned into two cooperating minimal Host Kernels with zero business logic:

```text
Electron Main Process (Node.js)
┌────────────────────────────────────────────────────────┐
│ Main Host Kernel (src/main/kernel.js)                  │
│  ├─ Single instance lock & GPU flags                   │
│  ├─ BrowserWindow kiosk policy & strict CSP enforcement│
│  ├─ PermissionRequestHandler (deny-all default)        │
│  ├─ MainPluginRegistry & Manifest discovery            │
│  └─ Capability-Gated IPC Gateway Broker                │
└────────────────────────┬───────────────────────────────┘
                         │ IPC (Channel names strictly capability-gated)
┌────────────────────────▼───────────────────────────────┐
│ Preload Gateway (src/preload/index.js)                 │
│  └─ Pure contextBridge proxy without domain logic      │
└────────────────────────┬───────────────────────────────┘
                         │ window.odkHost / window.odkPlatform
┌────────────────────────▼───────────────────────────────┐
│ Renderer Host Kernel (src/renderer/core/kernel.js)     │
│  ├─ IPC Manifest query & dynamic ES Module loader      │
│  ├─ DAG dependency resolver & 8-phase lifecycle engine │
│  ├─ Intent Seam & AppPlatform intent router            │
│  ├─ Declarative Composer (desktop_layout.js)           │
│  └─ Error Boundary & Truthful Degradation Card fallback│
└────────────────────────────────────────────────────────┘
```

### 2. Main Process Modularization

Monolithic code from `src/main.js` is partitioned into modular plugins under `src/main/plugins/`:

1. **`odk.main.remote-bridge`** (`kind: 'integration'`):
   - Manifest: `provides: ["odk.ipc.remote-link/v1"]`, `permissions: ["network:unix-socket"]`.
   - Manages connection to Remote Bridge Unix Domain Socket (`bridge.sock`).
   - Dispatches link state and navigation events through IPC.
2. **`odk.main.opencode-go`** (`kind: 'service'`):
   - Manifest: `provides: ["odk.ipc.opencode-go/v1"]`, `permissions: ["network:http:external"]`.
   - Fetches truthful subscription quotas and rolling usage.
3. **`odk.main.face-agent-status`** (`kind: 'integration'`):
   - Manifest: `provides: ["odk.ipc.face-agent/v1"]`, `permissions: ["network:http:loopback"]`.
   - Polls loopback Face Agent endpoint (`http://127.0.0.1:8790/status`).
4. **`odk.main.app-manager`** (`kind: 'service'`):
   - Manifest: `provides: ["odk.ipc.app-manager/v1"]`.
   - Authoritative app registry, transactional state transitions, and rollback mechanisms.

### 3. Renderer Dynamic Module Discovery & Loading

- `src/renderer/index.html` becomes a completely clean DOM shell (no static `<script src="plugins/...">` tags).
- At startup, `src/renderer/core/kernel.js`:
  1. Requests the verified plugin list from Main Host Kernel via IPC (`odk:host:get-manifests`).
  2. Dynamically loads modules via `import(`./plugins/${plugin.id}/index.js`)`.
  3. Registers each plugin in `odkPlugins` and runs the DAG dependency resolver.
  4. Executes `init()` and `start()` in topological order.
  5. Mounts visual plugins (`surface`, `application`) into DOM slots defined by `config/desktop_layout.js`.

### 4. Fault Isolation & Degradation Policy

- **Main Process Services**: Any uncaught exception in a main-process service plugin transitions that plugin into `degraded` or `failed` state. A health notification is sent over IPC; the main Electron process and window never crash.
- **Renderer Visual Plugins**: If a tile, page, or widget throws during `mount()` or `onTick()`, the Renderer Kernel catches the error, calls `unmount()` on the failing plugin, and mounts a standard **AIODI Truthful Degradation Card** (`.w-degraded`) displaying the exact fault status without breaking adjacent UI components or page navigation.
