# Wayfinding Map: Universal Plugin Architecture for Open DeskOS

**Label**: `wayfinder:map`  
**Status**: Open  

## Destination

Establish a unified cross-runtime Plugin Architecture Specification and Core Manifest v1 contract covering all active Open DeskOS subsystems (CM5 Linux Runtime, Remote Bridge, ESP32-S3 Remote Peripheral, ESP32-P4 Camera Peripheral, Face Agent Experiment), reducing each runtime to a minimal non-pluggable Host Kernel while modularizing all product features, transports, and UI into decoupled plugins.

## Notes

- **Domain**: Embedded systems (ESP-IDF C), Desktop runtime (Electron/Node.js), IPC transport (Unix domain socket, USB CDC, HID), Python background services, and Plugin Lifecycle management.
- **Inspiration & Pattern**: Hybrid of Pi (directory auto-discovery, lifecycle hooks, trusted local execution, dynamic capability injection) and Omarchy (strict manifest schema, central registry, enabled/disabled configuration, CLI management, hot-reload in dev).
- **Core Principle**: Truth before detail; unaccepted peripherals and experiments must not block core CM5 touch/keyboard usability. MCU plugins are statically compiled descriptors, while Linux/JS/Python plugins are modular manifests.

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Core Manifest v1 Schema & Capability Port Contract](tickets/001-core-manifest-schema-and-capability-ports.md) — Unified 8-phase lifecycle state machine, versioned capability port URIs, granular permissions, and CMake pre-build C descriptor codegen across JS, Python, and ESP-IDF C.
- [CM5 Linux Runtime Host Kernel & Plugin Lifecycle Seam](tickets/002-cm5-linux-runtime-host-kernel-seam.md) — Dual Host Kernel model (Main Process Node services + Renderer dynamic ES Module surfaces), clean DOM shell, capability-gated Preload proxy, and error boundary with AIODI degradation cards.
- [Remote Bridge Multi-Transport Host & Protocol Modularization](tickets/003-remote-bridge-multi-transport-host.md) — Transport Host Kernel with priority arbitration (Wired USB CDC vs Wireless C6 UART / ESP-NOW), standard `odk.transport.remote/v1` interface, and seamless client socket persistence during failover.
- [ESP-IDF Peripheral Static Plugin Descriptor & Build Pipeline](tickets/004-esp-idf-peripheral-static-plugin-descriptor.md) — Flash `.rodata` static C descriptor `odk_plugin_descriptor_t`, pre-build Python/CMake codegen pipeline, modularized S3 Remote and P4 Camera firmware plugins, and 100% zero-hardware CTest contracts.
- [Face Agent Python Host & Opt-In Degradation Contract](tickets/005-face-agent-python-host-contract.md) — Decoupled functional pipeline (`transport`, `normalizer`, `state`, `server`), fail-closed truthful status degradation, and documented transitional architecture caveat.
- [Trusted Plugin Packaging, Signature & CLI Management Tooling](tickets/006-trusted-plugin-packaging-signature-cli.md) — Three-tier discovery scope (`plugins.dev`, `plugins`, `system`), full `open-deskos plugin` CLI suite, Release Key signatures, interactive permission consent, and <200ms dev hot-reload.

## Open Tickets (The Frontier & Blocked)

<!-- All initial frontier tickets are resolved! Map is fully charted. -->
*(None — The way to the destination is completely charted and clear)*

## Not yet specified

<!-- Fog of war: in-scope fog you can't ticket yet; graduates as the frontier advances -->

- Dynamic hot-reload engine in production vs dev mode for CM5 Electron runtime.
- Inter-plugin event bus / IPC permissions model for user-authored plugins.
- Migrating existing test harness and smoke scripts to plugin-matrix testing.
- Remote ESP-NOW wireless transport plugin specification once C6 hardware is verified.

## Out of scope

<!-- Work ruled beyond the destination; closed, never graduates -->

- `research/esp32-p4-c6-deskos/`: Preserved historical P4+C6 device OS research is frozen and will not be migrated into this active plugin system.
- Remote third-party untrusted code execution or unverified dynamic downloading over the air on MCU firmware.
