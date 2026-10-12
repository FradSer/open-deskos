# Pi State Bar surface contract

This contract covers `odk.status.pi-sessions` in the left State Bar slot.
The Pi tile, App, page, session source, and event source have separate replacement requirements.

## Inputs and visible behavior

The surface reads `odkPlatform.getPiSessions()` through the existing preload interface.
It requests one initial scan and another scan on every third shared Tick callback.
The shared Tick supplies an immediate callback when subscribed.
The State Bar count does not follow the Pi Sessions page filter.

Successful scans display `summary.running`, with zero as the missing-value default.
Positive counts activate the dot and the `has-running` class.
The source label supplies the title and accessible name.
An absent source label uses `Pi sessions`.
Unavailable responses display `--` and preserve unavailable wording.
Rejected requests retain the previous source label.
Missing summaries preserve the existing zero count and unavailable briefing combination.
The button navigates through the existing `navigateToPage('pi-sessions')` context callback.

## Legacy briefing

The surface contributes `odk.briefing.pi-sessions` with order 20 through the public briefing store.
Working sessions, workspaces, settled sessions, empty results, and unavailable results retain their existing wording and artwork.
This store is separate from Personal Agent Today content.
Release preserves the last published statement.
A released consumer cannot publish another statement.

## Resource ownership

The registry owns the scoped Tick subscription and its release.
The surface owns its button listener and pending scan effects.
Disable, replacement, and shutdown prevent released callbacks from changing nodes, publishing statements, or navigating.
Late success and rejection cannot overwrite the replacement's reading or statement.
The selected replacement retains the mounted container and one Tick subscription.
This contract does not change response ordering among requests within one active mount.

## Independent implementation and evidence

The [independent entry](../tests/fixtures/pi-status-surface-replacement/entry.js) owns reading projection, briefing construction, scan cadence, and listener cleanup.
It shares static markup, artwork, Shell styles, and the public preload and context contracts.
It does not call the default factory or its projection helpers.

The [scenarios](../tests/features/pi-status-surface-replacement.feature) define preserved behavior and released-consumer isolation.
The [Node checks](../tests/pi-status-surface-lifecycle.test.js) exercise the actual registry and Host with controlled request completion.
The [browser checks](../tests/pi-status-surface-electron.test.js) exercise development links and signed installation through actual preload and the public Renderer controller.
They retain the document and mounted consumers across replacement and built-in recovery.
Three themes and three comparison sizes cover text, accessible names, computed styles, and rendered geometry.
Eight response cases preserve actual and comparison readings and legacy briefing parts.
Controlled Tick callbacks request scans; publication observations confirm that both consumers received new results.
These controls do not prove natural elapsed-time progression.
Browser Home input first selects another page in each implementation phase.
Browser Enter input then activates the actual status button and navigates to Pi Sessions.
Disable and enable release and reacquire both Tick subscriptions.
Controlled entries without Tick subscriptions or navigation are rejected through both loading modes.
Shutdown releases subscriptions, discovery, and signed asset authority before actual child closure.
The fixture uses private Main IPC providers; it does not prove production Main authorization or joint source replacement.
Density, raster pixels, live sources, physical input, and supported-host acceptance remain unverified.
Current measured results belong to [Plugin coverage](PLUGIN_COVERAGE.md).
