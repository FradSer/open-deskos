# Pi v1.0 migration and device acceptance

## Confirmed scope

The operator requires all Open DeskOS Pi hosts to use v1.0. The concrete registry release is **1.0.0**. They approved a controlled candidate deployment after coding work is idle, retaining device configuration and the running Shell and restarting only affected agent services. No microphone/STT/model calls were authorized by this upgrade decision. Current task worktree only; do not touch the parent Futu change.

This supersedes the prior 0.99.2 target, not the coordinator/worker authority contract in [ADR-0014](../../../runtime/linux/docs/adr/0014-hosted-pi-drops-the-edit-and-test-guardrail.md). Global CLI, bundled SDK, deployed source and running processes are separate version facts. A CLI version is not resident SDK acceptance. Historic immutable rollback releases retain their historic dependencies and are not edited in place.

## Primary-source research

Official release: [npm 1.0.0](https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/1.0.0), [upstream](https://github.com/earendil-works/pi). Read installed package CHANGELOG.md [1.0.0], docs/codemode.md, docs/sdk.md, docs/extensions.md, docs/security.md and relevant emitted types before changing these seams. Tarball integrity: sha512-/FtbxoSQU/mEv1QnichJjRjqteqaIaMWxmhB4G367+MwZfX7/DI5B9YAg5lqbN7nztFskBEtUSZ+FlmMBECtMw==.

- Unknown tool/model properties now throw recovery errors. Use membership ("name" in tools), ALL_TOOLS, searchTools and describeTool, not typeof tools.name for an optional member. Test actual QuickJS execution including a typo after a completed call without replay.
- Codemode prompt is leaner and includes image generation through models. Both coordinator profiles and Hosted Pi retain models:false; upgrading does not implicitly authorize auxiliary image/classifier spend. Existing failure/store/evidence rules survive.
- SDK session creation, explicit codemode factory/bindExtensions, exposure/excludeTools and nested events retain the contracts already migrated at 0.99. Preserve untrusted project settings and separate loader/session overrides. SDK reload still discards overrides and cache warming still reads operator global settings.
- AgentSession tool restoration/refiltering changed internally; real active/all/callable registry tests on resumed coordinator remain mandatory instead of assuming type parity proves safety.
- CLI defaults to fullscreen; quietStartup accepts "header". Headless SDK is unaffected. Existing operator settings are not rewritten. CLI --provider now requires --model; no project launch should rely on ignored provider options.
- Device 0.85.x copies also cross the older 0.87 context/lifecycle migration. Deploy the tested coordinator/Hosted Pi source together, not a bare dependency edit on old production code.

## Specification and seams

Authoritative scenarios: @../features/pi-runtime-version.feature and @../features/personal-bot-codemode.feature. Highest local seam is the real SDK startup/QuickJS/session pipeline using an offline model stream. Host acceptance reads the real daemon/control endpoint and installed package/source fingerprints with no provider prompt. Assertions compare the declared exact version, frozen importer and installed SDK/codemode family.

## Inventory before upgrade

| Host | CLI | Active resident SDK/source | Notes |
|---|---|---|---|
| Mac | 1.0.0 | local candidate 0.99.2; no resident task daemon observed | Configured Windows target reaches a per-session helper, not an installed daemon |
| CM5 | 0.86.1 under /opt/node-v24.16.0-linux-arm64 (root and kiosk same CLI) | active release Personal Bot SDK 0.85.1; development manifest ^0.85.1, no dev SDK | voice and pi-tasks user services active |
| Windows x64 | no global CLI on SSH PATH in first inventory | Personal Bot SDK 0.85.1; actual voice process in interactive Session 1 | Mac target configured; do not alter its private values or historical transcript |

Inventory is observation, not upgrade completion. Reachability, idle-state check, per-component before/after versions and running-process restart evidence must be added to the delivery report. If a device cannot be reached or a working coding session cannot be safely quiesced, report that device as blocked instead of claiming all devices upgraded.

## Operational boundaries

Build/verify/pin local candidate first, then hash-gated host staging and host-specific dependency install. Do not ship node_modules, developer auth/config, token files, audio or log dumps. Preserve operator credential/session files. Do not install a new persistent Mac service if none exists solely to satisfy a version requirement. No Shell restart, release activation that implicitly restarts Shell, live recording, paid provider call, firmware action, commit or push is included.

## Verified active-host inventory — 2026-10-02

| Host | PATH-selected CLI | SDK actually selected | Observed running state |
|---|---|---|---|
| Mac | 1.0.0 | local task-worktree Voice/Hosted SDK 1.0.0 | No persistent task daemon was found or installed; no model turn was requested |
| CM5 | 1.0.0 for root and kiosk user | Voice and Hosted Pi 1.0.0 | Both restarted on the sealed agent candidate; Voice idle, Hosted list empty; Shell PID/start identity unchanged |
| Windows x64 | 1.0.0 on the existing Node PATH | Voice 1.0.0 | Interactive Session 1, new Voice PID 9492, idle; 15 protected processes and private configuration checks preserved; no local Hosted daemon was created |

The live source payload is 37 files with SHA-256 fingerprint `e7d896c7e59fc54cbf33794dbad7c88384faaf675b5977fe0d89a13f1d0901fc`. The reviewed source-and-test candidate was `4a177e07cbc3bea28f14f826c09e256ebe62ece867d34e1e101b6224b00bd7d9`; subsequent delivery-record edits do not change that executable payload.

CM5 selected `/opt/open-deskos/releases/20261002T0545Z-pi-v1-agent`, a sealed clone with byte-identical Shell inputs and only the Personal Bot integration replaced. The agent-only transaction retained every old release and the original configuration. The running Shell remains in its previous physical release directory; that directory must remain present while its launcher lives. The ordinary runtime updater was not used because it restarts the Shell and prunes old artifacts.

Windows `OdkPersonalBot` selects the reviewed integration under `%LOCALAPPDATA%\open-deskos\personal-bot-releases\pi-1.0.0-e7d896c7` through the existing launcher's `-PersonalBotRoot` argument. Its typed action, interactive principal, triggers and settings were preserved. Source synchronization did not overwrite the device's development checkout or copy developer credentials. Old packages/checkouts/releases remain inactive historical or rollback copies, not proof of the active runtime version; the parent Mac worktree was not changed.

## Verification and retained limits

- Full serial Voice suite: **347 passed**, zero failed/cancelled/skipped; TypeScript check and diff check passed. Affected Shell contracts: **33 passed**.
- Independent source review passed Standards and Spec on the fixed candidate. Separate operational reviews covered the fixed CM5 transaction and Windows native corrections; abandoned scripts retained their REWORK verdicts.
- Actual Linux arm64 and Windows x64 SDK startup and QuickJS/codemode ran with offline model events, including tool-membership probes and nested capabilities. This is native SDK acceptance, not paid model or spoken-turn evidence.
- Post-activation checks independently read installed SDKs, source hashes, task/unit selection, new process identities and private status endpoints. CM5 Personal Bot/Hosted Pi and Windows Voice became idle; preserved Shell and unrelated process identities were checked without restarting them.
- The earlier default-concurrency Voice suite exceeded 180 seconds. Serial success does not resolve that limitation. Full native Windows test-suite coverage, a production-workspace sampling benchmark, real microphone/STT/model-provider interactions and an authenticated cross-host coding turn remain unverified.
- Existing authorization and persisted sessions/credentials were preserved. No MIC, capture, provider prompt, firmware operation, commit or push was performed.

Private operational evidence was retained locally under `/tmp/odesk-pi-v1-upgrade/`, including fixed-hash reviews and sanitized activation/after-check logs. Device journals remain at `/opt/open-deskos/state/transactions/` on CM5 and the operator user's `odesk-pi-v1-activation-journal` on Windows. They are private recovery evidence, not deployable source or public diagnostics. See @../../../.memory/runtime-upgrade-acceptance-boundaries.md when designing another upgrade.
