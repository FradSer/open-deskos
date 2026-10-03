# Managed voice coding tasks

## Confirmed scope

The operator confirmed on 2026-09-15:

- Start independent Pi coding tasks on both CM5 and Mac.
- Work on existing Widgets and Apps, not WeChat applications.
- Limit project selection to configured development roots; ask when the target is ambiguous.
- Support Chinese speech, task instructions, and replies.
- Hosted Pi sessions use the host's full exposed tool set; retain truthful verification, durable receipt, admission, and no-blind-retry rules.
- Distinguish acceptance, running, terminal outcome, and verification evidence.

The development-root and deployment-policy selections used the UI's recommended timeout defaults; the complete scope was subsequently explicitly confirmed.

## Coordination revision

The operator explicitly selected a coordination-only resident Personal Bot after reviewing ADR-0014. Generic write/edit/bash/powershell definitions are removed from the coordinator's SDK registry through excludeTools; source implementation goes to an explicit configured Hosted Pi, which retains the full host tool capability. No target is reported as unconfigured rather than used as a reason to implement locally. Global second confirmation and origin-restricted worker profiles are not introduced.

The first increment records host-observed command outcomes and before/after source samples in existing Hosted Pi history. It leaves independent verification at `not_run`; neither model claims nor exit zero become certification. Matching samples are not immutable execution snapshots. Acceptance seams are the real SDK active-tool list on session resume, the capability/helper/host handoff followed by another fixture MIC action, and check tool/history results on isolated Git fixtures. Tests contact no model/STT service or physical microphone; deployment and hardware acceptance stay separate.

## Pi v1.0 and codemode revision

The operator first required Pi v0.99 codemode and then superseded the target with v1.0 across devices. The tested SDK is pinned exactly to 1.0.0 with its frozen lockfile; both resident profiles load codemode from the installed package through the loader's extension factories, never from user or project configuration.

`codemode` is the only model-facing tool. Personal Bot capabilities moved to `exposure: "codemode"` with output schemas, so a script receives structured results and the model never sees them as individual tools; mutation and payment tools are sequential while read-only ones may run in parallel. Reaching the coordinator's reviewed surface requires the denylist of generic mutation and shell entry points to hold, and a resumed conversation does not restore them. The DiDi confirmation gate and the exact-turn memory grant still apply through nested calls.

Two facts shape the rest. Nested tool results are not persisted by Pi, so host-observed check metadata is recorded by the host into its own session log rather than read out of script output. And a failed script keeps its completed side effects, so the coordinator reports uncertain outcomes instead of retrying.

Offline SDK fixtures pin these behaviors without a model, provider or microphone: the declared tool list is exactly `codemode`; a script batches tools and preserves independent failures; an exact-turn memory grant refuses a nested mutation; the DiDi gate still refuses without the confirmation phrase; and nested check evidence survives in history after a script omits it.

## Device v1.0 rollout

Read @docs/PI_V1_MIGRATION.md for source evidence, actual pre-upgrade inventory and authorized operational boundaries. Treat host CLI, SDK dependency, deployed source and live process as separate version facts. Do not restart the Shell. Wait for no live Hosted Pi identities, not merely an idle turn, before restarting its daemon.

## Delivery order

1. Complete the full-screen voice layer: block underlying paging/actions, omit completion labels, support vertical result scrolling, restore context on Back.
2. Research current Pi SDK and host-control contracts using primary sources.
3. Implement the smallest local managed-task runner with durable task records and deterministic tests.
4. Add configured CM5/Mac transports and coordinator tools without making SSH lifetime own the coding task.
5. Add Chinese transcription/reply contracts and tests.
6. Verify both host paths, audit independently, and report actual deployed versus host-only coverage.

## Test execution constraint

The operator requires E2E tests not to appear in the foreground or steal desktop focus. Native pointer/touch/keyboard E2E must run in an isolated virtual display, not the Mac desktop or CM5 production display. CM5 currently has neither `xvfb-run` nor `Xvfb`; no packages were installed and no production-display workaround is permitted. If no isolated display is available, report these checks as unverified rather than opening windows or weakening assertions.

## Safety and truthfulness

Closing voice feedback is not task cancellation. Disconnected status is not failure. A task receipt is not completion. A completed model run is not proof that tests passed. Unknown mutation outcomes must not be retried as new tasks.

Configured roots select trusted workspaces; Pi's bash and file tools are not a filesystem sandbox. Avoid representing a path check as process isolation.

## Technical findings and acceptance limits

See `runtime/linux/docs/VOICE_MANAGED_TASKS_RESEARCH.md`. The obsolete standalone session-control executable does not provide startup and has been replaced with managed-task tools. A separate atomic task receipt is required because SDK session persistence can begin only after an assistant message.

Host templates and configured transports support Linux and macOS, but repository code alone does not install services. The existing CM5 SSH alias `pi-monitor-mac` returned `No route to host` during this session. Live Mac acceptance is blocked until the configured connection is reachable. No production task runner installation or real authenticated two-host model task has been verified yet.

## Review corrections and evidence boundaries

- Production-startup tests cover both resident profiles, including loader reload and the real SDK active/callable tool lists. Loader and session settings are intentionally separate because SDK reload drops runtime overrides.
- Cache warming follows the operator's global Pi setting. The former applyOverrides claim was inert; startup does not persist a setting change.
- A single oversized history entry is refused with its physical position; it never returns an unchanged continuation. An explicit skip omits that entry and must not be described as complete history.
- Check metadata uses bounded credential-aware command labels and exact-command digests. Ordinary worker arguments/output remain private transcript data, not a secret vault. Structured output is bounded to 64 KiB and comes from raw SDK output (or the last raw streaming snapshot on interruption), never the display footer containing a temporary path. Each of the two source samples has a shared five-second budget across two passes: up to about ten seconds extra sampling latency, not thirty. No production-workspace performance claim is made.

## Current verification

- Personal Bot integration: bounded Node suite and TypeScript checks use Pi 1.0.0. The test script now sets a per-test timeout. On this machine pnpm 11's automatic dependency check attempted a no-TTY repair after a failed offline update; frozen-lockfile dependencies were restored with cached pnpm 10 (scripts disabled). `pnpm --config.verify-deps-before-run=false test` and `pnpm --config.verify-deps-before-run=false typecheck` run the same scripts without that local auto-repair. No manifest/lockfile dependency change was required for recovery.
- Shell runtime (`runtime/linux`): the Node contract suite passes except one pre-existing, unrelated failure, `git-agent uses concise scopes aligned with the current topology`, which fails identically with these changes stashed. Run it as `node --test --test-timeout=120000 tests/*.test.js`.
- Active-host Pi v1.0 rollout completed on the known Mac, CM5 and Windows hosts: CLI versions were checked separately from selected SDKs. CM5 Personal Bot/Hosted Pi and Windows Voice restarted on hash-gated SDK 1.0.0 source; Shell and unrelated process identities, configuration and persisted-state boundaries were preserved. Actual native SDK/QuickJS checks used offline model streams. No microphone, transcription/model-provider request or foreground Electron window was exercised; full spoken-turn, cross-host model and Windows capture acceptance remain unverified. See @docs/PI_V1_MIGRATION.md for inventory, payload identity and remaining limits.
- Focused renderer voice tests: 3 pass; changed renderer JavaScript syntax checks pass.
- Fullscreen Electron interaction checks passed before the foreground-test prohibition, including pointer-capture cancellation and restored Remote focus mode. No foreground E2E was run after that restriction.
- Task lifecycle audit findings for overlapping project paths, removed-directory cancellation, empty failure replies, persisted-record validation, JSON-escaped receipt sizes and malformed Unicode were fixed with regression tests.
- Earlier template-only coverage is historical. The required CM5 agent services and Windows OdkPersonalBot task were observed running and upgraded in this rollout; no new Mac resident service or Windows Hosted Pi daemon was installed. Old rollback/release/development copies were not rewritten. Parent worktree and device development checkouts remain separate from the selected active candidate.

