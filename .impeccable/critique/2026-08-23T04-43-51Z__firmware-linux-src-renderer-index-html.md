---
target: firmware/linux renderer (CM5 Electron kiosk)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-23T04-43-51Z
slug: firmware-linux-src-renderer-index-html
---
# Critique Snapshot — Open DeskOS Linux Shell (firmware/linux/src/renderer)

Method: dual-agent (A: critique-a2 · B: critique-b2)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Clock/date/year and network bolt update, but blank peek and static 25:00 imply unclear state |
| 2 | Match System / Real World | 3 | Calendar metaphors fit, but network-online is not the same as Mac-bridge-connected |
| 3 | User Control and Freedom | 3 | Back preserves context; no system-back/escape path and app views remain dead ends |
| 4 | Consistency and Standards | 2 | Geometry is strong, but fonts are not bundled, labels mix languages, and app views are generic |
| 5 | Error Prevention | 3 | Swipe/tap and pointer-cancel handling are hardened; inactive tiles still look actionable |
| 6 | Recognition Rather Than Recall | 2 | Page dots lack visible names/current-page identity; blank peek and bolt semantics require guessing |
| 7 | Flexibility and Efficiency | 2 | Swipe and dots work, but no bridge shortcut, reduced-motion behavior, or useful alternate path |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained AIODI treatment works; empty surfaces and repeated dead ends feel unfinished |
| 9 | Error Recovery | 2 | App copy names the missing app but offers no retry, connection action, or next step |
| 10 | Help and Documentation | 1 | No guidance for swipe navigation, offline state, Mac connection, or peek behavior |

Total: 24/40 (Acceptable). Applicable maximum 40; all ten heuristics scored.

## Design Specificity Verdict

The shell is moderately specific to Open DeskOS: AIODI geometry, black-and-white instrument palette, rounded outlined tiles, date stream, and P4 parity are recognizable. Fabricated dashboard data is gone and touch handling is substantially stronger. Without bundled fonts, Mac/CM5 bridge affordance, meaningful peek content, or app-specific next steps, it still reads partly as a polished layout study rather than a finished desk-side operating surface.

The score improved from 17/40 to 24/40 on the same ten-heuristic set.

## Detector and Browser Evidence

CLI exit 2 with one confirmed layout-transition warning at shell.css:88 for animating .dot width. The finding is genuine. The detector used degraded regex fallback because htmlparser2, css-select, css-tree, and domutils were unavailable; parser-dependent checks were not evaluated. Browser preflight and injection succeeded on a fresh localhost tab; no browser console errors or detector messages were reported. Screenshot: /tmp/odk-critique-b2.png. Live server stopped and port closure verified.

## Strengths

- Truthful dashboard with fabricated meetings, tasks, habits, steps, and sleep values removed.
- Hardened interaction safety, direct page dots, and reliable Back behavior.
- Declarative responsive AIODI geometry preserving P4-inspired structure across tested sizes.

## Priority Issues

1. [P1] Connection semantics are ambiguous: navigator.onLine is not Mac bridge connectivity. Separate network, Mac bridge, and sync states; provide Connect Mac over USB and retry/status feedback. Command: $impeccable harden
2. [P1] Empty peek is a broken promise: populate it with truthful bridge/sync status or label it as reserved and reduce its visual dominance; remove it from the accessibility tree if decorative. Command: $impeccable distill
3. [P2] Paging is visually opaque: add current-page title or 1/3 state, optional first-use swipe hint, and reduced-motion handling. Command: $impeccable polish
4. [P2] Typography and contrast are not deterministic: bundle fonts or define a tested device-image font contract; measure rendered copy and improve weak secondary text. Command: $impeccable typeset
5. [P2] Unavailable controls look fully active: add bridge-needed/unavailable states to tiles or distinguish them visually, with app-specific next steps. Command: $impeccable clarify

## Cognitive Load

Five-plus checklist failures remain: abstract dots, no visible page title, six active-looking unavailable tiles, unexplained empty peek, no quota connect/retry path, conflated bolt semantics, and mixed Chinese/English. High cognitive load remains for a glanceable device.

## Emotional Journey

Calm launch and credible instrument language are followed by dependency and absence: disconnected quota, empty peek, and repeated unavailable screens. Back restores control, but repetition makes the device feel unfinished. The next improvement should be one clear bridge connection path, not more decorative polish.

## Persona Red Flags

Jordan: no visible Connect Mac action, no visible page names, and no next step after unavailable apps.
Sam: nondeterministic font metrics, weak secondary contrast risk, no consolidated page identity, and generic peek accessibility semantics.
Casey: all six tiles look ready despite being unavailable; blank/offline states offer no obvious recovery; static 25:00 can look active.
Glance-first desk developer: blank peek consumes glance budget and network-online does not answer whether the Mac bridge is connected.

## Minor Observations

- Intentional .dot width transition is the only confirmed detector warning.
- Static pomodoro 25:00 looks operational without running/paused state.
- Pomodoro ring SVG lacks a Tabler marker.
- English/Chinese labels need a deliberate bilingual strategy.
- #peek has generic aria-label="peek" semantics.
- aria-live may overannounce static unavailable copy.
- startClock() interval is never cleared.

## Questions to Consider

- Is the bolt Wi-Fi availability, USB Mac connectivity, or both?
- Should the first useful app be a prominent Connect Mac action instead of six unavailable tiles?
- Is the blank peek intentionally calm or a visible promise of unfinished work?
- What single truthful state should be understood within two seconds?
