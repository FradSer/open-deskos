# Built-in App Manager plugin contract

## Scope

Read this contract when replacing `odk.system.app-manager` or changing its public consumers.
[Product](../../../PRODUCT.md) owns product scope.
[App platform](../src/renderer/core/app-platform.js) owns Renderer orchestration and recovery.
[Native plugins](NATIVE_PLUGINS.md) owns trusted loading and authorization.

The Main plugin owns catalog state and foreground decisions.
The Renderer owns mounted App surfaces, frame visibility, local input, and Back.
Replacing this Main plugin does not establish independent replacement of those Renderer components.

## Identity and authority

The identity is `odk.system.app-manager`.
Its kind is `system`; its host is `electron-main`.
It provides `odk:system/app-manager/v1` without required providers.
It retains the `ipc` and `system.app-manager` permission declarations.
Native signatures establish integrity and publisher authorization; they do not sandbox trusted code.

## Public interfaces

| Interface | Result |
| --- | --- |
| `odk-app-manager-list` | Current installed catalog metadata and state |
| `odk-app-manager-state(appId)` | App metadata and state, or `null` for an unknown identity |
| `odk-app-manager-intent(intent)` | Dispatch result, ordered trace, and applicable transition data |
| Port `list()`, `get(appId)`, `foreground()` | Current snapshots without mutable capability-array aliases |
| Port `install(appId)`, `remove(appId)` | Installation state result without a dispatch trace |
| Port `start(appId)`, `pause(appId)`, `resume(appId)`, `stop(appId)` | Lifecycle result without a dispatch trace |
| Port `dispatch(intent)` | The same behavior exposed by the intent IPC interface |
| Port `captureState()`, `restoreState(snapshot)` | Detached, validated in-memory state for compatible runtime handoff |

The [default endpoint](../src/app-manager-endpoint.js) defines current response fields and error precedence.
Trace rows retain their existing fields and order.
An independent implementation can share static catalog metadata.
It must own state transitions and recovery without importing or packaging the default algorithm.

## Behavior compatibility

New instances start with installed Apps and no foreground App.
Lists exclude removed Apps; direct state reads can still identify them.
Unknown identities and removed Apps retain distinct errors.
Starting another UI App through the direct lifecycle method fails while the foreground is occupied.
Opening an accepted App through dispatch stops the previous foreground and returns recovery data.
A refused target preserves the previous foreground.
Pause requires running state; resume requires paused state.
Pause retains foreground ownership.
Stop clears foreground ownership only for its target.

Install resets state to installed without clearing the foreground identifier.
Starting a service does not claim UI foreground ownership.
Opening a service through dispatch still releases the previous foreground.
These compatibility cases require explicit checks instead of inferred UI-only behavior.

Rollback validates expected state before changing state.
Invalid recovery data preserves current state.
Successful recovery restores the recorded target, previous state, and foreground identifier.
Malformed intent, unsupported intent, unsupported action, stale transition, and unavailable App results retain their existing distinctions.

## Lifecycle and acceptance

Each factory owns its IPC handlers through Host cleanup.
Cleanup failure retains unfinished release work for retry.
Disable and enable reconstruct fresh in-memory state under the current startup contract.
Compatible runtime replacement preserves the complete catalog lifecycle state and foreground identifier.
The plugin instance declares `handoff` with schema `odk:system/app-manager-state/v1` and synchronous `capture` and `restore` functions.
Its snapshot contains `version: 1`, `states: [{ appId, state }]`, and `foregroundAppId`.
States include removed Apps; the snapshot retains legacy foreground combinations without normalization.
Restoration validates version, unique catalog identities, lifecycle states, and foreground identity before changing state.
Snapshots cannot alias live manager state.
The Host restores a detached snapshot before startup and retains the original snapshot for failed candidate recovery.
IPC callbacks refuse requests before startup, after cancellation, and after release.
The Native and development loading wrappers retain the same state handoff hooks.
Hookless legacy implementations retain their existing lifecycle behavior and do not establish state-preserving replacement compatibility.

The [endpoint checks](../tests/app-manager-endpoint.test.js) own existing product behavior examples.
The [replacement checks](../tests/app-manager-replacement.test.js) exercise signed capture, IPC, cleanup, and default recovery.
The signed and development fixtures own state transitions and share only static catalog metadata and public Host interfaces.
The [independent checks](../tests/app-manager-independent.test.js) compare deterministic sequences and explicit product rules.
The [App platform checks](../tests/app-platform.test.js) cover local mount failure, action rejection, and retained cleanup.
The [browser fixture](../tests/app-manager-electron.cjs) covers actual preload, Back, Escape, and mount recovery.
The [regular browser entry](../tests/app-manager-electron.test.js) runs both loading modes and controlled rollback omissions.
It checks browser pointer Back, keyboard Escape, focus recovery, and handler release before window closure.

The [production Main entry](../tests/app-manager-main-bootstrap.test.js) checks default, signed, development, and corrupt-selection startup.
It uses actual Main composition, preload, and the same public navigation scenarios.
Authenticated runtime activation and built-in recovery retain the actual mounted foreground through the production Main check.
Controlled restoration failure recovers the previous manager state and leaves Escape available.
The composition check enables all Main plugins and mounts configured desktop surfaces with controlled unavailable external providers.
It preserves peer ports and desktop nodes through manager replacement and failed candidate recovery.
The [isolation helper](../tests/helpers/app-manager-composition-isolation.js) retains source algorithms and controls network, device, account, and local Pi inputs.
Supported-host acceptance, live-provider composition, physical input, and assistive technology remain open.
[Plugin coverage](PLUGIN_COVERAGE.md) owns recorded results and limitations.
