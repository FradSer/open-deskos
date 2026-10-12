# Calendar and State Bar time surface contracts

Read this when replacing `odk.tile.almanac`, `odk.tile.year`, or `odk.status.clock`.
The [built-in guide](AI_PLUGIN_GUIDE.md) owns registration and shared Tick context.
The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md) owns selection and built-in recovery.
The separate [Clock tile contract](CLOCK_SURFACE_PLUGIN_CONTRACT.md) owns `odk.tile.clock`.

## Common ownership

Each surface uses `ctx.onTick` without a separate timer or external provider.
Each accepts valid local `Date` readings from the shared Tick service.
The registry owns each returned subscription cleanup.
Failed cleanup retains ownership and blocks another mount until release succeeds.
Recovery preserves the current reading and actual mounted container.
Tile replacements retain display-only interaction; State Bar Clock retains the right slot.
None of these surfaces requires capability grants.

## Almanac

Almanac displays the English short weekday, unpadded day number, and English short month.
The local year, month, and day define its update identity.
Another Tick on that local date does not rewrite its text.
Day numbers of ten or more use `al-day-wide`.
Day one uses `al-day-narrow`.
All other dates remove those classes as applicable.
Leap day, month boundaries, year boundaries, and backward date changes follow the supplied local Date.

## Year

Year measures elapsed milliseconds between local January first and the next local January first.
The denominator retains leap years and local timezone offset changes.
It does not approximate progress with a fixed number of days.
The text rounds the percentage to the nearest integer.
The meter receives a percentage string with two fractional digits.
Browser CSS serialization can remove trailing zeros without changing that width.
The `year-pct-wide` class applies when the rounded percentage is 100.
Unchanged meter values and unchanged percentage readings do not rewrite their respective values.

## State Bar Clock

State Bar Clock displays zero-padded local hours and minutes as `HH:mm`.
Each supplied Tick writes the reading, including repeated readings in the same minute.
This differs from the Clock tile's unchanged-minute write suppression.
The replacement preserves the existing State Bar slot and surrounding Shell layout.

## Independent examples and evidence

Independent examples own [Almanac formatting](../tests/fixtures/almanac-surface-replacement/entry.js), [Year projection](../tests/fixtures/year-surface-replacement/entry.js), and [State Bar time](../tests/fixtures/status-clock-surface-replacement/entry.js).
They share static markup, Shell styles, fonts, and the public Tick service without calling default factories.
[Shared lifecycle checks](../tests/calendar-surface-lifecycle.test.js) compare date transitions, write counts, failed cleanup, enable, disable, and recovery.
Year projection also has Node checks in New York and Shanghai timezones across both daylight-saving transitions.
[Browser checks](../tests/calendar-surface-electron.test.js) use actual preload, development or signed loading, and the public Renderer controller.
Three themes and three square cell sizes retain document identity, active actual containers, text, classes, styles, and geometry.
Controlled date changes exercise the actual shared Tick across default, independent, and restored implementations.
Date controls, private IPC fixtures, and static comparison styles remain test-only.
These browser checks do not establish production Main activation; the production checks below cover that path separately.
Timezone checks cover Node projection; the browser matrix uses the host timezone.
The [feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining gaps, and [Plugin coverage](PLUGIN_COVERAGE.md) owns command results.

## Authenticated production Main activation

The existing [Clock production fixture](../tests/clock-main-bootstrap.test.js) also installs the three independent time surfaces with one scoped publisher policy.
Actual Main runs every plugin with private state and controlled external inputs.
The fixture starts with built-in time surfaces and activates signed entries through the actual CLI and Renderer control channel.
Default mount guards and executed entry markers identify the selected implementations.
The same actual containers retain readings across leap day, year end, the next year, and a backward date change.
Built-in recovery repeats those comparisons without changing saved selections.
Shared Tick counts, Main port identities, document identity, and the mounted foreground App remain unchanged.
Shutdown releases Tick subscriptions, IPC handlers, signed protocol routes, and private listeners.
These checks do not establish density, screenshot equivalence, live clock progression, physical input, or supported-device acceptance.
