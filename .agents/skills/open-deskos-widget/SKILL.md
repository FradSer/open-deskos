---
name: open-deskos-widget
description: >-
  Design and develop Open DeskOS CM5 Widgets and Apps on the Linux Electron runtime. Use whenever a request creates,
  redesigns, styles, refactors, debugs, or verifies a built-in tile/page/app/status plugin or an installable user Widget/App,
  including responsive layout, typography, icons, themes, truthful states, accessibility, density, and renderer interaction.
metadata:
  short-description: Open DeskOS Widget and App design-development workflow
---
# Open DeskOS Widget and App development

Use this skill for interface implementation and verification.
Use separate workflows for commits, worktree recovery, release staging, service operations, and deployment.

## 1. Route the surface

| Surface | Required guide | Implementation |
| --- | --- | --- |
| Shell-owned tile, page, status, or App | `runtime/shell/docs/AI_PLUGIN_GUIDE.md` | `runtime/shell/src/renderer/plugins/`; register with `odkPlugins`; place through `config/desktop_layout.js` |
| Installable user Widget or App | `runtime/shell/docs/USER_APPLICATIONS.md` | `ODESK_WORKSPACE/apps/<id>/manifest.json` and self-contained `index.html` |

Read the selected guide in full before implementation.
Prefer an installable package for standalone user-created features.
Use a built-in plugin when the trusted Shell must own the capability or privileged platform access.
Widgets are display-only.
An App is interactive.
Put controls and multi-step tasks in an App/page.
Built-ins access privileges through main/preload/application interfaces.
Renderer plugins must not read disk or call remote services directly.
Installable packages have no network, Node, filesystem, parent/preload, external assets, background service, or persistent app-data access.
Draft files are not installation.
Use the supported installation lifecycle.

## 2. Product and architecture contracts

Read `PRODUCT.md`, `DESIGN.md`, and `runtime/shell/CONTEXT.md` before interface changes.
Their contracts and machine-readable rules override generic design advice.

- Keep the desk interface calm and precise.
- Render truthful loading, empty, unavailable, unauthorized, stale, malformed, and error states. Never present them as live data.
- Built-in plugins use only `DESIGN.md` semantic `--odk-*` tokens.
- Installable packages cannot inherit Shell custom properties. Define a small local palette from the design values.
- Use color for functional state. Inactive surfaces use black/charcoal, transparent subrows, and structural outlines. Do not add glow or decorative tinted cards.
- Keep primary readings, row values, and actionable states at least 14px in `secondary-strong` or brighter.
- Reserve 12px `secondary` for non-data captions. Keep all supporting text at least 12px.
- Use tabular numerals for changing values. Montserrat display numerals may use `letter-spacing: -0.02em`; Pixel/Zpix resets to `normal`.
- Pixel icons must use upstream [Pixelarticons](https://github.com/halfmage/pixelarticons) artwork. Retain MIT attribution: Copyright (c) 2019 Gerrit Halfmann.
- Do not substitute stroked fallback icons, another pixel set, handmade approximations, or raster icons.
- Preserve direct touch and keyboard use when optional services/peripherals fail.
- Keep failed built-ins inside registry and shared-service failure boundaries.

## 3. Shape behavior with BDD

Write Given/When/Then in the affected `.feature` file.
For a bug, describe the failed visible state and add a failing test through a public interface.
Then implement, pass the test, and refactor.

Cover reachable success, loading, empty, unavailable, unauthorized, stale, malformed, and recoverable error states.
Include long English/CJK, compact/widescreen sizes, and Instrument/Pixel/Border Beam themes where inherited.
Interactive Apps also cover keyboard, touch, reduced motion, and screen-reader feedback.
State the available action and what remains usable when a dependency fails.

## 4. Design-development workflow

Start this workflow after BDD-first scenarios and a failing test.
Read every linked reference in its assigned phase.
Read linked supporting documents when the selected surface exercises that concern.
All local links must resolve.
Project guides override general advice.

### Phase A: Design and implement

Read [design](references/design.md) for information, layout, typography, color, writing, accessibility, icons, and implementation patterns.
Use existing product contracts and nearby implementations.
Preserve source meaning and recovery behavior.
For installable packages, follow the selected platform guide.
Define local CSS variables from the current `DESIGN.md` palette inside the package.
In an installable package, do not reference unresolved Shell `--odk-*` properties from the opaque iframe.

### Phase B: Test difficult states

Read [verification](references/verification.md) for stress states, density, font settling, IPC fixtures, safety, and evidence limits.
Run deterministic assertions against the final candidate.

## 5. Verification

Follow [verification](references/verification.md) for the applicable commands and isolation rules.
Built-ins require `tests/widget-app-styles.cjs` and `tests/widget-density.cjs` where applicable.
Run affected tests before shared gates.
Report unverified device and assistive-technology acceptance.
Do not relax density profiles to pass.

## 6. Post-creation interface review

Run this only after implementation and required verification are complete.
This review does not commit or deploy.
Read [review](references/review.md) for scope, evidence, severity, and report rules.
Classify introduced regressions separately from pre-existing findings.
Return corrections to the behavior/test workflow.
