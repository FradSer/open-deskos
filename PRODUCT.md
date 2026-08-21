# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Open DeskOS ships one product across platforms that each own their native design language: on-device LVGL/Lua UI (AIODI design system) on the **Guition JC4880P443C 480×800 portrait panel only**, SwiftUI client apps (`app/apple/`), a planned Rust macOS menu-bar companion (OPEN-DESKOS.md §10), and web surfaces (docs site, embedded SolidJS settings UI). Other boards and the 928×262 landscape bar are future research/form-factor references, not supported firmware targets.

## Users

Personal developers and knowledge workers at a Mac keyboard. The device sits beside the keyboard as a glanceable companion: they look down for status (time, timer, AI quota, connection), then tap into an app when the task needs more than a glance. Context is short attention, one hand near the trackpad, ambient desk light, not a lean-back browsing session.

## Product Purpose

Open DeskOS is a desktop companion operating system on ESP32-P4 + ESP32-C6: voice-to-cursor input, a modular widget home screen, an extensible plugin runtime, a small built-in app suite, and an ESP-NOW hub for nearby desk peripherals. Success on the panel means glanceable status, physical page/app navigation, and zero trapdoors (Back always works). The only supported firmware canvas is the Guition JC4880P443C 480×800 portrait panel under the AIODI design system. The 928×262 landscape bar and alternate boards remain non-production research references.

## Positioning

A desk-side OS device, not a keyboard peripheral: the user speaks to the device and text appears at the macOS cursor (HID + vendor-channel injection); the user generates apps with their own prompts and installs them from a shared catalog, on-device. A neighboring product could copy the touchscreen or the mic — it could not truthfully copy the combination of voice-to-cursor injection plus a prompt-built app platform running self-hosted Wi-Fi, independent of the Mac's sleep state.

## Operating Context

Desk beside a Mac keyboard, connected over USB-C (composite HID + vendor channel). Device holds its own Wi-Fi via ESP32-C6 (esp-hosted SDIO), so widgets keep refreshing while the Mac sleeps. The macOS companion is the host-side half of the product — Chinese text injection, calendar/usage data push, package sideloading all flow through it. All shipped firmware targets the Guition JC4880P443C 480×800 portrait panel. Alternate form factors, including the 928×262 landscape bar, are not supported production hardware.

## Capabilities and Constraints

Five product pillars (OPEN-DESKOS.md §1): voice input (typeless-style dictation with polish/translate), extensible plugin runtime (esp-claw base; Lua sandbox; App Center archived for refactor), widget home screen, built-in app suite (pomodoro, calendar, AI chatbot, AI usage), ESP-NOW peripheral hub. Hard constraints: hardware gates HG-2–HG-4 (esp-hosted SDIO concurrency, audio chain bring-up, landscape rendering) remain open; M1 "typewriter" runs without a display. Firmware is the esp-claw fork; runtime LLM is first-class but quota-gated.

## Brand Commitments

calm / precise / companion

Quiet confidence at the desk. Numerals and status read like instruments, not marketing. The shell feels like a small OS you trust with a flick of the thumb, not a dashboard you configure.

Anti-references: SaaS analytics dashboards (hero metrics, identical card grids, purple gradients); neon cyber / glassmorphism for decoration; generic AI landing-page aesthetics; nested cards and side-stripe accents; decorative motion that does not convey state.

## Evidence on Hand

- `docs/open-deskos/OPEN-DESKOS.md` — top-level product authority (2026-07-07)
- `DESIGN.md` — AIODI on-device design system; Figma `aCjWcJawjHWCqXXxFVckjS` is the visual source of truth
- `firmware/open-deskos/` — landed firmware (esp-claw fork); AIODI launcher + voice-generated LVGL Lua UI verified in the native SDL sim and on the P4 panel
- `app/apple/` — SwiftUI client (read-only/remote/settings subset)
- No marketing site, testimonials, or external proof assets exist; future work must not fabricate them.

## Product Principles

1. **AIODI is law on-device.** Tokens, tiles, and builders in `aiodi` win over ad-hoc styling; Figma `aCjWcJawjHWCqXXxFVckjS` is the visual source of truth.
2. **Glance first, dive second.** Home surfaces answer "what is true right now" in one look; apps open for the next action.
3. **System, not website.** Navigation is pager + Back + live peek chrome; gestures should feel physical (momentum, snap, elastic), not page-reload.
4. **One accent job.** Saturated color marks state or a single focal widget (ring, year fill, quota bar), never decoration on every tile.
5. **Escape is guaranteed.** The launcher owns the frame; no app may trap the user without Back.

## Accessibility & Inclusion

Touch-first targets sized for fat fingers on a 480×800 portrait panel. Contrast follows AIODI primary/secondary tokens on black. No separate WCAG product mandate beyond readable type and high-contrast status. Prefer motion that conveys navigation state (page coast/snap, page-dot progress); skip ornamental animation. Color-blind users still get shape/position cues (dots, layout), not color alone.
