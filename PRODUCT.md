# Product

<!-- impeccable:product-schema 1 -->

## Platform

One Electron Display Shell runs on Linux, 64-bit Windows, and macOS.
CM5/RK3588S Linux is the reference Shell Host. Windows on ARM is unsupported.
Each host has separate capability and device acceptance results. Report missing capabilities as unavailable.

## Users

Personal developers and knowledge workers use a fixed desk display.
They read desk state from known sources, then open a view through touch, keyboard, or an accepted Remote Control.
A paired Console can drive a Hosted Pi session. Its control credentials are separate from report credentials.
The desk identifies that Console. Local input keeps authority.

## Product Purpose

Show known desk state. Make the available action clear. Keep a reliable way back.
The Shell remains useful when peripherals, providers, or experimental services fail. It does not require a Mac or Apple companion.

## Active Architecture

| Component | Responsibility |
| --- | --- |
| Shared Display Shell | Display, direct input, local data, services, and application orchestration |
| Personal Bot | Resident agent; its runtime role and vocabulary are defined in [Shell context](runtime/shell/CONTEXT.md) |
| Hosted Pi / Desk Link | Host sessions and attribute Console control; local input keeps authority |
| ESP32-S3 Remote / Remote Bridge | Touch Remote Control and its transport |
| ESP32-P4 SC2336 Camera | Generic UVC webcam and UAC microphone; no recognition, expression analysis, or identity storage |
| Local user Widgets/Apps | Self-contained HTML packages with independent draft, verify, install, update, rollback, and removal |

The S3 Remote and P4 Camera are CM5 components with separate hardware gates. Neither blocks base-shell operation.
The [Shell runbook](runtime/shell/README.md) and [Windows runbook](runtime/shell/docs/WINDOWS_HOST.md) define current host support.

## Preserved Research

[P4+C6 research](research/esp32-p4-c6-deskos/README.md) retains firmware, board variants, the simulator, and the Apple USB companion.
Its documents support reproduction. They do not define active requirements, startup, UI parity, or release gates.

## Brand Commitments

calm / precise / companion

The semantic palette and interaction rules are owned by [DESIGN.md](DESIGN.md).

## Product Principles

1. **Host ownership.** Runtime, data, services, and application orchestration live on the Shell Host.
2. **Truth before detail.** Show local or provider-sourced facts with provenance; never invent personal activity, health, calendar, or usage data.
3. **Independent peripheral gates.** Missing S3 or P4 hardware cannot block touch and keyboard.
4. **Explicit experiments.** C6/S31 gateways and future packages stay opt-in until promoted by a product decision.
5. **Research stays historical.** Preserve experiments without inheriting their product constraints.
6. **Escape is guaranteed.** Back restores the source context; direct input survives unavailable links.
7. **Bounded user packages.** Verified HTML Widgets/Apps do not imply a marketplace, native extensions, background services, or network permissions.
