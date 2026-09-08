---
name: open-deskos-remote-pi-monitor
description: "CM5 Pi monitoring supports an optional authenticated SSH Mac source with remote-side liveness and no local fallback"
type: project
---

# Optional Mac Pi source

## Why

The CM5 desk display can monitor Pi running on a Mac without making a Mac a base-runtime dependency or confusing remote failures with local idle state.

## How to apply

The local collector remains the default. Setting ODK_PI_SSH_HOST, ODK_PI_SSH_NODE, and ODK_PI_SSH_COLLECTOR selects one SSH source, not a merged host view. Persist these non-secret values in a kiosk systemd user-service override. Deploy the existing collector and snapshot CLI with sibling src/ and scripts/ directories on the Mac. Mac-side scanning determines process liveness. SSH requires pre-trusted host keys and noninteractive authentication, enforces time/output bounds, and coalesces in-flight requests. Partial configuration, transport failures, and invalid/stale snapshots return unavailable with SSH identity and no local fallback. No host identities or credentials are stored here.

## Stable monitor reading

The Pi renderer keeps first-seen workspace and session ordering for the mounted view rather than inheriting each snapshot's activity order. New entries append. Refresh restores the first visible session card's viewport offset and disclosures so preceding content growth does not switch the reader's folder. Pi-scoped responsive text sizes reach 28px goals, 26px workspace titles, and 18px metadata at 1920×1280. Regression coverage is in `runtime/linux/tests/pi-reading-stability.cjs` and its matching feature.

## Live process and metadata matching (2026-09-06 fix)

`runtime/linux/src/pi-sessions.js` matches a live `ps` process to session metadata by PID plus activity evidence, not by a strict startedAt window. A 5-second startedAt tolerance alone rejected three real patterns and made the CM5 show "Live Pi process; session metadata unavailable" or a false EXITED badge: resumed sessions (`pi --continue`, process starts hours after session creation), sessions created via `/new` inside a long-lived process, and current pi versions that omit `startedAt` entirely. The rule now also accepts metadata whose `updatedAt` is at or after the process start minus 5s — a dead process cannot write after the live one started, so PID reuse stays guarded. `markMetadataExited` sets status unconditionally; leaving `settled` on a dead-looking session produced contradictory snapshot rows. Candidate selection prefers the newest `updatedAt` (the file the live process is serving now). The Mac collector copy at `~/.local/share/open-deskos/pi-monitor/src/pi-sessions.js` must be re-synced whenever this file changes; the CM5 release copy too.

## Related

[[open-deskos-linux-electron-shell]]

- runtime/linux/docs/PI_SESSIONS_REMOTE.md
- runtime/linux/src/pi-sessions-source.js
- runtime/linux/scripts/pi-sessions-snapshot.js
- runtime/linux/tests/features/pi-sessions-remote.feature
