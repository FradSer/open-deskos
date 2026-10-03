# A gamepad drives the desk

## Problem Statement

The Windows handheld is a computer with an Xbox-style pad attached, and its owner
operates it the way a console is operated. Today the desk answers only a keyboard
and its own Remote Control, so the owner's pad does nothing: the desk cannot be
driven from the couch, and a second Shell Host (the handheld) does not get the
input surface the first one grew up with.

## Solution

The desk reads the pad and answers it with the navigation intents it already has.
The directional pad moves within the current page, A confirms, B cancels, the
shoulders change page whatever the desk is focused on, and Y reaches the desk's own
microphone entry point — the same one the Remote Control's MIC reaches through the
link. A connected pad is stated quietly in the status bar, a pad the desk cannot
read is stated as such and drives nothing, and no pad means no indicator at all.

A pad is not the Remote Control: it is a second surface for the same navigation
vocabulary. It is read in the Shell, so it works on every Shell Host without a
host-specific module, and supporting the handheld costs the CM5 nothing.

## User Stories

1. As the handheld's owner, I want to browse the desk's pages with the pad in my
   hands, so that I do not have to reach for a mouse or keyboard.
2. As the handheld's owner, I want the left shoulder to show the previous page and
   the right shoulder the next one, so that page browsing is one press away.
3. As the handheld's owner, I want the shoulders to change page even while a page
   is focused, so that I never have to leave a page to move past it.
4. As the handheld's owner, I want the directional pad to move within the page I am
   on, so that I can walk a list of sessions or read down a page.
5. As the handheld's owner, I want A to confirm, so that choosing a session or a
   control is the same act it is on a console.
6. As the handheld's owner, I want B to cancel, so that leaving a page's focus or an
   open surface never needs a different control.
7. As the handheld's owner, I want holding a direction to keep moving, so that a
   long list does not have to be walked press by press.
8. As the handheld's owner, I want one button to reach voice, so that I can speak a
   request without hunting for the desk's own control.
9. As the handheld's owner, I want that button to use the desk's existing voice
   path, so that the pad adds no second way of talking to the desk.
10. As the handheld's owner, I want to see that my pad is connected, so that a pad
    that has gone to sleep is not a mystery.
11. As the handheld's owner, I want the indicator to be absent when no pad is
    attached, so that a desk I am not playing on stays uncluttered.
12. As the handheld's owner, I want a pad the desk cannot read to be stated, so that
    a silent pad is explained rather than hidden.
13. As the desk's owner, I want one intent for changing page, so that the pad's
    shoulders do not inherit the two meanings a direction has.
14. As the desk's owner, I want the Remote Control's own input to keep working
    unchanged, so that a second surface never becomes a second navigation model.
15. As the desk's owner, I want the pad read without a native module, so that one
    host's input costs another host nothing.
16. As a maintainer, I want the mapping from pad controls to intents in one table, so
    that a pad that reports its own mapping can be added without touching the Shell.

## Scenarios

The executable specification is `runtime/shell/tests/features/gamepad.feature`. Its
scenarios are covered by the module's own tests
(`runtime/shell/tests/gamepad-input.test.js`) and end to end by the interaction
harness (`runtime/shell/tests/pi-sessions-interaction.cjs`, the scenario "a gamepad
drives the desk through the desk's own navigation intents", where the page presents
the same standard-mapping pad the browser would).

## Implementation Decisions

- **Two new navigation intents**: `page-previous` and `page-next`, accepted by the
  Shell's remote input handler. They are handled before the desk's mode branches, so
  they change page in either mode; `left` and `right` keep their two existing
  meanings.
- **The pad is read in the Shell** through the renderer's own gamepad surface, not a
  native module: one implementation for every Shell Host, no build step, no device
  permissions. (See ADR-0027.)
- **A new module owns the pad**: control-to-intent table, press-edge detection,
  held-direction repeat (immediate, then about 450 ms, then about 130 ms), connected
  state with its transition announcements, and a preference for the first pad the
  desk can read so that an unreadable pad never hides a readable one.
- **The Shell owns the reading clock**: about 60 Hz while a pad is connected and one
  poll every two seconds otherwise, driven by timers rather than a paint callback, so
  navigation input does not depend on the desk painting. The browser's own connect
  and disconnect events start and stop it.
- **The desk states presence, not control**: a status plugin shows a pad glyph only
  while a pad is connected, with the muted emphasis and an explanatory accessible
  name when the desk cannot read it, and the pixel theme gets the matching glyph.
- **The microphone intent is now real**: `mic` previously fell through the remote
  input handler doing nothing, so Y would have been a dead button. It now reaches the
  desk's own microphone entry point, the same one the Remote Control's MIC reaches
  through the link.

## Testing Decisions

- Good tests here state the desk's behaviour from the owner's side: which intent a
  physical control produces, what the desk does with it, and what the desk states.
  They do not assert the polling internals.
- **The module's public function is the first seam.** Its tests present pads and a
  clock and assert the intents and presence announcements that come out. Prior art:
  `runtime/shell/tests/plugin-*.test.js` load a renderer script in a context.
- **The interaction harness is the highest seam** and the one that matters: it drives
  a real shell in Electron with a pad the page presents, and asserts the page changes,
  focus is taken and left, the microphone entry point is reached, and the indicator
  appears and goes away. It runs on the handheld as well as on the reference host.
- The pad's own hardware acceptance (a real controller, a real press) stays the
  owner's act; no test can press a physical button.

## Out of Scope

- Analog sticks, triggers, and the rumble motors. The owner asked for directional
  movement, confirm, cancel, page, and voice.
- Any change to the voice chain itself. Y reaches the existing entry point; whether
  voice answers is that feature's own concern.
- Rebinding, per-host mappings, and a settings surface for the pad.
- Reading a pad in the main process, and any host-specific pad code.

## Further Notes

`CONTEXT.md` gained the term **Gamepad**, which is deliberately not the Remote
Control: that term's own `_Avoid_` line rules out calling a controller the Remote
Control, and this feature keeps the two devices distinct while sharing one set of
navigation intents.