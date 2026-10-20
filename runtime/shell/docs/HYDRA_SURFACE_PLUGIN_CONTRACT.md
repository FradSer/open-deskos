# Hydra surface replacement contract

This contract defines trusted replacements for `odk.tile.hydra` on `electron-renderer`.
[The source contract](HYDRA_PLUGIN_CONTRACT.md) owns broker requests, telemetry normalization, freshness, and source resource ownership.
[The built-in guide](AI_PLUGIN_GUIDE.md) owns surface discovery, registration, and cleanup.

## Ownership and declaration

The independent [entry](../tests/fixtures/hydra-surface-replacement/entry.js) owns formatting, cell composition, badges, plant meters, refresh cadence, and release guards.
It shares static HTML, Shell CSS, semantic tokens, fonts, and icon adaptation.
It does not import or call the default mount or source implementation.
The fixture retains tile identity, display-only interaction, and Minimum Readable Cell `120`.
Its external declaration provides `odk:surface/odk.tile.hydra/v1` without required ports or capability permissions.
The surface reads `window.odkPlatform.getHydraStatus()` through the existing platform interface.
It does not own the Main source or broker connection.

## Preserved behavior

Unconfigured readings use placeholders and the `Unconfigured` badge.
Configured snapshots show `Waiting`, `Offline`, `Stale env`, or `Live` according to connection, main-node, and environment state.
Temperature retains one decimal; humidity retains no decimal; pressure rounds to an integer.
Light readings retain the existing small-value precision and abbreviated thousands format.
Plant identity selects each row independently of input order.
Offline or missing soil readings use placeholders and an empty meter.
Stale rows retain historical soil readings without a watering indication.
Dry meters retain the existing threshold below fifty percent.

The measured Cell selects wide, tall, compact, plants-only, or too-small composition.
A Cell at least 480 pixels wide and 340 pixels high selects the wide composition.
It pairs four environment readings above two side-by-side plant readings.
The Desk declaration spans three columns and two rows when the grid permits it.
Plants-only composition uses short labels and states `Not shown · 4`.
Larger compositions restore full labels and clear omission hints.
Too-small composition states `Too small`.
Smaller compositions retain their existing thresholds and readable floors.

Mount requests an initial snapshot.
The first shared tick and every five ticks thereafter request another snapshot.
Active request rejection shows the waiting state and permits recovery.
Release blocks new requests and late reading or resize writes.
Failed observer disconnection remains owned and retryable.
New mounts have separate observers and release guards.

## Acceptance and limits

The [shared checks](../tests/hydra-surface-lifecycle.test.js) select both implementations through the actual Renderer registry and Host.
A throwing default mount prevents unintended default execution in independent cases.
The matrix compares nine states across six cell sizes.
Same-instance transitions compare live, stale, offline, unconfigured, and recovered readings with reverse shape changes.
Separate checks cover request rejection, tick cadence, late success, late rejection, queued resize, and observer cleanup retry.
A byte comparison verifies the static HTML layout.

The DOM model does not parse HTML or combine `className` with `classList`.
These results establish fixture behavior parity, not effective browser classes or rendered appearance.
The rendered checks below cover trusted development loading and actual preload consumers.
The revision checks below own separate-process surface transition evidence.
Independent density, real brokers, physical input, Windows, and CM5 remain unverified.
[Plugin coverage](PLUGIN_COVERAGE.md) owns current results and remaining completion gates.

## Trusted development rendering

The [Electron check](../tests/hydra-surface-electron.test.js) prepares the independent surface through the actual development CLI with explicit trust.
Parent-owned CLI execution receives cancellation and a bounded timeout.
The parent waits for child closure before deleting private profile, configuration, and state directories.
Actual Renderer discovery loads the linked entry before Shell composition.
Selected catalog versions and a throwing default mount identify independent execution.

The browser uses actual sandboxed preload with controlled Hydra IPC responses.
It compares eight states across three themes and twelve measured Cell sizes with default behavior.
Snapshots include the host tile, descendant attributes, all computed CSS properties, text, and relative bounds.
Checks reject escaping element boxes, controls, and text below the fourteen-pixel data or twelve-pixel caption floors.
These twelve Cell sizes do not establish the shared density profile across five standard desktop viewports.
The existing comparisons cover Cell composition; the remaining density question concerns selected desktop placement at those viewports.
Reuse the shared collector and current profile for that question; it does not require another plugin mechanism or state matrix.
Each temporary surface releases through the actual registry before removal.
Discovery shutdown removes its handler; an actual preload discovery request then rejects.

The measured fixture resolves Widget inset from its own Cell instead of inheriting the desktop Cell's resolved token.
Testing exposed existing narrow-state badge overflow in the default surface.
Shared styles now permit header wrapping, reduce narrow header gaps, and use twelve-pixel plants-only padding.
These changes retain complete badges, plant readings, and omission counts within measured cells.

The rendered matrix remounts for each state; shared model checks own same-instance transition evidence.
An initial unconfigured placeholder can match the unconfigured wait before its request completes.
These checks do not establish loading-state timing, screenshots, independent density, live broker behavior, assistive technology, or physical input.
Signed surface revision transitions, Windows, and CM5 remain unverified.

## Signed captured entry

The [Electron check](../tests/hydra-surface-electron.test.js) also installs the independent surface through the actual Native CLI.
The [signed helper](../tests/helpers/hydra-surface-selection.js) signs manifest and entry bytes with an Ed25519 publisher restricted to the surface identity and Renderer host.
The external publisher policy, explicit operator trust, and declared permissions remain separate checks.
This surface declares no permissions and receives no capability grants.
It retains packaged Shell CSS without declaring an external stylesheet.
Signatures establish provenance and integrity, not a sandbox.

The production loader reads the external public keyring and captures the verified entry before browser loading.
The fixture changes the stored entry after capture.
Captured responses retain the original signed content; a later store snapshot rejects the modified revision.
Actual discovery, browser execution, registry selection, and preload retain all 288 rendered comparisons against default behavior.

The discovery Host starts a separate asset lease after capture.
Shutdown removes the protocol and discovery IPC handlers.
An actual preload discovery request rejects after shutdown.
Closing the original snapshot makes its entry route return status `410`.
Parent-owned CLI commands receive cancellation, bounded execution, and child-close ownership before state deletion.

These checks cover signed entry installation and captured loading, not surface revision transitions or joint production Main startup.
Independent density, live brokers, full-process cancellation faults, assistive technology, physical input, Windows, and CM5 remain unverified.

## Signed revisions and separate processes

The [revision check](../tests/hydra-surface-restart.test.js) installs source and surface selections under one external publisher policy.
Actual Native commands update, roll back, and remove the surface selection.
Four separate Electron processes select surface versions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
A signed entry marker identifies the executed surface version independently of catalog selection.
Each reported PID must match the actual spawned child and differ from prior process identities.

Every process compares the complete 288-case rendered matrix with its local default baseline.
The child writes all consumer snapshots into its private profile before reporting success.
The parent compares complete file bytes across process launches.
Computed CSS property names are sorted without removing properties or changing values.
This removes browser enumeration-order differences while preserving complete attribute, style, text, and geometry comparisons.
Mismatch diagnostics report the first differing byte and nearby content without replacing the full comparison.

Invalid updates preserve configuration bytes.
The signed source selection, unrelated Clock preference, enabled surface preference, and stored source and surface snapshots remain unchanged.
Surface removal clears only its selection and restores the default surface.
Revision checks capture verified entries without mutating stored revisions.
The separate captured-entry check retains its deliberate mutation scenario.

The source selection is retained without executing its factory in this rendered fixture.
Actual Main source and surface joint startup, independent density, live brokers, full-process cancellation faults, physical input, Windows, and CM5 remain unverified.


## Joint actual Main source and surface startup

The [joint check](../tests/hydra-main-surface.test.js) starts the production Main module in four separate Electron processes.
One external publisher policy selects independent signed Main source and Renderer surface entries.
The source executes revision `2.0.0` without constructing the default Hydra source.
Actual Native commands select surface revisions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
An executed entry marker and child PID bind each report to its selected implementation and process.
The independent entry makes default surface delegation throw before Shell composition.

The installed MQTT SDK connects to a private loopback broker without credentials.
Canonical MQTT messages pass through the production source, actual preload, and mounted Hydra Widget.
Assertions retain temperature, humidity, pressure, light, units, Live state, soil percentage, pump state, and meter fill.
Complete descendant attributes and leaf text remain equal across launches.
This joint check covers one live layout; the separate rendered matrix owns broader state, theme, and geometry evidence.

Invalid unsigned updates preserve configuration bytes.
Surface transitions preserve the source selection and stored source and surface revisions.
Each launch opens one broker connection with the canonical topic subscription.
Shutdown releases source IPC, discovery IPC, the signed asset protocol, and all broker sockets.
Electron closure precedes private profile deletion.

The fixture fixes source time and disables unrelated sources and surfaces.
It preserves packaged Shell styles and uses the installed MQTT library.
External brokers, independent density, full-process cancellation faults, assistive technology, physical input, Windows, and CM5 remain unverified.
Renderer runtime stop is requested before quitting.
Automatic Renderer shutdown and observer leak measurement remain outside this joint check.
Runtime hot replacement remains unverified.


## Runtime browser replacement without navigation

Read [the runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md#browser-entry-loading-and-live-native-leases) for browser admission and explicit Main live-asset lease authority.
The [Electron check](../tests/hydra-surface-electron.test.js) adds development and signed runtime modes.
One document starts the default surface, loads the independent entry while running, and restores a captured default definition.
Authenticated discovery remains active during signed capture and publication.
Its protocol route binds before document loading through the explicit runtime capability.

The actual desktop element remains identical and active across both replacements.
Each phase retains the full 288-case attribute, computed-style, text, geometry, containment, and readable-floor matrix.
Independent and restored-default results match the initial default matrix without a page navigation.
A throwing default mount blocks delegation during independent execution.
A separate captured default mount counter proves the restored implementation executes.
Signed code executes captured bytes after stored-entry mutation; shutdown closes protocol, discovery IPC, and asset leases.

The source uses controlled actual preload IPC without executing the Hydra MQTT source factory.
Production Main runtime publication, authenticated operator activation, stylesheet changes, per-revision retirement, external brokers, and supported-device acceptance remain open.
