# Research Report: Refined Pluggability Architecture & Scope Boundary Specification

**File Location**: `docs/wayfinding/universal-plugin-architecture/RESEARCH-FULL-PLUGGABLE-GAP-ANALYSIS.md`  
**Authoring Context**: Matt Pocock Workflow (`idea-to-ship`, Scope Boundary Refinement)  
**Scope**: Open DeskOS Core (`runtime/linux/`, `docs/UNIVERSAL-PLUGIN-ARCHITECTURE.md`, `docs/wayfinding/universal-plugin-architecture/`)  
**Status**: Authoritative Product & Engineering Scope  

---

## 1. Executive Summary & Authoritative Scope Boundaries

Following direct architectural review, the pluggability roadmap has been strictly pruned and scoped:

### Explicitly Excluded from Pluggability (Host-Owned Core Responsibilities)
To preserve the quiet, reliable desk instrument identity and prevent fragmented UX, the following subsystems **remain non-pluggable core shell features**:
1. **Status Bar Center (`#page-center`)**: Remains strictly owned by the core shell pager (dots and page context). No third-party slot injection.
2. **App Window Frame (`#app-view`)**: Remains the unified, host-managed modal frame with the standard Back button, title, and `#app-runtime` container. No custom window decorators.
3. **Viewport & Pager Engine (`createPager`)**: The horizontal swipe carousel and keyboard navigation (`ArrowLeft`/`ArrowRight`/`Home`/`End`) remain standard, deterministic shell infrastructure.
4. **No Freeform `kind: 'overlay'`**: Third-party plugins cannot inject arbitrary full-screen overlay components. Instead, plugins **push structured alerts/information into a system-managed Overlay surface** (Heads-Up Display / Alert System).

### Mandated Pluggable Capabilities (The 4 Pillars)
1. **System Background Services (`kind: 'service'`)**:
   - **Must be fully pluggable**: Extensible service registry supporting continuous, long-running services such as **local audio transcription (Whisper/STT)**, device telemetry, sensor streaming, and custom background daemons.
2. **Generic Main-Process IPC Bridge (`ctx.callBackend`)**:
   - **Must be fully pluggable**: A secure, capability-gated RPC bridge between renderer plugins and Node.js backend modules in the main process, eliminating the need to modify `main.js` and `preload.js` for every new hardware or system capability.
3. **Desktop Grid Auto-Assembly (`contributions`)**:
   - **Must be fully pluggable**: Plugins declare their default grid placement and size preferences in their manifest (`contributions.slot = "home.grid"`), allowing the Composer to automatically lay them out without manual edits to `desktop_layout.js`.
4. **Theme & Semantic Design Tokens (`kind: 'theme'`)**:
   - **Must be fully pluggable**: Support dynamic overriding of `--odk-*` tokens, with **Pixel Art / Retro Pixelated Style** authored and verified as the second first-party built-in theme.
5. **Information Access to Overlay (System Alerts / HUD)**:
   - System provides a controlled API (`ctx.postOverlayAlert({ title, message, level, timeoutMs })`) for plugins to display urgent, high-priority notifications through the host's managed overlay.

---

## 2. Deep Dive: The 4 Core Capabilities

### 2.1 Pluggable System Background Services (`kind: 'service'`)
- **Use Case**: Local Audio Transcription service (e.g. listening to microphone input via Whisper or streaming speech-to-text), background sync daemons, Bluetooth device pollers.
- **Contract**:
  ```javascript
  root.odkPlugins.register({
    id: 'odk.service.audio-transcription',
    manifest: {
      schemaVersion: 1,
      provides: [{ interface: 'odk.interface.stt/v1' }],
      permissions: ['audio:capture', 'backend:spawn'],
    },
    kind: 'service',
    async start(ctx) {
      // Connect to microphone or local transcription server
    },
    stop() {
      // Release audio stream
    },
    export() {
      return {
        isTranscribing: () => true,
        subscribe: (listener) => { /* stream live transcripts */ },
      }
    },
  })
  ```
- **Consumer Seam**: Any Tile, App, or Status plugin accesses active services via `ctx.services.get('odk.service.audio-transcription')`.

---

### 2.2 Generic Main-Process IPC Bridge (`ctx.callBackend`)
- **Problem**: Previously, adding a capability like `scanPiSessions` required manually registering `ipcMain.handle('odk-pi-sessions')` in `main.js` and adding `getPiSessions` to `preload.js`.
- **Architecture**:
  - Main Process owns a single router:
    `ipcMain.handle('odk-plugin-rpc', async (_event, { pluginId, action, payload }) => ...)`
  - Verifies `pluginId` and checks that the requested `action` matches declared permissions in the plugin's manifest.
  - Dispatches to backend handler registered under `src/main/plugins/<id>.js`.
  - Renderer Preload exposes a universal, sandboxed bridge:
    `ctx.callBackend(action, payload)` (auto-scoped to the calling plugin ID).

---

### 2.3 Desktop Grid Auto-Assembly (`contributions`)
- **Problem**: Adding new tiles requires manually allocating rows and columns in `config/desktop_layout.js`.
- **Architecture**:
  - In `manifest.json`:
    ```json
    "contributions": {
      "slot": "home.grid",
      "preferredSpan": "1x1",
      "defaultRoute": "today"
    }
    ```
  - `core/composer.js` auto-packing algorithm scans registered tile plugins, calculates available grid cells (on 5x3 widescreen or 3x5 portrait), and automatically places unassigned tiles without requiring hardcoded configuration entries.

---

### 2.4 Dynamic Themes & Pixel Art Second Theme (`kind: 'theme'`)
- **Problem**: `DESIGN.md` and `shell.css` only define a single static dark minimal theme.
- **Architecture**:
  - `kind: 'theme'` plugin registering custom `--odk-*` variables, font families, and pixel borders.
  - **Pixel Art Theme Specification**:
    - Colors: High-contrast monochrome & retro phosphor palette (Deep black `#0a0a0a`, Pixel Green `#38d948`, Retro Amber `#f5a623`, Crisp White `#ffffff`).
    - Typography: Stepped pixelated typography / monospace styling.
    - Borders: Stepped solid box strokes (`border-radius: 0px`, `box-shadow` stepping).
  - Quick-switch selector available in Built-in Views / Settings.

---

### 2.5 Information Injection into Overlay
- **Problem**: Overlays were locked to an unused, hardcoded `#privacy-shield`.
- **Architecture**:
  - Rather than letting plugins mount arbitrary full-screen HTML, the Host Kernel maintains a unified **System HUD / Alert Overlay**.
  - Plugins call `ctx.system.notify({ title, text, icon, durationMs })`.
  - The host renders a clean, accessible AIODI-compliant banner or alert modal without relinquishing window security.

---

## 3. Targeted Implementation Roadmap

| Phase | Core Objective | Key Deliverables |
|:---:|---|---|
| **Phase 1** | **Service Registry & Audio Transcription Seam** | • Refactor `core/services.js` into dynamic `ServiceRegistry`<br>• Update `core/registry.js` to support dynamic `ctx.services`<br>• Implement sample Audio Transcription service stub/contract |
| **Phase 2** | **Generic Main-Process IPC RPC Bridge** | • Main process `odk-plugin-rpc` router with permission checks<br>• Preload `ctx.callBackend`<br>• Migrate Pi Sessions to the generic RPC bridge |
| **Phase 3** | **Desktop Auto-Assembly Engine** | • Composer auto-packing for `contributions.slot: "home.grid"`<br>• Zero-configuration widget mounting |
| **Phase 4** | **Pixel Art Theme & Token Engine** | • Theme registry (`kind: 'theme'`)<br>• Built-in Pixel Art theme plugin with retro palette and zero-radius tokens<br>• Theme switcher integration in Settings |
| **Phase 5** | **System Managed Overlay Alert Channel** | • Overlay controller in `shell.js`<br>• Controlled `postAlert()` API for plugins |