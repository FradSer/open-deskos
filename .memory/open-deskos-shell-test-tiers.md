---
name: "open-deskos-shell-test-tiers.md"
description: "`runtime/shell` keeps the complete suite at `node --test --test-concurrency=2 tests/*.test.js` (also run by `preflight`) and adds `test:fast` (`node scripts/test-tiers.cjs fast`, 8 workers) plus `test:acceptance` (2 workers to protect the CM5 Mali GPU); the tier script sorts `tests/*.test.js` by Electron launch markers, with 231 fast and 49 acceptance files observed."
type: project
---
`runtime/shell/package.json` keeps the complete suite at `"test": "node --test --test-concurrency=2 tests/*.test.js"` (still invoked by `"preflight": "pnpm test && pnpm styles && pnpm verify-release"`) and adds `"test:fast": "node scripts/test-tiers.cjs fast"` and `"test:acceptance": "node scripts/test-tiers.cjs acceptance"`.

From `runtime/shell/scripts/test-tiers.cjs` (complete observed declaration):

```js
// A test file belongs to the acceptance tier when it can start a graphical
// Electron process. The scan covers test files only. Helpers that set
// ELECTRON_RUN_AS_NODE=1 run the Electron binary as a Node CLI, so their
// consumers stay in the fast tier.
const launchMarkers = [
  /require\(['"]electron['"]\)/,
  /isolatedElectronArgs\(/,
  /runFixture\(/,
  /electron-fixture-runner/,
  /ELECTRON_RUN_AS_NODE/,
]

// The reference host keeps two workers to avoid Mali GPU process crashes.
const concurrency = { fast: 8, acceptance: 2 }

function plan(tier, dir = testsDir) {
  if (!Object.hasOwn(concurrency, tier)) throw new Error(`Unknown test tier: ${tier}`)
  const fast = []
  const acceptance = []
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.test.js')).sort()) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    const bucket = launchMarkers.some(marker => marker.test(source)) ? acceptance : fast
    bucket.push(path.join(dir, file))
  }
  return { tier, concurrency: concurrency[tier], files: tier === 'fast' ? fast : acceptance }
}
```

A `tests/*.test.js` file whose own source matches any launch marker (`require('electron')`, `isolatedElectronArgs(`, `runFixture(`, `electron-fixture-runner`, `ELECTRON_RUN_AS_NODE`) belongs to `acceptance`; the scan covers test files only, so helpers that set `ELECTRON_RUN_AS_NODE=1` to run Electron as a Node CLI do not move their consumers out of `fast`.

`main()` calls `plan(process.argv[2])`, prints the plan as JSON when `--list` is present, and otherwise spawns `process.execPath` with `--test --test-concurrency=<tier concurrency>` plus the selected files with `stdio: 'inherit'`; an unknown tier sets exit code 2 before spawning, and the child's exit code or signal becomes the runner's exit code.

Observed plan sizes: `pnpm test:fast --list` printed `fast: 231 files c=8` and `pnpm test:acceptance --list` printed `acceptance: 49 files c=2`.

Observed fast-tier run: `[test-tiers] fast: 231 files, concurrency 8`, wall `real 65.98`, `ℹ tests 2626`, `ℹ pass 2622`, `ℹ fail 1`, `ℹ skipped 3` (`duration_ms 63595.58025`); the single failing title was `✖ git-agent uses concise scopes aligned with the current topology`.

That `git-agent` title also failed outside the tier runner: an isolated `node --test --test-reporter=tap tests/repository-layout.test.js` run reported `not ok 3 - git-agent uses concise scopes aligned with the current topology`, `# tests 5`, `# pass 4`, `# fail 1`; its cause is unresolved in this evidence.

Same fast-tier file set at both worker counts: `fast tier c=2  wall= 128.34s tests=2626 pass=2622 fail=1` and `fast tier c=8  wall=  50.53s tests=2626 pass=2622 fail=1` — identical outcome counts, different wall times.

The shared host reported load averages in the hundreds around these runs (`load averages: 220.83 363.72 298.60` printed just after the comparison), so these wall times are loaded-host observations, not idle baselines.

Why: `test`, `test:fast` and `test:acceptance` are the Shell's current test entry points, and the launch-marker scan decides which tier a new graphical-Electron test file enters. How to apply: a new test file that starts a graphical Electron process is classified into `acceptance` without editing the runner, while the `git-agent` scope failure and the loaded-host wall times are observations outside the tier runner rather than tier benchmarks.