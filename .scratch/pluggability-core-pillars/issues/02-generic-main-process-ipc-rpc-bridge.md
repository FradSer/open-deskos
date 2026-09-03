# 02 — Generic Capability-Gated Main-Process IPC RPC Bridge

**What to build:** A unified, secure capability-gated RPC bridge between renderer plugins and Node.js backend extensions in the main process (`ctx.callBackend(action, payload)`), verifying requested actions against declared manifest permissions and routing execution without manually modifying `src/main.js` or `src/preload.js`.

**Blocked by:** 01 — Dynamic Background Service Registry & Audio Transcription Seam

**Status:** closed

- [x] Main process provides a unified `odk-plugin-rpc` handler validating caller plugin identity against loaded manifest permissions
- [x] Requests attempting actions without declared manifest permissions fail closed with explicit permission-denied errors
- [x] Preload exposes a sandboxed `ctx.callBackend(action, payload)` automatically scoped to the calling plugin
- [x] The Pi Sessions backend detection routes through this generic bridge, eliminating ad-hoc IPC handlers
- [x] Backend extension failures report structured error diagnostics without crashing the Electron main process
