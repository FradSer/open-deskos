---
name: open-deskos-widget
description: >-
  Design and develop Open DeskOS CM5 Widgets and Apps on the Linux Electron runtime. Use whenever a request creates,
  redesigns, styles, refactors, debugs, or verifies a built-in tile/page/app/status plugin or an installable user Widget/App,
  including responsive layout, typography, icons, themes, truthful states, accessibility, density, and renderer interaction.
metadata:
  short-description: Open DeskOS Widget and App design-development workflow
---

# Open DeskOS Widget and App Design Development

Use this skill to take an Open DeskOS Widget or App from product intent through verified runtime implementation. Its boundary is the interface artifact: architecture, data seams, interaction, visual craft, tests, and post-creation review. Git commits, shared-worktree recovery, CM5 release staging, service operations, and device deployment belong to their dedicated workflows.

## 1. Route the surface

Classify the requested artifact before editing. The two architecture paths are intentionally separate.

### Trusted built-in runtime surface

Use for Shell-owned tiles, pages, status indicators, and built-in Apps under `runtime/linux/src/renderer/plugins/`.

- Read `runtime/linux/docs/AI_PLUGIN_GUIDE.md` completely before implementation.
- Register through `odkPlugins`; place pages and tiles through `config/desktop_layout.js`.
- Keep a Widget (`kind: 'tile'`) display-only and glanceable.
- Put controls and multi-step interaction in an App/page surface.
- Route privileged behavior through the existing main/preload/application seam; renderer plugins do not read disk or call remote services directly.

### Installable user application

Use when the request is for a locally installable user-created Widget or App under `ODESK_WORKSPACE/apps/<id>/`.

- Read `runtime/linux/docs/USER_APPLICATIONS.md` completely before implementation.
- A user Widget is display-only; a user App is interactive.
- Author the bounded `manifest.json` plus self-contained `index.html` package.
- Work within the sandbox: no network, Node, filesystem, parent/preload API, external assets, background service, or persistent app data.
- Creating draft files is not installation. Verification and installation use the supported user-application lifecycle.

If the request says only “Widget” or “App,” infer the path from its intended ownership and capabilities. Prefer an installable user application for user-generated standalone functionality; use a built-in plugin only when the capability must be part of the trusted Shell or use privileged platform seams.

## 2. Product and architecture contracts

Read `PRODUCT.md`, `DESIGN.md`, and `runtime/linux/CONTEXT.md` before changing the interface. Preserve these invariants:

- Open DeskOS is a calm, precise desk instrument, not a generic AI interface or analytics dashboard.
- State is truthful. Loading, empty, unavailable, unauthorized, stale, malformed, and error states never masquerade as live data.
- Built-in plugins use only `DESIGN.md` semantic `--odk-*` tokens. Installable packages cannot inherit Shell custom properties, so they carry a small self-contained palette derived from `DESIGN.md` values inside their own HTML. In both paths, color communicates functional state rather than decoration.
- Inactive surfaces stay quiet: black/charcoal field, transparent sub-rows, structural outlines, no glow or decorative tinted cards.
- Supporting text remains at least `12px`; changing numeric values use tabular numerals.
- Text that carries the tile's primary information (readings, row values, states the user acts on) must be at least `14px` in `secondary-strong` or brighter. `12px` `secondary` is reserved for non-data captions such as provenance or timestamps; data set in small dim type fails readability even when it passes the size floor.
- Montserrat display numerals may use `letter-spacing: -0.02em`; Pixel/Zpix overrides reset it to `normal`.
- Pixel icons are Pixelarticons. An icon that renders in the Pixel theme must be [halfmage/pixelarticons](https://github.com/halfmage/pixelarticons) artwork (MIT, Copyright (c) 2019 Gerrit Halfmann), never a stroked fallback, another pixel set, a hand-drawn approximation, or a raster asset. Section 4 Phase C gives the built-in and installable routes.
- Direct touch and keyboard stay usable when optional services or peripherals are absent.
- A broken built-in plugin remains contained by the registry and shared-service fault boundaries; do not bypass them.

## 3. Shape behavior with BDD

Start every behavior change in the corresponding `.feature` file using Given/When/Then. For a bug, add a regression scenario that describes the failing user-visible state. Then create a failing automated test through a public seam before changing implementation.

Define the reachable state matrix before styling:

- live/success
- loading or in-progress
- empty
- unavailable or disconnected
- unauthorized/configuration required
- stale
- malformed input
- error with recovery
- long English text and CJK
- compact and widescreen geometry
- Instrument, Pixel, and Border Beam themes when the surface inherits Shell themes
- keyboard, touch, reduced motion, and screen-reader announcements for interactive Apps

The scenario and tests must state what is true, what action is available, and what remains usable when the dependency fails.

## 4. Design-development workflow

Follow this workflow only after the BDD-first scenario and red test in section 3 exist. The inherited interface entries under `references/` are mandatory inputs. Read every linked reference in its assigned phase. Read linked supporting documents when the selected surface exercises that concern. Every local Markdown link must resolve within the skill reference tree. `PRODUCT.md`, `DESIGN.md`, the selected runtime guide, and machine-readable contracts override general advice.

### Phase A: Recon and intent

1. Read [explain-interface](references/explain-interface.md) to map the existing component, surrounding surface, token use, theme behavior, layout, and effects.
2. Read [better-writing](references/better-writing.md) and nearby product copy. Define concise, consistent live, empty, unavailable, stale, error, and recovery text.
3. Inspect representative plugins or user apps with the same kind and density instead of inventing a parallel pattern. When refining an existing interface, responding to repeated feedback, changing displayed information, or defining acceptance across runtime boundaries, read [Design judgment and acceptance evidence](references/widget-parity-and-data-recovery.md). Diagnose interacting constraints before tuning symptoms, and match verification evidence to the intended outcome.

Completion criterion: the selected architecture path, user task, data provenance, state matrix, neighboring conventions, and verification seams are explicit.

### Phase B: Design the real surface

1. Read [better-layout](references/better-layout.md), [better-typography](references/better-typography.md), [better-colors](references/better-colors.md), and [better-ui](references/better-ui.md). Read [better-ui-icons](references/better-ui-icons.md) when the surface renders an icon. For a built-in tile, copy the matching example in [tile-examples](references/tile-examples.md) instead of inventing a parallel pattern.
2. For a materially new direction, read [variant](references/variant.md) and build meaningful candidates in the real surface. Vary structure, density, emphasis, type, or voice—not cosmetic tints. Remove the variant harness after promotion.
3. Use shared alignment edges and semantic spacing. Group with space before adding borders or nested surfaces.
4. For vertical metrics, stack label above value/unit. Keep status/header placement from displacing the geometric center of the primary reading.
5. Build responsive geometry from actual content and layout spans. Compact layouts retain readable cells and scroll rather than shrinking the full page.

Completion criterion: the design works in its real page/app context, expresses hierarchy without fabricated decoration, and has a defensible compact behavior. After repeated visual rejection, revisit the design assumption using [evidence appropriate to the claim](references/widget-parity-and-data-recovery.md#match-proof-to-the-claim); measured geometry alone does not establish visual quality or user approval.

### Phase C: Implement the architecture path

For built-in plugins:

- Keep the plugin self-contained and register the correct `kind`.
- Add a dedicated plugin stylesheet when styles are substantial; scope selectors to the plugin surface.
- Add the script to the verified renderer composition and declare placement when required.
- Use `ctx.onTick` and scoped subscriptions rather than private intervals.
- Add or extend a narrow main/preload IPC seam for external data; normalize, bound, and cache untrusted sources in the main process.
- Use `textContent` for untrusted strings. Validate remote images in main and pass only bounded safe assets/data URLs.
- Author every icon as `svg[data-tabler="<name>"]` with `viewBox="0 0 24 24"` and the Tabler outline path, then add the matching Pixelarticons path to `runtime/linux/src/renderer/icons/pixelarticons.js` (`root.PIXELARTICON_PATHS`) using unmodified upstream artwork. `core/icons.js` performs the Pixel swap; a name without a pixel entry stays stroked in the Pixel theme and fails `tests/pixel-icons.test.js`. When upstream has no counterpart, compose from upstream artwork in the existing `-off`/composite idiom and record the deviation in `src/renderer/icons/PIXELARTICONS-NOTICE.md`, keeping the MIT notice intact.
- Implement cleanup for subscriptions, listeners, frames, or resources not automatically owned by scoped context.

For installable user applications:

- Keep the package self-contained and within the documented size and sandbox limits.
- Define local CSS variables from the current `DESIGN.md` palette inside the package; do not reference unresolved Shell `--odk-*` properties from the opaque iframe. Keep the local palette limited to roles the package actually renders.
- Icon path data is not served to a package. Embed the same Pixelarticons artwork with its MIT notice inside the package and switch to it on `html[data-theme="pixel"]`; the package's own stroke variant is not a substitute for that variant.
- Make Widget packages display-only. Interactive behavior belongs only to `kind: "app"`.
- Treat state as ephemeral unless the platform explicitly adds a persistence contract.
- Do not modify Shell composition to install one user package.

For both paths, read [better-accessibility](references/better-accessibility.md). Use native controls, visible focus, meaningful names, logical DOM order, 44px touch targets where possible, reduced-motion behavior, and stable live regions. Do not put high-frequency counters inside an atomic live region.

Completion criterion: behavior passes the focused tests, architecture dependencies point through supported seams, and every reachable state renders truthful text without breaking adjacent surfaces.

### Phase D: Stress real states

Read [break](references/break.md) and [break scenarios](references/break-scenarios.md). Exercise the real component with deterministic fixtures for every applicable state in the matrix. Prefer existing Electron/DOM harnesses; temporary stress routes do not ship.

Measure geometry instead of accepting screenshots as proof:

```js
const host = document.querySelector('[data-widget="odk.tile.example"]')
const rect = host.getBoundingClientRect()
JSON.stringify({
  contained: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
  overflows: host.scrollWidth > host.clientWidth + 1 || host.scrollHeight > host.clientHeight + 1,
})
```

Use screenshots only for human communication. Bounds, overflow, font size, wrapping, focus, state, and density must be asserted through live DOM/runtime evidence.

Completion criterion: applicable worst-case content, failure, theme, input, and resolution cases are represented by deterministic tests or fixtures, with no temporary diagnostic artifact left in the product.

## 5. Verification

Run the smallest relevant tests first, then the gates affected by the change. Execute the commands below via SSH on the real CM5, in an isolated fixture environment that cannot activate windows or affect production data/services. Do not substitute development-machine or foreground tests. If safe execution is unavailable, report the blocker. See [verification safety](references/widget-parity-and-data-recovery.md#keep-verification-safe) for harness isolation and screenshot handling.

### Built-in Widget/App baseline

```bash
cd runtime/linux
node --test tests/<focused>.test.js
node --test tests/pixel-icons.test.js
pnpm styles
bash tests/smoke.sh
pnpm exec electron tests/widget-app-styles.cjs
pnpm exec electron tests/widget-density.cjs
```

Use `pnpm e2e` when page composition, navigation, App interaction, theme behavior, or shared Shell surfaces change. Use `references/density-and-styling.md` when creating a density profile or debugging font-settling and IPC fixture issues.

Density defaults:

- content envelope: 54–70%, centered on 62%
- occupied area union: at least 20%, unless a justified instrument profile defines another bound
- maximum full-width empty band: 28%

### Installable user Widget/App baseline

```bash
cd runtime/linux
node --test tests/user-app*.test.js
pnpm exec electron tests/user-app-lifecycle.cjs
pnpm test
bash tests/smoke.sh
```

Add product-specific tests for the package’s behavior within its sandbox. The verifier proves bounded loading and visibility, not complete business correctness.

### External-data additions

Add deterministic fixtures for success, unavailable, malformed, slow, unauthorized, empty, corrupt cache, and stale cache. When displayed information changes, preserve its [information contract](references/widget-parity-and-data-recovery.md#preserve-the-information-contract) and update every affected verification layer with representative content. Confirm renderer CSP and actual Electron asset loading when remote images become bounded local/data assets.

Report exactly which commands passed and which device-only or assistive-technology checks remain unverified. Fixture success does not establish live operational acceptance. For separately authorized deployment, hand off [outcome-based acceptance](references/widget-parity-and-data-recovery.md#verify-outcomes-across-boundaries) to its owning workflow; intermediate health indicators cannot substitute for the user's observable outcome. This gate does not authorize deployment or service operations.

## 6. Post-creation interface review

Run this only after implementation and required verification are complete. It reports quality and does not commit or deploy.

1. Read [interface-review](references/interface-review.md) and [interface-review scope resolution](references/interface-review-scope-resolution.md).
2. Read [better-interface](references/better-interface.md) and [review format](references/better-interface-review-format.md).
3. Consolidate evidence from accessibility, colors, layout, typography, UI, writing, stress states, and runtime geometry.
4. Classify introduced regressions separately from pre-existing findings. Preserve deliberate Open DeskOS decisions.
5. If an introduced regression needs correction, return to the BDD workflow and verify the corrective change.

## Reference inventory

Implementation references:

- [better-accessibility](references/better-accessibility.md)
- [better-colors](references/better-colors.md)
- [better-layout](references/better-layout.md)
- [better-typography](references/better-typography.md)
- [better-ui](references/better-ui.md)
- [better-ui-icons](references/better-ui-icons.md)
- [better-writing](references/better-writing.md)
- [tile-examples](references/tile-examples.md)
- [break](references/break.md)
- [explain-interface](references/explain-interface.md)
- [variant](references/variant.md)

Post-creation review references:

- [better-interface](references/better-interface.md)
- [interface-review](references/interface-review.md)
