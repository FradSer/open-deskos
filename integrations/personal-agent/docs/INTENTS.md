# Personal Agent Routine

The fixed `intent` plugin stores owner routines in `<stateDir>/personal-agent/ROUTINE.yaml`.
Enable it explicitly through `agentPlugins.enabled` in the existing Personal Agent profile.
The fixed `didi` capability is separately required for ride discovery.
No arbitrary Pi plugin or executable Intent package is loaded.

The owner creates and edits wishes through normal conversation.
For example: “Every day around 11:30, suggest a ride from my selected office to my selected gym.”
The owner does not write JSON, code, or a rule language.
The actual owner input first enters Jev routing.
The fixed editing tools then check the requested change against that current turn.
An edit requires the current Intent revision.
The YAML file uses schema version 2 and contains an `entries` sequence.
Each entry has an ID, a revision, an enabled state, and the original request in `ownerText`.
The `when` field records the time window or context trigger.
The `if` field records the condition, typed `inputs`, and named Mem0 note keys.
An `odk-data` input specifies a reading ID and selected fields.
A `service` input specifies the connector, selection, and verified binding.
The `then` field records the suggestion goal and any read-only preview parameters.
The host validates each entry before use.
The `then` field can specify only a suggestion.
Current explicit owner instructions take precedence over older habits.

If `ROUTINE.yaml` is absent, the host looks for `routine.json`, then `routines.md`, then `intent.md`.
The first successful save upgrades earlier YAML, JSON, or Markdown records.
It keeps their IDs and pause states.
An edit advances the changed routine's revision.
Later reads use `ROUTINE.yaml`.

## Routine and Memory

A routine records when to check a condition and what suggestion to offer.
[Memory](CONTRACT.md#profiles-and-memory) stores the owner's background notes.
A routine can refer to selected Memory notes by their keys.
The host reads the current note values during evaluation.
The private proposal checkpoint records the [runtime state](#state-and-invalidation).

## Conditions and delivery

The existing ProactiveWatch owns heartbeats, service pushes, and scheduled checks.

### Daily and context conditions

A daily time window is optional.
A specified time uses Asia/Shanghai and ten minutes unless the owner selects another supported zone or window.
Daily includes weekends.
Windows can cross midnight and retain their starting local date.
The Watch can wake before its next heartbeat for a timed wish.
During the window, the Watch can check again each minute and expire the offer at closing.
A missed window does not cause later catch-up.
A skipped local minute cannot trigger a wake.
Repeated local minutes share the same occurrence date.
Without a time, current context can create a candidate throughout the local day.
Each Intent revision permits at most one discovery occurrence per local day.

Code first checks the window.
The configured judgment model checks evidence sufficiency and condition satisfaction separately.
The host reads only the named Mem0 notes that the rule selects.
The host also limits current observations to the selected Open DeskOS Data fields.
Owner `MEMORY.md` and conversation recall belong to the resident conversation.
Notes supply reference context. The host requires current evidence and authorization separately.
The owner can save and run a rule without note references while Mem0 is unavailable.
If a required note read fails, the condition stays unknown.
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
The normal generator proposes advice, and host structural validation and delivery checks still apply.
No fixed advice replaces a failed model.

### Widget and App suggestions

The owner can select a Widget or App in the conversation and specify a condition for a read-only suggestion.
Personal Agent verifies each newly selected field through Open DeskOS Data before it saves the Intent.
The Watch checks the selected fields after the owner saves the Intent and when the source changes.
The condition needs live values for all selected fields.
The age limit is five minutes or the shorter Watch configuration limit.
The Watch uses each field's measurement time when the source supplies it.
For installed Widgets and Apps, the host supplies the publication time.
Select `odk.tile.weread.latest` to use the newest highlight in the WeRead source.
The model receives only the selected fields, and the host binds each citation to its reading and measurement time.
The local conversation shows concise advice and a read-only next step.
The private checkpoint keeps source fields and measurement times for validation.
Later postpones one suggestion, Ignore dismisses its occurrence, and Pause reminder disables that Intent.
The owner can change or resume the Intent through the conversation.

### Interval windows

Use an interval window to check repeatedly during a time range.
The schedule specifies the local time zone, days, start, end, and interval in minutes.
Days can be every day or Monday through Friday.
The schedule includes its start and excludes its end.
Use the same schedule for an Open DeskOS Data condition or a Gmail label.
The Watch checks a Widget condition once per slot until it finds a match.
A source update can revalidate an existing suggestion.
The Watch offers at most one Widget suggestion per routine revision and local day.

### Gmail label routines

Enable the `intent`, `catalog`, and `mcp` plugins.
Install and authorize the [read-only Gmail connector](../../gmail/README.md) with Gmail label support.
Ask Personal Agent to check a named Gmail label at a specified interval.
For example, ask to check Work from 09:00 to 18:00 every 15 minutes.
Ask for one next step when a new message needs action.
The host binds the exact label name to its Gmail ID and connected account.
The routine stores the Gmail selection in a `service` input and the interval in `when`.
The Gmail routine uses Asia/Shanghai unless the owner specifies another time zone.
Weekdays are Monday through Friday.
A 09:00 to 18:00 window includes the 09:00 check and ends before 18:00.
After a missed check, the next in-window check reads new mail from the saved checkpoint.

The first checkpoint excludes mail received before the routine was saved.
The host reads message bodies only for new mail with the selected label.
The configured model checks each message and supplies a suggestion through OpenUI when the message needs action.
The conversation shows one next step per suggestion.
The next step can open the message or prepare an unsent reply in Personal Agent.
The suggestion provides no permission to send or modify mail.
The owner can pause the routine in conversation.
The Watch makes scheduled Gmail reads only during active slots.

### Design references

- [Lindy routines](https://docs.lindy.ai/teammate/routines) use explicit triggers, scope, and delivery, with controls to stop future runs.
- [Gemini scheduled actions](https://support.google.com/gemini/answer/16316416?hl=en) support conversational edits and pause controls.
- [Copilot scheduled prompts](https://support.microsoft.com/en-us/microsoft-365-copilot/schedule-your-most-used-copilot-prompts) deliver results into chat and expose editing and stop controls.

Personal Agent uses the local conversation for delivery and provides separate controls for one suggestion and its saved Intent.

## State and invalidation

The existing private proposal checkpoint stores Intent occurrence claims before external discovery.
Failed, expired, interrupted, superseded, and insufficient-context outcomes remain inspectable through `intent_list`.
A restart cannot replay a claimed Intent discovery or restore an old ride preview handle.
Recent occurrence history is bounded to 256 records.
Old closed occurrences contribute fixed outcome counts when that history needs space.
Per-Intent date and revision watermarks prevent clock rollback from replaying archived discovery.
Gmail routines store history cursors and evaluated message receipts in the private proposal checkpoint.
An evaluated message does not generate a second suggestion for the same routine.
At the next check after a restart, the host can restore the same pending suggestion after it verifies the message.
The host expires Gmail routine suggestions after 24 hours.
An edit, mute, or relevant Memory change invalidates older results.
A fresh observation with the same selected values refreshes the current card.
A changed or unavailable selected value removes the old suggestion from the conversation.
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

For the Weather Widget scenario, use an isolated model profile with access to a test model.
Run `electron runtime/shell/tests/proactive-panel.cjs --weather-intent-only` from the repository root on the test host.
On CM5, add `--fixture-x11` to use the test X11 session.
The scenario uses live Shanghai weather and the real Data Link, resident, composer, and recommendation card.
Record the model separately from the Weather provider.

Use `--weather-interval-routine-only` to check a new weather idea at a later interval.
The scenario uses the device clock and verifies that the next slot keeps the same suggestion.

For Gmail, run the same Electron fixture with `--gmail-routine-only`.
Set `ODK_MCP_GMAIL_CREDENTIALS_FILE` to the read-only test grant.
Set `ODK_GMAIL_ROUTINE_E2E_RELEASE` to a new file path in a private directory.
After the save receipt, send synthetic mail to the test account and apply the selected label.
Create the release file when the labeled test mail is ready.
Remove and apply the label again after the first card appears.
Create the same release path with the suffix `.reapplied`.
The fixture changes only the routine clock and uses live Gmail and the configured model.
