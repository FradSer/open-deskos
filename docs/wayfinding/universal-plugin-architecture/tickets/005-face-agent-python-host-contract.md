# Ticket: Face Agent Python Host & Opt-In Degradation Contract

**ID**: `005-face-agent-python-host-contract`  
**Type**: `wayfinder:grilling` (HITL)  
**Parent Map**: [Universal Plugin Architecture Map](../MAP.md)  
**Status**: Closed (Resolved)  
**Assignee**: Agent / FradSer  
**Resolution Date**: 2026-08-31  

## Question

How should `experiments/vision/face-agent/` be refactored into a lightweight Python Host Kernel with modular plugins for serial capture, frame metadata validation, state store, and HTTP status server, ensuring failure/degradation cleanly reports `camera-unavailable`/`stale` without impacting the CM5 display runtime?

## Resolution & Specification

### 1. Functional Pipeline Modularization

`experiments/vision/face-agent/` decomposes the monolithic `face_service.py` into decoupled, importable functional modules:

```text
experiments/vision/face-agent/
  ├─ transport.py          # Serial port scanner & raw line stream reader (/dev/open-deskos-p4-camera)
  ├─ normalizer.py         # Pure fail-closed metadata validation & emotion/geometry normalization
  ├─ state.py              # Status transition model (starting, no-frame, camera-unavailable, online)
  ├─ server.py             # aiohttp 127.0.0.1:8790 loopback HTTP API
  └─ face_service.py       # Composition root wiring transport ➔ normalizer ➔ state ➔ server
```

### 2. Architecture Deviation Note & Technical Debt Warning

> ⚠️ **Architecture Caveat (过渡性纯函数管道例外)**:  
> Current decision: Keep Face Agent as an importable functional pipeline without a full Python dynamic `HostKernel` or `manifest.json` registry.  
> **This is explicitly marked as a transitional/non-standard pattern**. Because Face Agent is an opt-in experimental sub-service, full Python plugin host infrastructure is deferred until vision capability graduates into active product authority. Future migration must align Face Agent with the Universal Manifest v1 contract.

### 3. Fail-Closed Degradation Contract

- **Truthful Status Codes**:
  - `starting`: Service is initializing or serial port is opening.
  - `no-frame`: Serial device connected, but no valid inference frame received yet.
  - `camera-unavailable`: Device disconnected, serial open failed, or P4 sequence stale (>3.0s).
  - `online`: Valid inference frame received within 3.0s window.
- **Base Shell Isolation**:
  - Face Agent HTTP `/status` is polled via `127.0.0.1:8790` by the main-process plugin `odk.main.face-agent-status`.
  - Network timeouts (1500ms) or HTTP errors gracefully emit `{ state: 'unavailable' }` to Renderer.
  - Face Agent absence or crashes never block CM5 boot, touch, keyboard, or UI tile rendering.
