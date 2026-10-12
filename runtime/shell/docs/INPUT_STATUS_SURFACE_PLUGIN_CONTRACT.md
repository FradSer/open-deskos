# Connection and gamepad State Bar contracts

This contract covers `odk.status.connection` and `odk.status.gamepad` in the left State Bar slot.
Both surfaces display indicators without navigation controls.
They share Shell artwork and styles with their independent examples.

## Connection

The surface subscribes through `ctx.connection.subscribe(callback)` and uses `ctx.connection.labelFor(reachable)`.
Subscription immediately supplies the current browser reachability value.
Reachable status shows the Wi-Fi glyph and hides the offline glyph.
Unreachable status reverses their visibility.
The `data-online` value, title, and accessible name retain the supplied reachability meaning.
The surface owns the subscription cleanup returned by the public service.
Browser reachability does not establish access to a specific remote provider.

## Gamepad

The surface subscribes through `ctx.services.get('odk.service.gamepad').subscribe(callback)`.
The document-owned service retains state from the existing Shell `odk-gamepad-state` window event.
It supplies `connected`, `readable`, and `id` from the shared browser gamepad input.
The first two fields are booleans; `id` is a string or `null`.
Each state object is frozen and excludes other event fields.
`snapshot()` returns the current read-only state.
Subscription immediately supplies that state and returns cleanup.
Only `connected: true` displays the indicator.
Only `readable: true` uses readable emphasis and the readable connected label.
Other connected gamepads use the existing cannot-read label.
Absent state hides the indicator and retains previous attributes.
The indicator never dispatches input or microphone actions.
The surface owns its subscription cleanup.
Existing contexts without the service retain the previous window event interface.

Mount begins hidden, then the immediate subscription supplies current presence before mounting completes.
Replacement, built-in recovery, and enable preserve an unchanged connected gamepad without requiring another connection event.
The previous missing-replay defect has its own regression scenario, separate from projection compatibility.

## Replacement ownership

Each mounted connection surface owns one subscription.
Each mounted gamepad surface owns one state subscription, or one listener in a context without the service.
Release must complete before a replacement acquires its input resource.
Captured released callbacks must not change old or replacement nodes.
Default and independent implementations fence callbacks after release or factory cancellation.

## Evidence and limits

The independent [connection entry](../tests/fixtures/connection-status-surface-replacement/entry.js) and [gamepad entry](../tests/fixtures/gamepad-status-surface-replacement/entry.js) own their projections and cleanup.
They do not delegate to the default factories.
Static markup, artwork, styles, connection wording, and the public state service remain shared dependencies.

The [Node checks](../tests/input-status-surface-lifecycle.test.js) use the actual registry and Host with controlled callbacks.
The [browser checks](../tests/input-status-surface-electron.test.js) load development links and signed revisions through actual preload and the public Renderer controller.
Resource observations start before the first actual status acquisition.
Controlled browser online events pass through the actual connection service.
Controlled gamepad lists pass through the actual Shell gamepad poller.
These controls do not establish physical input or real network transitions.
Each loading mode compares three themes across default, independent, and restored phases.
Actual Shell viewports are 320×480, 960×640, and 1920×1280.
Their comparison containers use widths of 168, 292, and 400 pixels, respectively.
Separate checks establish connected gamepad state before replacement and recovery, then verify immediate readings without another input event.
Enable also verifies immediate retained state while the gamepad remains connected.
Geometry uses the State Bar boundary because its intermediate containers use `display: contents`.
Controlled entries without subscriptions must fail the resource guard.
Entries that skip the first gamepad state must fail the continuity guard.
Shutdown checks subscription, listener, discovery, and signed asset release while the window remains alive.
The parent separately waits for actual child closure.
Production Main authorization, density, raster pixels, physical devices, and supported-host acceptance remain unverified.
These limits do not establish a missing plugin boundary or a requirement for another activation mechanism.
The browser fixture uses the production discovery plugin, preload, Renderer registry, and status consumers.
It does not run the complete production Main composition.
Reuse shared authorization and Main composition checks when their assertions cover the same selection path.
Add a status-specific Main check when an uncovered wiring requirement or regression needs it.
Physical input and supported-host results require their actual targets.
Current measured results belong to [Plugin coverage](PLUGIN_COVERAGE.md).
