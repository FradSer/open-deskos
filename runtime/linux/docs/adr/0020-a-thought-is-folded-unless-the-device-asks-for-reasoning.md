# A thought is folded to Thinking... unless the device asks for reasoning

## Status

Accepted. Extends ADR-0015's Session Event reading and keeps its control-free Session Detail.

## Context

Pi streams its reasoning as a Session Event kind of its own, bounded to 4 KiB, and the Session Detail published every thought body by default. The desk is a shared surface: a session's private deliberation was the first thing a passer-by read, and the operator asked for the reasoning to be hidden by default and revealed only by configuration.

Where that configuration could live was the open question. ADR-0015 settled that the Session Detail carries no page title and no controls, so a disclosure inside it was not available. The page-owned Remote Control Strip is where a page may publish a control (ADR-0005), but a display preference is not a session action, and the strip has one stated home per control. The operator chose device-local runtime configuration instead of a second strip button, which also matches the inventory's L3 layer: a value the release cannot decide and the device can.

## Decision

- **Every thought is folded by default.** The Session Detail renders one quiet row reading `Thinking...` per turn — the events between two of Pi's own turn boundaries, a prompt Pi received or a reply Pi finished — in the place of that turn's first thought, and the bodies Pi produced never enter the page. One row per thought instead repeated identical copy down the stream and reported a count of deliberations the desk does not publish; one row per turn states what the fold may claim, that Pi thought before it acted. The row's own words name the event kind, so no assistive label repeats it, and a truncation note belongs to a shown body, so a folded row carries none.
- **The device's runtime display opens the bodies.** `ODESK_PI_REASONING=shown` in `runtime.env` publishes what Pi was thinking. Only that exact value opens the fold: any other value, including a typo, a case variant, or a boolean, keeps the folded default rather than becoming a second way to publish reasoning.
- **The display travels the existing configuration seam.** The main process resolves it from the environment and passes it on the renderer URL as `piReasoning=shown` — the folded default is not restated there. The renderer resolves the URL once, hands every plugin `ctx.runtimeConfig`, and the Pi Sessions plugin reads it from `ctx` and never from the environment or the URL itself.
- **The fold is display only.** The Session Event still carries the body Pi produced, with its own 4 KiB bound and truncation flag; nothing is dropped from the stream. Because a folded row repeats one line of copy, the detail's reading position is keyed by the row's place counting from the newest event, and its text only confirms that place.
- **No control is added anywhere for this.** The Session Detail stays control-free and the Remote Control Strip keeps its one Session Filter button.

## Consequences

- The desk's default reading no longer publishes a session's deliberation, and revealing it costs one device-local configuration line rather than one press per session.
- A reader of a folded stream still sees that Pi thought and where that turn's thinking began relative to its tools and replies. What it no longer sees is the body, or how many thoughts one turn held: a fold that reports a count would be reporting deliberation it withholds.
- `ODESK_PI_REASONING` is device-local launch configuration: it is listed in `docs/CONFIGURATION.md`, `tests/config-inventory.test.js` keeps it there, and changing it takes a Shell restart because the renderer resolves it at launch.
- Verification is split by seam: `tests/pi-reasoning-display.test.js` proves the resolution and the folded default, and `tests/pi-sessions-interaction.cjs` relaunches the renderer with the query the main process would build to prove both readings, the folded row's order, and the preserved reading position.
- Retention, byte bounds, and truncation for a thought are unchanged, so nothing about the session log's contract moved with this display.
- The reasoned-but-unread body is not a control's state and never becomes one: a future in-page toggle would have to supersede this record rather than extend it.