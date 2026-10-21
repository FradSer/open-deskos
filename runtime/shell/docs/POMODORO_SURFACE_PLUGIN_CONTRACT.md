# Pomodoro surface contract

Read this when replacing `odk.tile.pomodoro`.
The [built-in guide](AI_PLUGIN_GUIDE.md) owns registration and supplied context.
The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md) owns selection and recovery.

## Preserved behavior

| Identity | App | State | Displayed content | Minimum Readable Cell |
| --- | --- | --- | --- | --- |
| `odk.tile.pomodoro` | `Pomodoro` | App session state; `App timer` without a session | live countdown, state word, `Focus`; `--:--` without a session | `186` |

The surface is display-only. It shows the App timer and state but owns no session or timer controls.
The Widget does not acquire provider, connection, or input authority.
The dial shows the App timer. The App state word appears above the dial.
An idle session has no state word instead of a `Ready` label.
The Widget has no header that repeats the App name. The App entry keeps its accessible name.

## Replacement and recovery

A replacement constructs its own surface without calling the built-in factory.
It retains the identity, kind, interaction, and Minimum Readable Cell contract.
Replacement and recovery preserve the desktop and comparison containers.
Disable and enable use the public runtime controller.
Other page containers retain their owners.
Shutdown releases active surfaces before discovery and signed assets close.

The [scenario](../tests/features/desk-tool-surface-replacement.feature) defines the preserved state and lifecycle.
The [browser checks](../tests/desk-tool-surface-electron.test.js) use actual preload, trusted development links, signed bundles, and the public Renderer controller.
The [feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining gaps.
The [coverage record](PLUGIN_COVERAGE.md) owns measured results and limits.
