# Pre-order surface plugin contract

## Scope

`odk.tile.preorder` owns the countdown and hero canvas.
Its surface is display-only and retains `minCell: 186`.
The Shell owns placement, theme selection, shared Tick delivery, and lifecycle management.
This contract does not add ordering, navigation, network access, or provider services.

## Display behavior

The opening time is `2026-10-16T12:00:00Z`.
Before opening, display complete days and remaining complete hours.
At opening, display `Open now`.
Keep the caption `Pre-order · 5:00 a.m. PT 10.16` and existing accessibility attributes.
Do not change the document or container during replacement or default restoration.

The shared artwork is `assets/hero-preorder.jpg`.
Its normalized focus region is `{ x: 0.1, y: 0, w: 0.8, h: 0.76 }`.
Scale that region to cover the figure without distortion, then center the crop.
Use the existing rounded figure dimensions and dimension fallbacks.
Preserve calculation order when floating-point differences affect raster sampling.

Pixel uses four-pixel blocks sampled at each block's center.
Clamp samples at the right and bottom edges.
Other themes retain standard image drawing.
Failed pixel buffer access retains the standard image.
Theme changes trigger drawing through Tick delivery.
This contract does not add redraw on resize without a theme change.

## Public context and resource ownership

| Context member | Responsibility |
| --- | --- |
| `onTick(callback)` | Deliver time and own the subscription through the registry |
| `trackCleanup(callback)` | Fence released surface work, including failed-release retries |
| `signal` | Suppress work after factory cancellation |

Pending image and captured Tick callbacks must leave released surfaces unchanged.
Surface release must work without requiring factory shutdown.
Failed subscription release retains ownership and permits retry.
Successful cleanup callbacks must not repeat during retry.
Disable and enable retain the selected implementation and unrelated surfaces.

## Independent implementation

The [independent entry](../tests/fixtures/preorder-surface-replacement/entry.js) owns countdown, crop calculation, Pixel processing, and callback fences.
It shares static markup, artwork, styles, fonts, and the focus-region contract.
It does not call the default mount or import default feature helpers.
Common cover-scale arithmetic retains raster compatibility; this is not evidence of a different artwork policy.

## Acceptance sources and limits

The [scenarios](../tests/features/preorder-surface-replacement.feature) define active behavior, release, recovery, and controlled rejection.
The [Node checks](../tests/preorder-surface-lifecycle.test.js) use the actual registry and common Host.
They cover opening boundaries, exact crop parameters, partial Pixel blocks, buffer rejection, release fences, and retry.
The [browser checks](../tests/preorder-surface-electron.test.js) use actual preload, private profiles, external discovery, and the public Renderer controller.
They compare canvas digests, countdowns, and text boundaries across three themes and three actual viewports.
Resource observation starts before the first actual mount.
Static comparisons drive observed Tick callbacks and wait for layout, stylesheet, and image completion.
The isolated browser uses software rasterization for exact pixel comparisons.
GPU presentation requires separate host evidence.
Separate countdown transitions use the actual shared timer.
Discovery and signed asset authority release while the window remains alive.
The parent separately waits for actual child closure before profile removal.

Controlled entries omit Tick subscription or Pixel processing through each loading mode.
Their intended guards must reject them; unrelated errors do not count as evidence.
These guards validate the acceptance fixture, not production behavioral admission of arbitrary code.

## Authenticated production Main activation

The existing [Clock production fixture](../tests/clock-main-bootstrap.test.js) also installs the independent Pre-order entry beside calendar and static tool surfaces.
Actual Main runs every plugin with private state and controlled external inputs.
The CLI activates the signed surface and restores its built-in implementation in the same Shell document.
Executed entry markers and default mount guards identify independent execution.
The actual container preserves the countdown, opening state, caption, `aria-live`, and canvas PNG digest.
The Instrument comparison precedes opening by one hour; the Border Beam comparison uses the opening instant.
Comparisons use a `1920x1280` viewport, unit scale, and software rasterization.
Draw observation starts before the initial Shell mount.
Each comparison waits for countdown updates, fonts, layout, and a draw after a theme change through the actual shared timer.
The fixture preserves the existing absence of redraw on resize alone.
An initial comparison used canvases drawn at different layout sizes; aligning theme redraw inputs removed that fixture discrepancy.
Canvas PNG digests match exactly without tolerance changes.
Saved selections, shared Tick counts, Main port identities, document identity, and the mounted foreground App remain unchanged.
Shutdown releases subscriptions, handlers, signed protocol routes, and private listeners.

Density, GPU presentation, physical input, and supported-host results remain separate acceptance gates.
[Plugin coverage](PLUGIN_COVERAGE.md) owns current results and unresolved failures.
