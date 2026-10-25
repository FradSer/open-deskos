# Release control planning

This phase provides one read-only publication planner. It does not deploy or delete files.
Legacy execution remains separate until a later authorized migration. Dry-run planning does not reserve production capacity.

## Read-only entry point

Run the planner from `runtime/shell`:

```sh
node scripts/cm5-release.js --dry-run \
  --snapshot /absolute/path/inventory.json \
  --request /absolute/path/request.json
```

Without `--snapshot`, the planner observes `--root`, then `ODK_RUNTIME_ROOT`, then `/opt/odk`.
Supply `--unit-snapshot` with `{ "complete": true, "references": [] }` only after independently checking all service references.
Missing service coverage blocks admission and reclamation. An empty list is not evidence of coverage.

Use `--backup-snapshot` for an independent observation of external backup references.
It contains `schemaVersion: 1`, `complete`, `observedAt`, `roots`, and `references` with `kind: "backup"`.
The standard CM5 root requires coverage for `/var/backups`, `/var/lib/odk-firmware-backups`, and `/mnt/ssd/odk-system-disk-archive`.
Missing, incomplete, or stale external observations block planning.
These observations are caller attestations. A supplied snapshot does not certify target-host inspection.

The three legacy entry points accept the same `--dry-run` arguments before any external operation.
They are `cm5-stage-release.sh`, `cm5-install.sh`, and `update-runtime.js`.
These options observe the calling host. They do not connect to `ODK_CM5_TARGET` or perform SSH.
Unknown arguments fail without entering legacy execution. The new entry point has no apply operation.

Exit code zero means a plan was produced. Inspect `admission.decision` and `gc.decision` for their result.
Every report sets `executionAvailable: false` and `reservationCreated: false`.

## Module contract

`scripts/lib/release-inventory.js` collects facts without creating files or acquiring locks.
`scripts/lib/release-plan.js` validates those facts and computes decisions without filesystem access.
`scripts/lib/release-ledger.js` tests durable admission in explicit disposable fixture directories.
`scripts/cm5-release.js` exposes only read-only planning.

Snapshots use schema version 1 and these fields:

- `root`, `observedAt`, `complete`, and `uncertainties` identify the observation and its limits.
- `filesystems` contains `id`, `availableBytes`, `availableInodes`, and `complete` for each storage pool.
- `releases` contains `id`, `path`, `identity`, `allocatedBytes`, `reclaimableBytes`, `metadataValid`, and `complete`.
- `identity` contains numeric `dev` and `ino` fields.
- `pointers` contains absolute `current` and `previous` paths, or null.
- `references` contains `path` and `kind` for process and service references.
- `protections` contains `path` and `reason` for explicit or legacy recovery protections.
- `locks` contains `path`, `identity`, and `recoveryPinned` for observed deployment gates.
  Reconciled observations also contain `status` and `reconciled`.
- `closeouts` contains verified transaction summaries, a coverage result, and unresolved summaries.
- `backupRoots` identifies scopes that reclamation never visits.
- `ledger` contains `schemaVersion`, `revision`, and `reservations`.

Each reservation contains `id`, `requestId`, `candidatePath`, `owner`, `state`, and `claims`.
Each claim contains `filesystemId`, `bytes`, and `inodes`. Amounts represent capacity still needed, not allocated bytes.
Active states are `preparing`, `ready`, `recovering`, and `interrupted`. Settled entries retain their history with `state: "settled"`.

Owner identity contains `bootId`, `pid`, and `startTime`. Missing identity never proves that an owner exited.

Requests contain `requestId`, `candidatePath`, `owner`, and `claims`.
Policy contains `reserveBytes`, `reserveInodes`, and `maxSnapshotAgeMs`.
The initial byte reserve is 6 GiB. Missing peak or inode estimates deny admission.
Each pool also retains 4096 inodes. Snapshot age defaults to 60 seconds.

`--reserve-bytes`, `--reserve-inodes`, and `--max-age-ms` permit explicit planning scenarios.
These planning parameters do not change a deployed policy.

Example request fields:

```json
{
  "requestId": "publication-unique-id",
  "candidatePath": "/opt/odk/releases/new-candidate",
  "owner": { "bootId": "observed-boot-id", "pid": 123, "startTime": "456" },
  "claims": [{ "filesystemId": "dev:45826", "bytes": 2147483648, "inodes": 50000 }]
}
```

Use observed filesystem IDs. Use a measured peak estimate for capacity still required by preparation and verification.

## Safety boundary

The planner never counts proposed reclamation as available capacity.
Current, previous, process references, service references, candidate leases, recovery records, and explicit pins are protection roots.
All backups remain outside reclamation. Unknown observations block reclamation candidates.

The collector checks references in all declared backup scopes, including discovered backup directories directly below `state`.
It also checks the complete symlink resolution chain before and after observation.
The interface does not establish coverage for arbitrary unknown backup locations or remote archives.

Process observations include thread roots, work directories, executable files, descriptors, and memory mappings.
Device and inode comparisons preserve references that use a namespace alias.
Unresolved process or mount observations remain incomplete.
This bounded observation does not prove the absence of every kernel-held resource or future action.

An expired owner or deadline does not release a reservation automatically.
Legacy recovery records can preserve an apparently stale lock. Their absence cannot be inferred from a dead PID.

The collector does not read process arguments or environment values.
It reads bounded gate bytes only to verify their hash.
It reads approved closeout receipts, but no arbitrary backup body.
Unresolved legacy transactions or deployment gates block planning.

Reclamation metadata requires a matching release ID, schema version 1, timestamp, and full source revision.
An older release without that evidence remains protected by an incomplete observation.
Typed `state/release-control/pins.json` uses `{ "schemaVersion": 1, "pins": [{ "path": "/absolute/path", "reason": "manual" }] }`.

The fixture ledger accepts only private disposable directories below the host temporary directory.
Each directory name starts with `odk-release-control-` and requires its fixture marker.
Fixture owner boot and start tokens are synthetic. They are not production Linux identity evidence.
The public CLI cannot create, settle, or recover these reservations.

Fixture transitions use exclusive locks, revision checks, file fsync, rename, and directory fsync.
Recovery retains interrupted claims and refuses live, replaced, or pinned gates.

## Transaction closeout

The collector reads `state/release-control/reconciliation.json`. It never creates this file or a terminal receipt.
The index uses `schemaVersion: 1` and `kind: "release-reconciliation-index"`.
Its `processView` binds the approved boot, PID namespace, and mount namespace.
The observer checks that view against its current kernel view and PID 1.
A container root identity alone does not establish complete host visibility.

Its `transactions` array covers every direct transaction directory under `deployment-inputs` and `deployment-backups`.
Each transaction binds its identifier, candidate identity, source revision, owner identity, input directories, and backup directories.
Its `inputs` and `backups` arrays contain exact path, device, and inode bindings.
One transaction can retain multiple backups. A historical recovery transaction can have no input directory.

Each terminal receipt is named `closeout-receipt.json` inside a bound backup directory.
The index binds its hash. The receipt repeats the transaction fields and declares `final: true` and `pendingRecovery: false`.
Both records require `noPendingWork: true` and a matching `closedAt` value.

The permitted dispositions are `committed`, `rolled-back`, and `abandoned`.
These dispositions belong to closeout records. They do not add ledger states.

The index, receipts, and their complete directory ancestry must be root-owned and not writable by other users.
Symlinks, multiple hard links, unknown fields, duplicate coverage, and changed identities prevent reconciliation.
Hashes identify evidence bytes. They do not protect against a malicious writer with the same administrator authority.
The approved writer must establish the terminal outcome independently before it creates these records.
A failed preflight receipt, an exited worker, or a later successful release is insufficient.

The `gates` array binds each retained gate to its closed transaction, owner, identity, and content hash.
The transaction also names that gate in `gatePaths`.
An idle gate remains on disk. It is exempt only after complete closeout coverage and Linux kernel lock verification.

Unreadable kernel state, an active owner, an active lock, or a changed observation blocks planning.
The collector checks the index, receipts, transaction trees, owner identities, and kernel lock table again before it returns.
Current, previous, references, leases, other recovery records, manual pins, and all backups retain their independent protection.
No production settlement writer, cleanup command, or deployment command is provided by this phase.

## Verification and handoff

Base: `origin/main` at `3cc319b85d6efe469b7faaed4b4f88d48a8f447c`.
Worktree: `/Users/FradSer/.codex/worktrees/appearance-release-closeout/open-deskos`.
Branch: `codex/appearance-release-closeout`.
The prior dry-run worktree remains unchanged.

Focused checks cover independent process competition and interruption before and after ledger rename.
Entry-point tests block external deployment commands and compare fixture content, modes, links, and modification times.
Independent review repaired lock identity, recovery pin, caller identity, and untrusted observation disclosure defects.
The new regression scenarios cover retained idle gates, exact transaction coverage, invalid receipts, and changing observations.

Local Linux container checks exercise a real kernel lock on a disposable test gate.
The container mounts repository sources read-only and has no network access.
Appearance acceptance holds the Liquid Glass stylesheet response while comparing the Shell and retained App colors.
The original exact color assertion remains active. Synthetic screenshots establish local rendering only.

CM5 and Windows device acceptance remain unverified. Production admission enforcement remains outside this phase.

The Appearance focused run passed 78 checks. The final production-startup rerun passed all three isolated fixtures.
Shared-control style, hidden-renderer, and four-theme density checks passed at five sizes.
Final release checks passed 192 tests in the local Linux container.
The macOS run passed 191 tests and skipped one Linux-only kernel test.

The style build and isolated smoke check passed. Independent reviews found no remaining P1 or P2 findings within this scope.

One App verifier timeout and one unexpected updater command status did not reproduce in the final targeted runs.
Their failure logs remain in the task evidence. No deadline or assertion was weakened.
Evidence: `/Users/FradSer/.codex/visualizations/2026/10/25/appearance-release-closeout/`.
Linux evidence: `/Users/FradSer/.codex/visualizations/2026/10/25/cm5-recovery-followup-20261025/final-linux-release-control-r1.json`.

An early regression run reached the legacy staging path before routing was implemented.
The test was stopped. A read-only check found unchanged current/previous links and no new release or remaining recent staging directory.
Transient staging writes cannot be excluded. Subsequent regression tests block SSH, installation, and service commands.
