# Static desk tool surface contracts

Read this when replacing `odk.tile.settings`, `odk.tile.chat`, or `odk.tile.pomodoro`.
The [built-in guide](AI_PLUGIN_GUIDE.md) owns registration and supplied context.
The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md) owns selection and built-in recovery.
Pre-order has separate countdown and canvas behavior outside this contract.

## Preserved behavior

| Identity | App | State | Displayed content | Minimum Readable Cell |
| --- | --- | --- | --- | --- |
| `odk.tile.settings` | `Settings` | `Pending integration` | `Settings`, `Pending`, `Integration not available` | No explicit declaration |
| `odk.tile.chat` | `Chatbot` | `Pending integration` | `Chatbot`, `Pending`, `Integration not available` | No explicit declaration |
| `odk.tile.pomodoro` | `Pomodoro` | `Not started` | `Not started`, `--:--`, `Focus` | `186` |

All three surfaces retain display-only interaction and existing desktop declarations.
Settings and Chatbot retain their status composition and upstream icon artwork.
Pomodoro retains its neutral ring without a running timer or controls.
These surfaces acquire no provider, Tick, connection, or input subscriptions.
Their existing state does not imply a working settings editor, chatbot service, or focus session.
No capability grants are required.

## Replacement and recovery

A replacement constructs its own surface without calling the built-in factory.
It retains the identity, kind, interaction, and Minimum Readable Cell contract.
Replacement and built-in restoration preserve the active desktop and comparison containers.
Disable removes the actual desktop placement through the public runtime controller.
Enable restores the selected implementation through that controller.
Other active tool containers and the independent peer retain their owners.
Shutdown releases active surfaces before discovery and signed assets close.

## Independent examples and evidence

Independent [Settings](../tests/fixtures/settings-surface-replacement/entry.js), [Chatbot](../tests/fixtures/chat-surface-replacement/entry.js), and [Pomodoro](../tests/fixtures/pomodoro-surface-replacement/entry.js) entries construct DOM nodes directly.
They share static artwork, Shell styles, fonts, and placement contracts.
Their independence covers surface construction and current display behavior.
It does not establish independent themes, service algorithms, or future interactive features.

[Behavior scenarios](../tests/features/desk-tool-surface-replacement.feature) define the preserved state and lifecycle.
[Browser checks](../tests/desk-tool-surface-electron.test.js) use actual preload, trusted development links, signed bundles, and the public Renderer controller.
The fixture captures defaults before making default delegation fail during independent loading.
Three themes and three Cell sizes compare actual desktop and comparison consumers across default, independent, and restored phases.
Checks compare text, DOM structure, SVG attributes, classes, fonts, colors, and geometry.
Mount guards reject supplied context access after registry adaptation for actual and comparison consumers.
The guards cover initial default mounts, independent replacement, enable, and built-in recovery.
Controlled entries attempt an optional connection subscription through both real loading modes; acceptance rejects them.
Each phase disables and enables all three identities while checking active peer ownership and selected revisions.
Private provider fixtures, hidden windows, and comparison motion controls remain test-only.

These browser checks do not certify production Main activation; the production checks below cover that path separately.
They do not inject resource-release failures into surfaces that acquire no resources.
The [feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining gaps.
[Plugin coverage](PLUGIN_COVERAGE.md) owns measured results and limitations.

## Authenticated production Main activation

The existing [Clock production fixture](../tests/clock-main-bootstrap.test.js) also installs the three independent tools beside the calendar surfaces.
Actual Main runs every plugin with private state and controlled external inputs.
The CLI activates signed tool entries and restores built-in implementations in the same Shell document.
Executed entry markers and default mount guards identify independent execution.
Comparisons retain actual containers, state text, display-only behavior, DOM structure, and SVG attributes.
Fonts and two animation frames settle before each structure comparison.
Saved selections, shared Tick counts, Main port identities, and the mounted foreground App remain unchanged.
Normal shutdown releases subscriptions, handlers, signed protocol routes, and private listeners.
These checks do not certify density, raster pixels, physical input, or supported-device acceptance.
