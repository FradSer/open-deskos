---
name: "open-deskos-shell-test-suite-runtime.md"
description: "runtime/shell runs `node --test --test-concurrency=2 tests/*.test.js`; concurrency was lowered from 4 to 2 to avoid CM5 Mali GPU process crashes, and a full run measured ~806 s (3008 tests) with cross-process Electron signed-revision acceptance tests slowest."
type: project
---
`runtime/shell/package.json` runs the Node test runner over the whole suite as `node --test --test-concurrency=2 tests/*.test.js`.

That concurrency was lowered from 4 to 2 in the same script (`-    "test": "node --test --test-concurrency=4 tests/*.test.js",` replaced by `+    "test": "node --test --test-concurrency=2 tests/*.test.js",`), and the same commit message records the reason: `Tune concurrency to 2 in package.json to avoid Mali GPU process crashes`.

One full baseline run of that script on a 10-CPU host with Node `v24.16.0` reported `# duration_ms 806041.312542` (about 806 s) with `# tests 3008`, `# pass 3003`, `# fail 2`, `# skipped 3`.

In that run the slowest test titles were located in `tests/hydra-surface-restart.test.js` (`--- signed Hydra surface revisions preserve rendered consumers`), `tests/weather-surface-restart.test.js` (`--- signed independent Weather surface update rollback`) and `tests/weread-surface-restart.test.js` (`--- signed independent WeRead surface update rollback`).

`tests/helpers/electron-fixture.js` defines `function runFixture(file, args = [], { timeout = 120000, spawn = spawnSync, platform = process.platform } = {}) {`, which creates a fresh temporary profile per call with `const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-e2e-child-'))`.

Why: the suite's roughly 806 s wall time is the subject of a test-speed review, so its entry command, observed cost and the recorded reason for the concurrency ceiling are the facts future test-speed work starts from. How to apply: treat `--test-concurrency=2` as a deliberate CM5 Mali GPU stability constraint (concurrency 4 was reverted), not an oversight, and account for it plus the cross-process Electron acceptance tests when changing test runtime.