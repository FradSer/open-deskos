# Product

<!-- impeccable:product-schema 1 -->

## Platform

Open DeskOS is a CM5/RK3588S Linux desk runtime with an Electron kiosk shell. It has two required architecture peripherals with independent hardware acceptance gates: an ESP32-S3 touch Remote Control and an ESP32-P4 SC2336 Camera Peripheral. The base CM5 shell remains usable through direct touch and keyboard before either peripheral is accepted. The prior ESP32-P4+C6 DeskOS device OS and its Apple USB companion are preserved research, not active product platforms.

## Users

Personal developers and knowledge workers using a fixed desk display. They glance at current time, focus, network, and explicitly configured account state, then use direct touch, keyboard, or the accepted Remote Control to enter a focused view. The system must remain useful during peripheral, network-provider, or experimental-service degradation.

## Product Purpose

Open DeskOS is a truthful desk companion: a CM5 display runtime that makes the current desk state legible without fabricated personal data, opens focused built-in views without trapping the user, and composes accepted peripherals through explicit protocols. It does not require a Mac or Apple companion.

## Active Architecture

```text
CM5 Linux / Electron runtime
  ├─ direct touch and keyboard
  ├─ ESP32-S3 Remote Control peripheral
  ├─ ESP32-P4 SC2336 Camera Peripheral
  ├─ Remote Bridge integration
  └─ opt-in Face Agent experiment
```

The S3 Remote and P4 Camera are intended system components. Their hardware acceptance is independent from the CM5 base-shell acceptance. Face Agent/owner recognition is experimental and cannot make the base shell inert or hidden.

## Preserved Research

`research/esp32-p4-c6-deskos/` preserves the earlier parallel exploration: P4 as a UI/HID/voice host, C6 as Wi-Fi/ESP-NOW coprocessor, LVGL/Lua/AIODI shell, board variants, native simulator, ESP-IDF tests, and Apple USB serial companion. It supplies historical evidence only; it cannot define active runtime requirements, boot paths, UI parity, release gates, or product authority.

## Brand Commitments

calm / precise / companion

The CM5 shell inherits the semantic Open DeskOS token palette: black field, charcoal surfaces, restrained red/green/blue state accents, and heavy numerals. Its interaction model is a desk instrument, not a dashboard: show what is true, make an available action clear, preserve a reliable way back.

## Product Principles

1. **CM5 owns the runtime.** Linux services, display, local data, and application orchestration live on CM5.
2. **Truth before detail.** Show locally known or provider-sourced state with provenance; never invent personal activity, health, calendar, or usage data.
3. **Peripheral gates are independent.** S3 Remote and P4 Camera have dedicated hardware acceptance; missing hardware cannot block base-shell operation.
4. **Experiments do not become prerequisites.** Face Agent, owner recognition, C6/S31 gateways, and future packages remain opt-in until a product decision promotes them.
5. **Preserve research without inheriting its constraints.** The P4+C6 device OS and Apple companion stay reproducible in research and do not define the active product.
6. **Escape is guaranteed.** Back returns to the source context; direct touch and keyboard remain usable when Remote Link is unavailable.
