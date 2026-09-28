# A Gamepad is read by the Shell and expressed as navigation intents

## Status

Accepted

## Context

A 64-bit Windows handheld is a supported Shell Host (ADR 0023), and its owner operates it the way a console is operated: an Xbox-style pad is in their hands, and they expect the directional pad to move, A to confirm, B to cancel, the shoulders to change page, and one button to reach voice. Today the desk answers a keyboard and its own Remote Control — the CM5's touchscreen device (see `CONTEXT.md`) — and nothing reads a pad, so the handheld is missing the input surface its owner actually uses.

Three things had to be settled rather than assumed.

**Where the pad is read.** A pad can be read natively: XInput on Windows, evdev on Linux. That would give the desk analog stick and trigger values, rumble, and a lower-latency read, at the cost of a per-host implementation, a native build step in the release, and device permissions on the Linux host. The renderer already has a gamepad surface of its own, presented as the same standard mapping on both hosts.

**What the shoulders mean.** The desk's remote input handler treats `left` and `right` as context: in browse mode they change page, and in focus mode they move focus. The owner's requirement is that the shoulders change page *whatever* the desk is focused on, so a shoulder cannot be a direction without inheriting the direction's second meaning.

**One dead intent was found.** The Remote Control's `mic` input reaches the Shell's remote input handler and does nothing there: the Remote's MIC button travels a different path (the Remote Bridge's own callback, over the link). A pad's voice button mapped to that intent would have been a dead button.

## Decision

- A Gamepad is a second surface for the navigation intents the desk already has, and never a second navigation model. It is not the Remote Control, and `CONTEXT.md` keeps the two devices distinct.
- The pad is read by the Display Shell through the renderer's own gamepad surface, with the control-to-intent mapping in one table. A pad whose mapping the Shell cannot read is stated as connected and drives nothing; an unreadable pad never hides a readable one.
- Two intents name changing page: `page-previous` and `page-next`. They are handled before the desk's mode branches, so they hold in every mode, and `left` and `right` keep the two meanings they already had. The Remote Control may send them too; nothing about the Remote's own model changes.
- The reading clock is the Shell's, driven by timers — about 60 Hz while a pad is connected, one poll every two seconds otherwise — so navigation input does not depend on the desk painting, and an occluded window still reads its pad.
- Presence is stated, not controlled: a status indicator appears only while a pad is connected, and carries the muted emphasis and an explanatory accessible name when the Shell cannot read the pad.
- `mic` becomes a real intent: it reaches the desk's own microphone entry point, the same one the Remote Control's MIC reaches through the link, so the pad adds no second way of talking to the desk.

## Consequences

- The handheld gets its pad without a native module, a build step, or device permissions, and the CM5 pays nothing for it: one implementation serves every Shell Host.
- Analog sticks, triggers, and rumble are available from the same surface but deliberately unused, because the confirmed scope is directional movement, confirm, cancel, page, and voice.
- A pad that Firefox-style implementations would report without the standard mapping drives nothing; the desk says so rather than appearing broken.
- The desk now reads a pad sixty times a second while one is connected. That cost stops when the pad goes away, which is why the reading is gated on presence rather than run unconditionally.
- The Shell owns the pad, so a future per-host pad feature would be a reversal of this decision, not an addition to it.