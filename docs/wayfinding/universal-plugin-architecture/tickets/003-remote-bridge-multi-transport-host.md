# Ticket: Remote Bridge Multi-Transport Host & Protocol Modularization

**ID**: `003-remote-bridge-multi-transport-host`  
**Type**: `wayfinder:research` (AFK)  
**Parent Map**: [Universal Plugin Architecture Map](../MAP.md)  
**Status**: Closed (Resolved)  
**Assignee**: Agent  
**Resolution Date**: 2026-08-31  

## Question

How should `integrations/remote-bridge/` transition from a single hardwired adapter coordinator into an extensible Link Host Kernel that discovers and dynamically loads transport plugins (e.g. `usb-cdc`, future `c6-uart`, `esp-now-gateway`), protocol encoders/decoders, and Unix socket listeners without breaking the existing `/dev/serial/by-id/` wired slice?

## Resolution & Research Findings

### 1. Bridge Host Kernel Architecture (`RemoteBridgeHost`)

`integrations/remote-bridge/` is refactored from a single-adapter coordinator into a **Transport Host Kernel** with dynamic adapter arbitration:

```text
CM5 Graphical Session (systemd user service)
┌────────────────────────────────────────────────────────┐
│ Remote Bridge Host Kernel                              │
│  ├─ Transport Registry & Plugin Lifecycle Engine       │
│  ├─ Priority Transport Arbiter (Wired USB > Wireless) │
│  ├─ Unix Domain Socket Server (bridge.sock)            │
│  └─ Active Link State Machine                          │
└───────────────┬───────────────────────┬────────────────┘
                │                       │
┌───────────────▼─────────────┐ ┌───────▼────────────────┐
│ Plugin: transport-usb-cdc   │ │ Plugin: transport-c6   │
│  ├─ /dev/serial/by-id/ scan │ │  ├─ 3.3V UART Host Link│
│  ├─ CDC Stream I/O          │ │  └─ C6 ESP-NOW Gateway │
│  └─ Priority: 100 (High)    │ │  └─ Priority: 50 (Norm)│
└─────────────────────────────┘ └────────────────────────┘
```

### 2. Multi-Transport Arbitration & Failover Contract

- **Transport Priority**:
  - `usb-cdc`: Priority 100 (Active when USB device is enumerated under `/dev/serial/by-id/`).
  - `c6-uart`: Priority 50 (Active when C6 Gateway UART is online and S3 Remote is paired over ESP-NOW).
- **Seamless Handover**:
  When USB cable is plugged in, Host Kernel promotes `usb-cdc` to active transport, emits `link: "syncing"`, synchronizes authoritative `state` frame, and promotes to `link: "usb"`. When unplugged, Host Kernel seamlessly fails over to `c6-uart` (if wireless link is alive) emitting `link: "wireless"`.
- **Zero Client Interruption**:
  The Unix domain socket connection with Electron Display Shell remains open during transport handovers; Electron receives standard link state updates without socket reconnects.

### 3. Transport Plugin Contract (`odk.transport.remote/v1`)

Each transport is a self-contained plugin exporting the standard 8-phase lifecycle:

```js
module.exports = {
  manifest: {
    schemaVersion: 1,
    id: 'odk.remote.transport.usb-cdc',
    kind: 'transport',
    provides: [{ interface: 'odk.transport.remote/v1' }],
    permissions: ['hardware:serial:by-id'],
  },
  createPlugin(host) {
    return {
      init(config) { /* Bind serial scanner */ },
      async start() { /* Start scanning /dev/serial/by-id */ },
      async stop() { /* Close serial connection */ },
      async destroy() { /* Cleanup resources */ },
      async send(record) { /* Send framed JSON line */ },
      health() { return { status: 'healthy', transport: 'usb-cdc' } },
    }
  }
}
```

### 4. Backwards Compatibility & Verification

- Preserves 100% of existing tests in `integrations/remote-bridge/test/`.
- The CLI entrypoint `bin/open-deskos-remote-bridge.js` starts `RemoteBridgeHost` with the default `usb-cdc` plugin enabled, ensuring zero regression for the active wired slice.
