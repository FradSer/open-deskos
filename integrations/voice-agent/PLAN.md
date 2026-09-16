# Managed voice coding tasks

## Confirmed scope

The operator confirmed on 2026-09-15:

- Start independent Pi coding tasks on both CM5 and Mac.
- Work on existing Widgets and Apps, not WeChat applications.
- Limit project selection to configured development roots; ask when the target is ambiguous.
- Support Chinese speech, task instructions, and replies.
- Default to editing and verification. Do not automatically commit, push, install, or deploy.
- Distinguish acceptance, running, terminal outcome, and verification evidence.

The development-root and deployment-policy selections used the UI's recommended timeout defaults; the complete scope was subsequently explicitly confirmed.

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

## Current verification

- Voice integration: 68 Node tests pass; `pnpm typecheck` passes.
- Focused renderer voice tests: 3 pass; changed renderer JavaScript syntax checks pass.
- Fullscreen Electron interaction checks passed before the foreground-test prohibition, including pointer-capture cancellation and restored Remote focus mode. No foreground E2E was run after that restriction.
- Task lifecycle audit findings for overlapping project paths, removed-directory cancellation, empty failure replies, persisted-record validation, JSON-escaped receipt sizes and malformed Unicode were fixed with regression tests.
- Service templates and setup documentation exist; they are not installed production services.

