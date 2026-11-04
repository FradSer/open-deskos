# Handoff: test tiers, matrix gate, nightly workflow, CM5 acceptance

## State

The Shell test suite runs 3032 checks with `pnpm test`. Two stable failures were
fixed. The nightly workflow is green on the default branch. The CM5 device keeps
its previously active release.

## Decisions

- Keep `pnpm test` unchanged. Add `pnpm test:fast`, `pnpm test:acceptance`, and
  `pnpm test:matrix` for narrower loops.
- Use one representative rendering combination by default. Restore the complete
  matrix only in the `test:matrix` gate.
- Use eight fast-tier workers on most hosts. Use four on the CM5 reference host.
  Read `ODK_TEST_FAST_CONCURRENCY` for an explicit override.
- Keep two acceptance-tier workers. This protects the CM5 Mali GPU.
- Run the nightly workflow on a GitHub runner. Keep CM5 device acceptance as a
  manual run. The workflow does not run on the device.
- Give software-rendered CI runners the CM5 rendering budget. Set
  `ODK_SURFACE_MATRIX_CI=1` in the workflow.
- Pin the CI virtual screen to 1920x1280x24. This matches the reference host.
- Configure the Electron SUID sandbox helper. Do not pass `--no-sandbox`.
- Align the topology contract with the current 15 scopes. Do not delete scopes
  used by other contributors.

## Fixes in this task

- `runtime/shell/tests/repository-layout.test.js`: assert topology invariants
  instead of a frozen eight-scope list.
- `runtime/shell/tests/device-gateway-electron.cjs` and
  `tests/device-gateway.test.js`: refresh the pinned renderer skeleton hash and
  add a fast drift guard.
- `runtime/shell/tests/surface-matrix.test.js`: skip the repository-only
  workflow file in a sealed release.
- `.github/workflows/nightly-matrix.yml`: build renderer assets, run the
  Electron installer, resolve the sandbox helper from the pnpm store, and pin
  the screen size.
- `runtime/shell/tests/helpers/hydra-surface-selection.js`: accept an explicit
  environment so CI can select the reference-host budget.

## Blockers

- CM5 activation is blocked. The device preflight rejected two candidate
  releases. The active pointer, the rollback pointer and the kiosk process still
  resolve to `20261103T191135Z-1116082`. This is the correct safety outcome.
- The device preflight failed 15 checks. Eleven Electron rendering checks also
  fail on the previously active release. Confirm this with a control run before
  treating them as regressions. The remaining failures are sealed-release layout
  and two repository contracts that another session still edits.
- Two unactivated candidate releases remain on the device:
  `/opt/odk/releases/20261104T042841Z-1126723` and
  `/opt/odk/releases/20261104T043447Z-1129464`. Each uses about 869 MB. Do not
  delete them without authorization. Staging directories are clean. No release
  pointer references them. Confirm no deployment is in flight before cleanup.
- Real-device acceptance reports one required failure: `touch-devices`. The CM5
  has no touch-named evdev device. This is a hardware state, not a Shell defect.
  Kiosk, smoke, display mode, GPU renderer, active release and rollback release
  all pass.
- Two HEAD contracts are masked by another session's uncommitted edits. Do not
  stage that work. `docs/CONFIGURATION.md` lacks `ODK_PERSONAL_AGENT_MODEL`, and
  `scripts/capture-agent-states.cjs` contains a retired technical prefix.

## Verification

- `pnpm test`: 3032 checks, 3028 pass, 3 skipped, 1 load-related timeout. The
  Hydra suite passes 5/5 on an isolated rerun.
- `pnpm test:matrix`: 12 checks pass.
- `node --test tests/config-inventory.test.js tests/surface-matrix.test.js
  tests/test-tiers.test.js tests/repository-layout.test.js
  tests/device-gateway.test.js tests/hydra-surface-restart-budget.test.js`:
  50 checks pass.
- Nightly workflow `41783574081`: success, 8m35s.
- CM5 `scripts/cm5-acceptance.sh` with kiosk DISPLAY=:0: 32 checks, 1 required
  failure. See Blockers.

## Paths

- `runtime/shell/scripts/test-tiers.cjs`
- `runtime/shell/scripts/test-matrix.cjs`
- `runtime/shell/tests/helpers/surface-matrix.js`
- `runtime/shell/tests/features/surface-matrix.feature`
- `runtime/shell/tests/features/test-tiers.feature`
- `.github/workflows/nightly-matrix.yml`
- `runtime/shell/docs/CONFIGURATION.md`
