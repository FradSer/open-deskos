# Clock surface plugin contract

Read this when replacing `odk.tile.clock`.
The [built-in guide](AI_PLUGIN_GUIDE.md) owns registration and shared context.
The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md) owns selection and recovery.

## Behavior and ownership

Clock is a display-only tile with no required capability grants.
It receives local `Date` values from `ctx.onTick`.
The shared Tick calls the subscriber immediately and then once each second.
Clock displays zero-padded local hours and minutes as `HH:mm`.
The `time` element supplies the same value through `dateTime`.
An unchanged displayed minute does not rewrite that element.
Midnight and backward clock changes follow the next supplied local time.
Clock does not obtain time from an external provider or create a separate timer.
The registry owns the subscription cleanup returned by `ctx.onTick`.
Failed release retains ownership until cleanup succeeds.

## Independent implementation and evidence

The [independent example](../tests/fixtures/clock-surface-replacement/entry.js) owns formatting and Tick use without calling the default factory.
It shares static markup, Shell styles, fonts, and the public Tick service.
The [shared lifecycle checks](../tests/clock-surface-lifecycle.test.js) compare local time changes, stable writes, disable, enable, and failed release retry.
The [browser checks](../tests/clock-surface-electron.test.js) use actual preload, trusted development or signed loading, and the public Renderer controller.
They retain the document and desktop container across replacement and built-in recovery.
Comparisons cover three themes and three square cell sizes with fonts loaded and scale fixed.
Date is controlled before document loading; subsequent shared Ticks update both active containers after controlled forward and backward changes.
These comparisons do not exercise real clock progression or timezone changes.
The browser fixture checks subscription release, discovery release, asset closure, and actual child completion.
These browser checks do not establish density, screenshot equivalence, physical input, or supported-device acceptance.

The [production Main checks](../tests/clock-main-bootstrap.test.js) start with a built-in or signed Clock and enable all Main plugins.
They retain actual source algorithms with private state and controlled unavailable external inputs.
The fixture primes one blank document before installing controlled time and subscription observations.
The Shell document then loads once and remains unchanged through authenticated activation and built-in recovery.
Signed revisions retain local time, shared Tick ownership, desktop placement, foreground navigation, and peer ports.
Built-in recovery also works with malformed configuration and revoked publisher trust without changing those files.
Static comparisons cover three themes with loaded fonts and fixed scale.
Scoped motion controls are checked and removed after each comparison.
Shared timer callbacks update time after controlled forward and backward changes.
A candidate without Tick ownership fails the same activation path's subscription assertion.
Shutdown checks subscriptions, handlers, protocol release, listener removal, and actual child closure.
These checks do not establish real clock progression, timezone changes, density, screenshot equivalence, physical input, or supported-device acceptance.
The [feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining replacement gaps.
The [coverage report](PLUGIN_COVERAGE.md) owns command results.
