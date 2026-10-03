# Product

<!-- impeccable:product-schema 1 -->

## Platform

Open DeskOS uses one Electron Display Shell on Linux, 64-bit Windows, and macOS. The CM5/RK3588S Linux panel is the reference Shell Host. A host does not create a separate product variant; unported capabilities report unavailable, and host/device acceptance is recorded separately. Windows on ARM is not a supported host. The CM5 architecture includes an ESP32-S3 touch Remote Control and an ESP32-P4 SC2336 Camera Peripheral with independent hardware acceptance gates. The prior ESP32-P4+C6 device OS and Apple USB companion are preserved research, distinct from a macOS Shell Host.

## Users

Personal developers and knowledge workers using a fixed desk display. They glance at current time, focus, network, and explicitly configured account state, then use direct touch, keyboard, or the accepted Remote Control to enter a focused view. A paired Mac may also drive a Pi session the desk hosts, under a credential separate from reporting; the desk names which machine is driving for as long as that lasts, and local input always keeps its authority. The system must remain useful during peripheral, network-provider, or experimental-service degradation. It also supports a local user-application lifecycle: self-contained Widget/App packages can be drafted, verified, installed, updated, rolled back, and removed independently of the built-in Shell release.

## Product Purpose

Open DeskOS is a truthful desk companion: a shared Display Shell that makes the current desk state legible without fabricated personal data, opens focused built-in views without trapping the user, and composes accepted peripherals through explicit protocols. It does not require a Mac or Apple companion.

## Active Architecture

```text
CM5 Linux / Electron runtime
  ├─ direct touch and keyboard
  ├─ ESP32-S3 Remote Control peripheral
  ├─ ESP32-P4 SC2336 Camera Peripheral (generic UVC webcam + UAC microphone)
  ├─ Hosted Pi sessions, drivable from a paired Mac Console over the Desk Link
  └─ Remote Bridge integration

64-bit Windows / Electron runtime (the same Display Shell)
  ├─ direct keyboard and pointer
  ├─ Pi Sessions, with the optional native reader for session work directories
  └─ Remote Control, voice, and Desk Link: not ported, reported unavailable

macOS / Electron runtime (the same Display Shell)
  ├─ direct keyboard and pointer
  └─ local development and configured services, with separate host acceptance
```

The S3 Remote and P4 Camera are intended system components. Their hardware acceptance is independent from the CM5 base-shell acceptance. The P4 Camera performs no face recognition, expression analysis, or identity storage: it is a standard webcam and microphone.

## Preserved Research

`research/esp32-p4-c6-deskos/` preserves the earlier parallel exploration: P4 as a UI/HID/voice host, C6 as Wi-Fi/ESP-NOW coprocessor, LVGL/Lua/AIODI shell, board variants, native simulator, ESP-IDF tests, and Apple USB serial companion. It supplies historical evidence only; it cannot define active runtime requirements, boot paths, UI parity, release gates, or product authority.

## Brand Commitments

calm / precise / companion

The CM5 shell inherits the semantic Open DeskOS token palette: black field, charcoal surfaces, restrained red/green/blue state accents, and heavy numerals. Its interaction model is a desk instrument, not a dashboard: show what is true, make an available action clear, preserve a reliable way back.

## Product Principles

1. **The Shell Host owns its runtime.** Display, local data, services, and application orchestration live on the host; CM5 is the reference Linux host.
2. **Truth before detail.** Show locally known or provider-sourced state with provenance; never invent personal activity, health, calendar, or usage data.
3. **Peripheral gates are independent.** S3 Remote and P4 Camera have dedicated hardware acceptance; missing hardware cannot block base-shell operation.
4. **Experiments do not become prerequisites.** C6/S31 gateways and future packages remain opt-in until a product decision promotes them.
5. **Preserve research without inheriting its constraints.** The P4+C6 device OS and Apple companion stay reproducible in research and do not define the active product.
6. **Escape is guaranteed.** Back returns to the source context; direct touch and keyboard remain usable when Remote Link is unavailable.
7. **User packages stay bounded.** Local user Widgets/Apps are opaque, self-contained HTML packages managed through verification; this is not a marketplace, native-extension, background-service, or network-permission platform.
