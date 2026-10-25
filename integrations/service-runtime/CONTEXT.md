# External service runtime handoff

Updated: 2026-10-25.

## Work

The user requested a separate worktree, a generic external service layer, and Futu as the first service.
The user then authorized deployment and live lifecycle acceptance on CM5.
The [runtime contract](README.md) owns commands, package inputs, lifecycle, and trust limits.
The [Futu guide](../futu-poller/README.md#external-service-package) owns worker configuration and packaging.

Worktree: `/Users/FradSer/.codex/worktrees/external-service-runtime/open-deskos`.
Branch: `codex/external-service-runtime`.
Base: `75ee6abf574997f526ff1faf0cb8386e5e9ef962`.
The original checkout and its unrelated changes remain untouched.
Changes are local and uncommitted.
No pull request was created.

## Implementation

- `odk_service_runtime/` owns private revision storage, lifecycle transactions, backends, and the Python command entry.
- `runtime/shell/scripts/odk-plugin-cli.js` delegates `odk plugin service` commands.
- `runtime/shell/scripts/package-service-runtime.js` seals the manager sources for CM5 releases.
- Release packaging excludes Python environments, caches, and operator authentication files.
- `integrations/futu-poller/build_package.py` builds exact source inventories for both backends.
- Futu pins Python 3.12.11 and `futu-api==10.2.6208` with a complete uv lock.

The manager saves resource ownership before creation and commits version selection with activation state.
Damaged executable files cannot prevent cleanup of an independently verified runtime handle.
Unconfirmed Docker creation remains pending, even when its reserved container is absent.
The runtime contract explains this conservative operator-recovery limit.

## CM5 deployment

Host: `orangepicm5-tablet`, Linux ARM64, service user `orangepi` with UID 1000.
The independent launcher is `/home/orangepi/.local/bin/odk-service`.
It selects manager release `/home/orangepi/.local/share/odk-service-runtime/releases/20261024-v3`.
The nine deployed manager source files match this worktree by SHA-256.
The operator path contains the verified ARM64 `uv` 0.11.18 binary.

The coordinator reports current Shell `/opt/odk/releases/20261024-main-3cc319b8`, with the original `76d8578f` release retained as previous.
That coordinated deployment preserves the external services and their data interfaces.
Use the independent launcher; the selected Shell excludes this worktree's service command handler.

Service ID: `odk.futu.poller`.
The final backend is Python under `odk-service-08fefeed3c38-odk.futu.poller.service`.
The configured production polling interval is 60 seconds.
The legacy `open-deskos-futu-poller.service` was disabled before managed activation.
Its original unit and configuration remain available for operator recovery.
The migration backup is `/home/orangepi/.config/odk/services/futu/migration-backup-20261024`.

Private bindings are in `/home/orangepi/.config/odk/services/futu`.
State and retained environments are in `/home/orangepi/.local/state/odk-service-runtime`.
Packages are in `/home/orangepi/.local/share/odk-service-runtime/packages-final`.
Python uses explicit RSA, target, and control paths because its persistent HOME differs from the original service HOME.
Docker acceptance used temporary caller access to the existing daemon.
It did not change user groups or sudo rules.
The final Python service requires no Docker access.

| Backend | Version | Retained revision prefix | Role |
| --- | --- | --- | --- |
| Python | 1.0.0 | `f3466e88e14a` | Final selected revision |
| Python | 1.0.1 | `0f6db3d0a023` | Final rollback revision |
| Docker | 1.0.0 | `80c3c04096e9` | Verified lifecycle revision |
| Docker | 1.0.1 | `683bb9dcc6ad` | Verified update revision |

The acceptance 1.0.1 worker adds a source comment to create a distinct revision.
Its Docker build also has an acceptance label and a different immutable image identity.
Docker 1.0.0 image: `sha256:7a2b1c02ab722dab401029ebd442aebb9dd75895ee697b562d128d5dae0e5a46`.
Docker 1.0.1 image: `sha256:6f47ba2a7a8b123bc12c3f01405528ffc49d4bed1f4571e5a4c11f2059b00439`.

## Live evidence

Existing OpenD authentication and account reads succeeded with the exact locked SDK.
The independent gateway read returned 11 positions.
Their normalized identity fingerprint matched the actual deployed Personal Agent `odk_data` tool.
The chain used the worker, Shell service registry, data socket, and deployed agent tool implementation.
Each lifecycle activation required provider data newer than the completed activation.
Stopped workers produced unavailable data rather than a live cached reading.

Both backends passed disable, re-enable, update, and explicit rollback on CM5.
Python checks verified the actual systemd unit and child command against the selected retained revision.
Docker checks verified the actual immutable image, non-root user, read-only root, and restart policy.
Released containers were absent before later activation.
The dedicated Python graceful-stop check completed in 7.793 seconds with systemd result `success` and exit status 0.
The full lifecycle exercise restored Python, retained its rollback revision, and confirmed no managed Docker containers remained.

A candidate Python readiness probe deliberately failed after writing its private revision marker.
The update command failed and automatically restored the current worker in 19.221 seconds.
The selected and rollback revisions remained unchanged; the old process generation exited.
The restored generation then supplied provider data newer than the failed operation's completion.
The independent audit observed another production poll with the same provider identity and unchanged worker processes.
It confirmed one worker, disabled legacy supervision, private files, the original configuration hash, and the unchanged Shell release.
No lifecycle operation remains in progress.

Private evidence: `/home/orangepi/.local/share/odk-service-runtime/cm5-acceptance-20261024.json`.
The lifecycle operation is `validate_cm5.py` in that directory.
The rejection operation is `validate_failed_update.py` in the same directory.
The independent audit is `audit_cm5.py` in the same directory.
Local operation files are under `/private/tmp/odk-cm5-services-20261024-i3qwwq9j`.
Evidence contains lifecycle metadata and fingerprints, without positions, passwords, RSA material, or tokens.

## Repairs from device acceptance

Real systemd rejected quoted `WorkingDirectory`; the redundant directive was removed.
Ownership checks now accept the verified user-unit symlink while rejecting replacement links and unsafe parents.
Cleanup handles an owned invalid unit only when its inactive state and zero PID are confirmed.
Removal handles immediate unit unloading after disable without accepting an active or replaced unit.

One existing publication target consumed its ten-second connection timeout.
Actual control readiness needed 12.778 seconds.
The Futu package and Docker startup period now allow a bounded 60 seconds.
Readiness still proves the management channel only; the separate provider checks establish live data acceptance.

A signal handler that called `Event.set()` could deadlock when a signal interrupted an event critical section.
A failing subprocess regression reproduced that defect before repair.
The handler now sets a lock-free stop flag, and waits observe it within 50 milliseconds.
SDK import restores the previous SIGINT handler after success or failure.
SIGINT during the SDK import window can still invoke the SDK's temporary immediate-exit handler.
Managed CM5 stops use SIGTERM.
Synchronous SDK calls remain subject to the outer shutdown deadline.

## Verification and limits

- Generic runtime: 66 tests and 18 subtests passed with all local acceptance options enabled.
- Futu worker: 309 tests passed; two native Windows checks were skipped on macOS.
- Shell service CLI and packaging: nine tests passed; runtime release checks added 15 passes.
- Independent reviews covered lifecycle ownership, systemd cleanup, signal concurrency, and live acceptance scripts.
- Python compilation, uv lock validation, shell syntax, JavaScript syntax, whitespace, and document references passed.

The generic suite selected the final Python and Docker packages from the local operation directory.
Its offline Docker fixture used `sha256:2fd8ff6d8c7db1895590a0d3df81984f57642b1203033a97f119c1cb8e8532ca`.
The command was `uv run --with pytest pytest -q` from this directory.
Its isolated test directory was `/private/tmp/odk-service-final-live-20261024`.

The HTML application CLI test has an unrelated Electron verifier exit timeout.
It returned valid results before the existing eight-second deadline expired.
The same failure reproduced from an unchanged base archive at `/private/tmp/odk-service-baseline-idcxr081`.
That archive contains `baseline-result.txt`.
This service change does not modify HTML verification.

The existing remote Windows publication target was unreachable; its data delivery remains unverified.
The acceptance did not place orders, restart shared OpenD, reboot CM5, or capture camera or microphone input.
It verified the deployed agent data tool, not a real-model conversation.
The STE standard site returned HTTP 403.
Sentence limits and references were checked; full dictionary and word-meaning conformance was not established.

## Gmail deployment

The user authorized a pluggable Gmail service, CM5 deployment, and Personal Agent mail reads.
Existing uncommitted Gmail source was reused from `/Users/FradSer/.codex/worktrees/personal-agent-gmail/open-deskos`.
That original worktree remains unchanged.
The [Gmail guide](../gmail/README.md) owns packaging, OAuth setup, and catalog installation.

Service `odk.gmail.reader` runs through the existing Docker backend.
Selected revision: `8b5879717451c947cc390be4a5539fa4197aabe34f2696b1533b3c5468db306f`.
Rollback revision: `115056c2182b472fdc84a0e4d465b314066a546298b99c68df2880be814236ed`.
Image: `sha256:b831cc475df908bbe3f832c0ed58a2456f66ce1288aa92075dfbe292ca7dd758`.
The update changes documentation only; both revisions use the same immutable executable image.
The deployed image source files and selected package inventory match this worktree.

Operator files are under `/home/orangepi/.config/odk/services/gmail`.
Only its private `grant` directory mounts read-only at `/credentials`.
Its authorized `credentials.json` has owner UID 1000 and mode `0600`; the Desktop export remains on the Mac.
The Agent receives `/run/user/1000/odk-gmail/query.sock` through `ODK_MCP_GMAIL_SOCKET`.
It receives no Gmail credential path or token.
The service runs without published ports, with UID 1000 and a read-only root filesystem.

The coordinator reports Personal Bot activated at `/opt/odk/components/releases/20261024-gmail-main-3cc319b8-v4`.
Its 269-source inventory retains main `3cc319b8` with four privacy overlays; two dependency shims use relative component paths.
Reported Bot PID is 1830458, with start ticks 58396908.
Only its `99-gmail-service.conf` drop-in selects this independent component.
The original Bot drop-ins remain; the Shell changed through the coordinated transaction.
The Gmail MCP catalog revision is `fc5ce79cea2b65d719eac952b5fd3acafe9f4bfc26a7c53169895682c11e0fc2`.
It references the retained rollback package's bridge; bridge source matches the selected package.
The optional `gmail-reading` Skill is installed in the resident's existing catalog.
Generic policies deny child access and suppress automatic learning from private connector turns.

Gmail passed 45 local tests and type checking.
Affected Agent checks passed 114 tests and type checking.
Eight focused checks and positive learning controls also passed against the original v2 component source.
Independent host acceptance verified three read-only tools, private-data admission, child denial, and the unconfigured account state.
CM5 disable, enable, update, and rollback checks passed with one persistent Agent connector runtime.
Futu state and PID, the Personal Bot PID, and the Shell release remained unchanged during those lifecycle checks.
The resident completed discovery, status, search, and reading for one real message with 331 body characters.
Its 42-character Chinese summary passed a private content review and appeared completely in the actual Shell message.
Safe host evidence is `/home/orangepi/.local/share/odk-service-runtime/gmail-cm5-acceptance-20261024.json`.

The user accepted the Google API Services User Data Policy and authorized read-only Gmail access.
Project `open-deskos-agent-20261024` has a dedicated Desktop client and one test user.
Google consent completed with exactly `gmail.readonly`; the new grant has private local storage and mode `0600`.
CM5 received the grant without a restart; independent provider and resident reads matched by message and body hashes.
The first scripted request returned an incorrect permission refusal without tools; its record remains separate from the successful natural-language request.
[Testing grants expire after seven days](https://developers.google.com/identity/protocols/oauth2#expiration) for this scope.
Private acceptance receipts and the actual message image are under `/Users/FradSer/Documents/Codex/2026-10-25/cm5-gmail-e2e`.
No credential bytes belong in packages, source, diagnostics, or this handoff.
This chat returned the coordinated device window at `2026-10-24T16:32:46Z`; no further host, model, or UI operation is pending.
The `3cc319b8` compatibility candidate passed 1359 Bot tests, with 10 existing skips, plus 45 Gmail tests and type checking.
Preparation evidence remains in `LOCAL-READY-v4.json`; `/private/tmp/odk-gmail-main-3cc319b8-20261024/COORDINATOR-ACTIVATION-RECEIPT.json` records activation claims and the current exclusive device window.
