---
target: firmware/linux renderer (CM5 Electron kiosk)
total_score: 40
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-23T06-00-20Z
slug: firmware-linux-src-renderer-index-html
---
# Critique Snapshot — Open DeskOS Linux Shell (firmware/linux/src/renderer)

Method: dual-agent (A: ship40-a · B: ship40-b)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Live network, bridge, page context, quota/peek state, clock, and refresh feedback are visible |
| 2 | Match System / Real World | 4 | Localized USB workflow and truthful 未配置/待接入/未启动 states |
| 3 | User Control and Freedom | 4 | Swipe, dots, arrows, Home/End, Back, Escape, page and focus restoration |
| 4 | Consistency and Standards | 4 | AIODI tokens, outlined tile/pill language, Tabler icons, standard dialog semantics |
| 5 | Error Prevention | 4 | Explicit unavailable states, drag suppression, inert modal background, focus trap |
| 6 | Recognition Rather Than Recall | 4 | Named page context/dots, visible tile states, USB steps, troubleshooting, operation guide |
| 7 | Flexibility and Efficiency | 4 | Touch, direct dots, arrows, Home/End, operation guide |
| 8 | Aesthetic and Minimalist Design | 4 | Calm AIODI instrument language, restrained accents, no fake metrics |
| 9 | Error Recognition and Recovery | 4 | Network/bridge separation, refresh, 3-step + 3-check USB path, Back/Escape |
| 10 | Help and Documentation | 4 | Contextual operation guide, connection instructions, troubleshooting |

Total: 40/40. Applicable maximum 40; all heuristics scored. No confirmed P0-P3 issues.

## Design Specificity Verdict

The bounded CM5 shell now reads as a finished Open DeskOS desk instrument rather than a layout study: AIODI geometry and flat black/charcoal surfaces remain specific to the P4 launcher, while localized state labels, bundled fonts, visible page context, truthful network/bridge separation, and actionable connection guidance give the Linux slice its own complete operating path. Deliberate missing bridge/apps/hardware are disclosed rather than simulated.

## Deterministic and Browser Evidence

The detector's available checks report only heuristic Montserrat overuse warnings; these are intentional product typography and not functional defects. The detector falls back to regex because parser modules are unavailable, so computed contrast/selector checks are not evaluated. Browser detector evidence is limited by the bundled `detect.js` asset being unavailable in the current skill installation; the static server/browser capture was attempted and cleaned up. This tooling limitation does not override the project's 56/56 e2e, smoke, token, and geometry verification.

## Strengths

- Systemic truthfulness: no fabricated usage, activity, connection, or timer values.
- Separate network and Mac bridge states in bolt, peek, quota, refresh, and USB guidance.
- Complete navigation and accessibility path: swipe, labeled dots, arrows, Home/End, Back, Escape, focus restoration, dialog focus trap, inert background.
- Deterministic bundled AIODI fonts, official Tabler paths, token-checked colors, and responsive geometry.
- Contextual operation guide plus three connection steps and three troubleshooting checks.

## Priority Issues

None confirmed at P0-P3 severity for the deliberately bounded CM5 slice.

## Persona Findings

- Desk-side developer: succeeds through glanceable clock/date/status and low-depth touch navigation.
- First-time owner: gets visible page meaning, truthful unavailable states, connection steps, troubleshooting, and recovery controls.
- Migration evaluator: gets explicit bridge boundary, deterministic fonts, AIODI parity, and repeatable geometry/test evidence.
- Keyboard/accessibility user: gets page arrows/Home/End, labeled dots, modal focus containment, Escape, visible focus, and focus restoration.

## Minor Observations

Future bridge integration can add discovering/connected/stale lifecycle states, concrete sync timeout, companion installation source, and retry diagnostics without changing the current shell hierarchy. CM5 GPU/touch/autostart remain hardware-validation work, not renderer defects.

## Questions to Consider

- When bridge integration lands, can it preserve the current truthful state vocabulary?
- Which live app should replace the first `待接入` tile without increasing the glance burden?
- What CM5 hardware observations should be added to the next visual verification pass?
