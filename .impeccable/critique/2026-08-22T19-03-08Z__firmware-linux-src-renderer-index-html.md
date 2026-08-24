---
target: firmware/linux renderer (CM5 Electron kiosk)
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-22T19-03-08Z
slug: firmware-linux-src-renderer-index-html
---
# Critique Snapshot — Open DeskOS Linux Shell (firmware/linux/src/renderer)

Method: dual-agent (A: critique-a · B: critique-b)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Bolt icon is static grey — never reflects connection state; dots show position only |
| 2 | Match System / Real World | 2 | Fabricated activity claims contradict the real world |
| 3 | User Control and Freedom | 2 | Back works, but dots are not tappable and swipe is the only page route |
| 4 | Consistency and Standards | 2 | White almanac tile vs charcoal/blue tiles; EN/ZH mix; :active is sole touch feedback |
| 5 | Error Prevention | 1 | Every tile opens an unimplemented dead end; drag-release can misfire a tap |
| 6 | Recognition Rather Than Recall | 1 | Dots carry no page meaning; horizontal swipe undiscoverable; no labels |
| 7 | Flexibility and Efficiency | 2 | No direct page access, keyboard path, or alternative navigation |
| 8 | Aesthetic and Minimalist Design | 2 | Disciplined black field, but duplicate year meter + empty 160px peek waste attention |
| 9 | Error Recovery | 1 | Generic "此平台尚未实现该 App。" — no status, no next action |
| 10 | Help and Documentation | 2 | Labels self-evident, but swipe undocumented and empty states give no guidance |

Total: 17/40 (Poor). Applicable maximum 40; all ten heuristics scored (Operate surface).

## Design Specificity Verdict

Skeleton is recognizably Open DeskOS (black field, bolt/dots/clock anatomy, AIODI grid port, scarce accents), but content is category-interchangeable and dishonest: fabricated lifestyle metrics on the primary glance surface. Truthful quota card proves honest empties are achievable. Empty peek + placeholder app screens read as migration scaffold, not authored product.

Deterministic scan: CLI exit 2 — 1 warning: layout-transition at shell.css:84 (.dot width/background transition, matches active-dot 12px→28px animation; genuine, not false positive). Scanner ran regex fallback (parser modules unavailable) → findings are an undercount. Browser overlay injection succeeded; in-page detector reported zero findings. Screenshot: /tmp/odk-critique-b.png.

## Strengths

- Runtime geometry port (layout.js): grid flush to edges on any ratio, peek region reserved, e2e-proven at 636x1087.
- Status-bar anatomy + tabular glance numerals mirror the P4 launcher exactly.
- Honest quota empty state + consistent inline Tabler SVG vocabulary.

## Priority Issues

1. [P0] Fabricated dashboard facts ("3 meetings / 2 tasks / 1 habit", "mostly free", "4.7K steps", "7.3 hours") violate the no-fabrication law. Fix: strip until backed by real feeds; explicit unavailable states. Command: $impeccable harden
2. [P1] Swipe/tap race: click suppression cleared via setTimeout(0); synthetic click can fire after reset and open a widget post-swipe. Fix: one-shot suppression flag consumed in capture-phase click handler. Command: $impeccable harden
3. [P1] Invisible system state: bolt hardcoded grey; dots non-interactive, unlabeled; no swipe hint. Fix: bind bolt to real state, labeled tappable dots, first-run hint. Command: $impeccable polish
4. [P1] Attention overrun: 7 narrative groups + 2 stats + duplicate YEAR meter + empty 160px peek (5/8 cognitive-load failures). Fix: dedupe year progress; collapse peek until real content. Command: $impeccable distill
5. [P2] Dead-end app view: generic "此平台尚未实现该 App。" on every tap. Fix: per-app unavailable copy/guidance or availability marks. Command: $impeccable clarify

## Persona Red Flags

Jordan (first-timer): pages 0/2 undiscoverable (no dot names, no hint); seven low-label choices; dead-end copy.
Sam (accessibility): non-focusable dot spans; missing widget state descriptions; no focus styling on Back; touch-only swipe + user-select:none; #706f70 on #171717 contrast risk.
Casey (distracted touch): :active-only feedback; ambiguous 18% drag threshold across tiles; borderline 44px Back target.
Glance-first desk developer (project persona): fabricated claims poison instant truth; static bolt can't answer "is Mac connected?"; narrative exceeds 2-second glance contract.

## Minor Observations

- No webfont loading; device-image font absence silently shifts metrics.
- .w-almanac literal #ffffff breaks tokens-only law; checker misses literals.
- App header 1px border + 14px radius clashes with 4px-stroke/36px tile language.
- EN narrative vs ZH labels reads as unfinished localization.
- Ring arc/year meter imply live state with no source.
- ARIA gaps: unlabeled dots, inconsistently hidden decorative SVGs.

## Questions to Consider

- With unsupported metrics gone, what single truthful glance remains — is it enough to be the product?
- What real state earns the 160px peek island?
- Should tiles invite taps into nonexistent features or advertise availability first?
