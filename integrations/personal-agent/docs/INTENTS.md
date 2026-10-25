# Personal Agent Intent wishes

The fixed `intent` plugin stores owner wishes in `<stateDir>/personal-agent/intent.md`.
Enable it explicitly through `agentPlugins.enabled` in the existing Personal Agent profile.
The fixed `didi` capability is separately required for ride discovery.
No arbitrary Pi plugin or executable Intent package is loaded.

The owner creates and edits wishes through normal conversation.
For example: “Every day around 11:30, suggest a ride from my selected office to my selected gym.”
The owner does not write JSON, code, or a rule language.
The actual owner input first enters Jev routing.
The fixed editing tools then check the requested change against that current turn.
An edit requires the current Intent revision.
The Markdown document contains readable wishes, conditions, and non-authorizing structured metadata.
It cannot contain an action object, executable tool, or purchase permission.
Current explicit owner instructions take precedence over older habits.

## Conditions and delivery

The existing ProactiveWatch owns all heartbeats and service pushes.
Intent does not add a scheduler, owner turn, or automatic order timer.
A daily time window is optional.
A specified time uses Asia/Shanghai and ten minutes unless the owner selects another supported zone or window.
Daily includes weekends.
Windows can cross midnight and retain their starting local date.
A missed window does not cause later catch-up.
Without a time, current context can create a candidate throughout the local day.
Each Intent revision permits at most one discovery occurrence per local day.

Code first checks the window.
Jev then checks sufficient evidence and condition satisfaction separately.
It receives only selected Memory notes and bounded fresh observations from the existing desk data reader.
Memory is reference data, not live location, current availability, or authorization.
A ride can reference named company, gym, and city notes.
The runtime resolves those current note values before actual discovery.
Explicit route names override older referenced notes.
Relevant note fingerprints invalidate earlier previews and late estimates.
Missing or contradictory current facts remain unknown.
False and unknown conditions do not search or estimate rides.
Unchanged context reuses its private judgment checkpoint.
A relevant note or observation change permits another condition judgment.
Context-only wishes permit at most one additional clock-driven judgment each hour.
Timed wishes can recheck once per minute inside their window, which is limited to 30 minutes.
The normal generator proposes advice, and the existing independent Jev grounding and delivery judgments still apply.
No fixed advice replaces a failed model.

## State and invalidation

The existing private proposal checkpoint stores Intent occurrence claims before external discovery.
Failed, expired, interrupted, superseded, and insufficient-context outcomes remain inspectable through `intent_list`.
A restart cannot replay a claimed discovery or restore an old preview handle.
Recent occurrence history is bounded to 256 records.
Old closed occurrences contribute fixed outcome counts when that history needs space.
Per-Intent date and revision watermarks prevent clock rollback from replaying archived discovery.
Editing, muting, Memory changes, or a selected source update invalidates older results.
Only current, unchanged Intent data can retain a preview handle.

## Ride suggestions

Searches use the declared DiDi MCP capability with an explicit city and named endpoints.
Code verifies the returned city; the search request alone cannot establish the actual city.
Missing and ambiguous places require clarification or explicit selection.
No city, coordinates, or current pickup position is inferred from a habit.
Unique city-verified candidates can receive a real read-only estimate.
Multiple candidates remain visible without an automatic selection or estimate.

The suggestion opens route details without issuing a conversation turn or order.
Details contain actual candidates, bounded product prices, observation time, expiry, and the environment label.
Account fields, provider trace identifiers, and external links are omitted.
The owner selects actual place handles and requests a current quote through the existing owner text channel.
After restart or expiry, the owner can explicitly open saved suggestions and select Refresh preview.
This read obtains current search results with new handles.
The owner selects the endpoints again; old handles cannot select new results.
Manual preview reads can occur outside the daily offer window without adding a scheduled occurrence.
A changed or muted Intent cannot refresh its old preview.
Jev routes that request to the fixed ride workflow.
The host validates the exact issued handles and obtains a new interactive estimate.
An old preview cannot restore transaction authority.
Product selection and the later exact confirmation phrase remain required by the [ride contract](CONTRACT.md#ride-authorization).
An unknown order or cancellation outcome is never replayed.

## Verification

Run the affected checks from `integrations/personal-agent`:

```sh
node --test tests/intents.test.mjs tests/intent-tools.test.mjs tests/didi-preview.test.mjs
node --test tests/proactive*.test.mjs tests/didi*.test.mjs tests/intent-routing.test.mjs tests/agent-plugin-integration.test.mjs
pnpm typecheck
```

The Shell checks use `runtime/shell/tests/proactive-panel.test.js` and the isolated `proactive-panel.cjs` Electron fixture.
Synthetic checks do not establish live Jev quality, actual MCP availability, device acceptance, or a paid order.
