# P1–P6 local acceptance record

Date: 2026-10-02. Scope: implement P1–P6 from the proactive Personal Bot proposal plan.
P7 Gmail and other connectors are deferred by the owner. No deployment or service
restart is included.

## Delivered contracts

| Phase | Evidence |
| --- | --- |
| P1 | [Owner rules and proposal contract](PROACTIVE_SUGGESTIONS.md), [BDD scenarios](../features/proactive-suggestions.feature) |
| P2 | Fresh Desk Data evidence and mandatory Jev relevance judgment; owner criteria and exact action guards, [owner example](proactive-owner.example.json) |
| P3 | Existing voice socket and Personal Bot panel; immediate/routine/silent delivery, quiet hours, deferred voice turns, merged nonmodal presentation |
| P4 | Exact subsequent voice or separate touch confirmation; existing tool schemas and memory gate; result feedback, durable execution reservation, no unknown retry |
| P5 | `runtime/linux/docs/USER_APPLICATIONS.md` and `DESK_DATA_SPEC.md` measurement-time publishing convention |
| P6 | Configured target/project/session tracking through existing task status/history tools; completion and verification reported separately |

## Verification

Run from the repository root unless a working directory is specified.

- `pnpm --dir integrations/personal-bot --config.verify-deps-before-run=false run test`:
  374 passed, zero failed. Includes offline real SDK, private socket, Shell client,
  actual memory tool and restart/error regressions. No provider calls or audio capture.
- `pnpm --dir integrations/personal-bot --config.verify-deps-before-run=false run typecheck`:
  passed.
- In `runtime/linux`, `node --test tests/config-inventory.test.js tests/personal-bot-shell.test.js tests/proactive-panel.test.js tests/personal-bot-client.test.js`:
  25 passed, zero failed.
- In `runtime/linux`, `node --test --test-concurrency=4 --test-timeout=30000 tests/*.test.js`:
  704 tests, 701 passed, 2 skipped, 1 unrelated failure. `repository-layout.test.js`
  expects obsolete `cm5`/`s31` git-agent scopes; the unchanged HEAD configuration uses
  `shell`/`tool`/`exp`. The default-concurrency run stalled in the existing Windows
  channel test; its standalone five tests passed and the bounded run completed.
- Runtime styles generation and `git diff --check`: passed.
- Fresh independent review: discovered restart, owner-authority and routine recovery
  defects were covered by failing regressions and repaired; final focused review
  passed with 27/27 related tests.
- CM5 Linux arm64: real Electron 43.4.1 with fixture IPC, disposable profile,
  blocked HTTP, and a dedicated temporary Xvfb display. Three themes, three sizes
  (320×480, 480×854, 1920×1280), five proposal states, focus retention,
  separate touch confirmation and literal untrusted text passed. Renderer JS,
  panel CSS, generated styles and fixture SHA-256 hashes matched the local sources.
  The fixture never loaded production main.js or connected to product sockets.
  It ran separately from orangepi user services, and its temporary device directory
  was removed after preserving the verification log.
  Direct Electron headless mode crashed on this host; isolated Xvfb succeeded.

## Remaining operational acceptance

Owner opt-in configuration, deployment, service activation/restart, live model calls,
real microphone capture, physical touch and assistive technology were not exercised.
The CM5 result is isolated renderer acceptance, not a deployed product acceptance.
See [setup and boundaries](PROACTIVE_SUGGESTIONS.md) before authorized activation.

## Authorized device deployment follow-up

The owner subsequently authorized deployment to **both Windows handheld and CM5**,
with example rules adapted to actual device readings. This section supersedes the
initial no-deployment status above; physical microphone/touch acceptance remains open.

### Final code checks

- New Windows private-file support: ACL allow entries restricted to the service user,
  SYSTEM and Administrators; unsafe existing permissions are rejected. New temporary
  files are protected while empty, before private contents are written. Fresh security
  review passed after repairing the initial write-before-protect defect.
- Final bounded local voice suite: 379 tests, 378 passed, 1 Windows-only skip,
  zero failed (`node --test --test-concurrency=4 --test-timeout=30000 tests/*.test.mjs`).
  The default-concurrency run stalled in the unchanged task-entry file; stopping only
  that task-owned child and rerunning its three tests passed. The bounded full run passed.
- Typecheck and `git diff --check` passed.
- Windows native watch/private-file suite: 26 tests, 25 passed, 1 POSIX-only skip.
  Actual ACL rejection, private atomic owner replacement and checkpoint round trip passed.
- CM5 native proactive kernel/SDK/socket/private-file checks: 32 tests, 31 passed,
  1 Windows-only skip. Tests used disposable files and offline SDK fixtures.

### Device receipts

| Host | Activation | Observed acceptance |
| --- | --- | --- |
| CM5 | `/opt/open-deskos/current` points to `releases/20261002-proactive-p1-p6`; orangepi user services restarted with `/run/user/1000` | Shell/voice active; deployed source hashes match; private owner/state files belong to uid 1000; authenticated voice status is idle with a pending weather proposal acknowledged by the Shell |
| Windows handheld | Existing interactive OdkDesk/OdkVoice tasks; voice root changed to `%LOCALAPPDATA%\open-deskos\voice-agent\releases\proactive-20261002-p1-p6\integrations\voice-agent` | Deployment hashes match; tasks running; Electron in Session 1; voice and Desk Data named pipes available; checkpoint ACL valid; pending weather proposal acknowledged by the Shell |

CM5 real DOM over the existing DevTools endpoint confirms a visible nonmodal proposal
panel, `aria-modal=false`, 44px controls and no document horizontal overflow. Windows
has no DevTools endpoint: its acknowledgement, task state and named-pipe results do
not independently prove pixel layout or physical touch behavior.

Both hosts enabled the example soil threshold, soil/weather combination and routine
weather rules using actual Hydra measurement paths. Current soil values did not meet
the thresholds; no dry-soil proposal was manufactured. The Windows coding profile
has no memory tool, so its soil advice is read-only; its coding rule uses the existing
configured Mac root. CM5 retains its personal profile and memory gate; coding rules
are not enabled there because that profile exposes no task-history tool. No profile,
credential, firewall or unrelated service was changed. No proposal action was accepted
or executed by this deployment acceptance.

### Rollback and retained artifacts

CM5 preserves the former release through `/opt/open-deskos/previous`; remove only the
new `proactive.conf` voice-service drop-in when reverting, atomically restore the former
`current` target, reload orangepi user systemd and restart the Shell/personal bot services.
The rollback receipt is retained under the candidate's `proactive-deployment/` directory.

Windows preserves the prior six Shell files, voice environment and OdkVoice task XML
in `%LOCALAPPDATA%\open-deskos\deploy-backups\proactive-20261002-p1-p6`, with a
protected rollback script. The new voice release reuses the retained previous release's
node_modules through a junction; keep that dependency release while this version runs.
No dependency installation or upgrade was performed.

Local acceptance logs remain in `/tmp/odk-*proactive*.log`. Uploads and disposable device
staging trees are removed after verification; deployed versions, owner configuration,
state and rollback artifacts are intentionally retained.

## Real device test follow-up

Date: 2026-10-02. The owner requested actual testing on both deployed hosts and
reported that the Windows handheld showed an unavailable microphone.

### Passed observations

- Both hosts: real Hydra soil and weather readings drove task-owned test rules.
  Nonurgent proposals remained hidden during quiet hours. Urgent proposals appeared
  in the real Electron window with `aria-modal=false`, 44px buttons and no horizontal
  document overflow. CDP touch events exercised Ignore and Never suggest this
  category; their private owner writes persisted. These are automated touch events
  on the actual window, not evidence of physical finger input.
- CM5: an ambiguous confirmation left the action pending. Accept alone performed
  no action; a second touch on the exact confirmation completed the existing memory
  tool and displayed `Memory updated.`. The final run wrote a private test memory
  file and verified that the production memory hash remained unchanged.
- Windows microphone: the service was in interactive Session 1 and ffmpeg found
  the Realtek microphone. PowerShell 5.1's default `Get-Content` encoding corrupted
  its Chinese name from the BOM-less UTF-8 environment file. The original launcher
  failed a native import regression. Explicit UTF-8 decoding passed that regression
  and was deployed; a three-second real DirectShow capture in Session 1 then exited
  with code 0, writing samples only to the null sink.
- Affected Shell checks: 31 tests, 30 passed, 1 Windows-only skip, zero failures
  (`node --test tests/personal-bot-launcher-windows.test.js tests/proactive-panel.test.js
  tests/personal-bot-client.test.js tests/personal-bot-shell.test.js`, from
  `runtime/linux`). The checked-in PowerShell fixture also passed on Windows 5.1.

### Test isolation and restoration

The first CM5 memory test exposed an operational isolation error: a service
`EnvironmentFile` overrode the test profile's `Environment` setting. One named
test entry reached production memory. It was removed and the exact original
SHA-256 was restored before repeating with an explicit test environment file.
The final private memory test passed. Production owner configuration hashes matched
and the test drop-in was removed; the service returned idle with its original
weather proposal.

Windows temporary owner rules used a private directory. The original environment
and checkpoint bytes were restored, its original weather proposal returned, and
OdkDesk/OdkVoice were running. The temporary loopback DevTools listener on 9223 was
closed after restoring the original OdkDesk action. The UTF-8 launcher fix remains
deployed; its prior copy is retained as `windows-personal-bot-pre-utf8.ps1` in the protected
deployment backup directory.

### Still unverified

- A complete human speech -> microphone -> transcription -> model answer retry
  after the Windows fix is pending owner input. The initial attempt had peak 0,
  no transcript, and ended in error; successful raw capture is not a full voice pass.
- Windows two-step action confirmation was not exercised in this device run.
- P6 real completion notification remains blocked: SSH to the configured Mac host
  and its executable work, but the existing session-control socket does not answer
  the read-only list request. No Mac service was started or unrelated session stopped.

Logs and clipped real-window screenshots remain locally under `/tmp/odk-live-*`.
No new commit or P7 connector was created.

## Suggestion query repair

The owner's real Windows retry completed recording, transcription and answer output:
peak 0.00746, eight-character suggestion question, idle terminal state. However,
the answer described capabilities and old tasks. The saved turn showed a direct
`personal_bot_proposals` model tool call even though that capability is codemode-only.

Direct suggestion questions now use a host answer hook, refresh actual proposal
state and return pending owner advice with values and measurement times. Other
requests retain the ordinary model route. Empty, disabled and unavailable states
are distinct. The host path cannot accept an action; action confirmation remains
the existing subsequent-turn/touch flow. The example weather advice now gives
concrete departure preparation steps instead of asking to look at the instrument.
Only unchanged factory weather text was replaced on the devices; owner suppression,
snooze and routine-day configuration were preserved and private backups retained.

### Checks and review

- Suggestion/kernel/real SDK integration checks: 33 passed.
- All voice test files except the unchanged task-entry file: 382 tests, 381 passed,
  one Windows-only skip. Task-entry passed separately: three tests. Combined runs
  first failed its list response assertion and later stalled with a temporary-folder
  cleanup error; only the task-owned child and its daemon were stopped.
- Typecheck and `git diff --check`: passed.
- Independent concurrency/security review: no blocking findings; an additional
  close-during-refresh probe rejected correctly. The optional Code Terrier scan
  ended with `multi-model fan-out: all 1 reviewer(s) failed`; it supplied no code
  findings and is not a passed review.

### Updated device receipts

- CM5 current release: `/opt/open-deskos/releases/20261002-proactive-query-v1`.
  Former P1-P6 release retained; `query-deployment/rollback.json` records its path
  and `patch.hashes` validates the four updated/new voice files.
- Windows voice root: `%LOCALAPPDATA%\open-deskos\voice-agent\releases\proactive-20261002-query-v1\integrations\voice-agent`.
  The existing OdkVoice task points there; OdkDesk/OdkVoice are running. Task XML
  and hashes are backed up under `deploy-backups\proactive-20261002-query-v1`.
  Its dependency junction uses the previous voice release; retain both dependency
  releases. The microphone UTF-8 fix remains active.
- Both live deployed agents were queried through their actual agent entry with
  production owner configuration, authenticated Desk Data and a disposable session
  state directory. Windows returned current weather advice with 18°C and measurement
  time `2026-10-02T12:21:01.256Z`; CM5 returned the same advice with 26°C and
  `2026-10-02T12:24:51.674Z`. No action ran or production session history was edited.
  These read-only query probes are distinct from physical speech acceptance.

### Programmatic production service and interface acceptance

At the owner's request, both hosts were tested without another human speech retry.
For each of `最近有什么建议` and `有什么建议吗`, a temporary loopback Node
Inspector invoked the actual running PersonalBotService at the transcription-text
boundary, using its production agent and continued session. The authenticated
voice socket/pipe and actual Electron DOM both showed the same final answer.

- Windows: current owner advice, 18°C, measured at
  `2026-10-02T12:33:11.604Z`; both queries passed.
- CM5: current owner advice, 26°C, measured at
  `2026-10-02T12:34:51.674Z`; both queries passed.
- Both interfaces showed the question and concrete departure advice, were idle,
  and had no horizontal document overflow. Completed-action IDs stayed unchanged.
  Clipped screenshots were downloaded and visually inspected.
- This exercises the real response, private status channel and renderer. It does
  not recapture microphone audio or rerun speech recognition. The owner's earlier
  successful recording/transcription is separate evidence.

Local receipts: `/tmp/odk-programmatic-live-ui-retry.log`,
`/tmp/odk-programmatic-cm5-ui.log`, `/tmp/odk-suggestion-win-real-ui.png`, and
`/tmp/odk-suggestion-cm5-real-ui.png`. Temporary debugger listeners and Windows task
action overrides were removed after testing; the deployed repair remains active.

## Automatic reading advice delivery

The owner clarified that advice based on these readings must arrive proactively.
The previously installed example had combined soil/weather delivery set to silent,
and weather delivery set to once daily after 08:30; earlier test presentation had
already consumed that day's weather delivery. This was a delivery-policy mismatch,
not evidence that a successful suggestion query proved background delivery.

The example and both private device owner configurations now set these two rules
to immediate delivery. Their conditions, reviewed advice, quiet hours, suppression,
snooze/cooldown, action parameters and existing routine-day history are preserved.
Each original private owner file is backed up beside it as
`owner-before-auto-20261002.json`. No voice runtime source or action capability was
changed for this adjustment.

- New background-start regression failed against the previous example, then passed
  with the corrected defaults. Focused watch/answer/SDK tests: 34 passed. Typecheck
  and `git diff --check` passed.
- CM5 isolated fixture: 22 watch tests passed using `--test-isolation=none`.
  The default runner initially could not spawn its child Node process (`EACCES`);
  the in-process runner required no production services or data.
- Production automatic startup polling on both devices activated the actual
  nonmodal panel without a question, MIC click, injected transcript or inspector
  invocation. Authenticated status had an empty transcript. Windows displayed 18°C
  at `2026-10-02T12:48:33.222Z`; CM5 displayed 26°C at
  `2026-10-02T12:44:51.674Z`, with matching advice and measurement times in the DOM.
- After 65 seconds, each still had exactly one pending weather proposal with the
  same ID and no repeated popup. No completed action appeared. Real screenshots
  were inspected; neither document had horizontal overflow.
- Combined soil/weather automatic delivery is covered by deterministic matching
  fixtures. Current device readings did not match that combination, so no live
  combined-condition trigger is claimed.

Receipts: `/tmp/odk-auto-win.log`, `/tmp/odk-auto-cm5.log`,
`/tmp/odk-auto-cm5-fixture.log`, `/tmp/odk-auto-win.png`, `/tmp/odk-auto-cm5.png`.
Windows temporary Shell debugging was restored after testing; pending advice is
deduplicated rather than intentionally reoffered by restarting the Shell.

## Mandatory Jev heartbeat and service push judgment

The owner subsequently required Jev to decide whether advice is useful now, with
exactly two inference origins: periodic heartbeat and trusted service push. This
section supersedes the earlier threshold-only trigger and generic weather delivery
observations. Numeric owner conditions now describe relevance criteria sent to Jev;
code still checks exact conditions before executing an owner-configured action.
There is no threshold-only fallback when Jev is unavailable.

### Verification and review

- Focused voice/socket/service checks: 68 tests, 67 passed, one Windows-only skip.
- Final bounded full voice suite: 398 tests, 397 passed, one Windows-only skip,
  zero failed (`node --test --test-concurrency=4 --test-timeout=30000 tests/*.test.mjs`).
- Affected Shell source/client checks: 92 passed, zero failed.
- Typecheck and `git diff --check` passed.
- Independent review found trigger payload injection, dropped push batches,
  unrelated-rule reevaluation, consumed superseded coding completions and incorrect
  clearing of failed judgments. Failing regressions were added and repaired; the
  final independent focused review passed 12 tests with no new material findings.
- Both hosts ran the same isolated watch/Jev adapter/private-file suite: 37 tests,
  36 passed, one platform-specific skip, zero failed per host. CM5 used
  `--test-isolation=none`; disposable fixtures did not connect to production data,
  capture audio or execute actions.
- Real API calls using each host's protected credential and candidate adapter
  returned `jev-1.13.0`. These calls used explicitly synthetic dry soil, normal soil
  and ordinary weather observations. Heartbeat/push probabilities respectively:
  CM5 dry 0.86/0.90, normal 0.16/0.12, weather 0.09/0.08; Windows dry 0.84/0.91,
  normal 0.16/0.12, weather 0.09/0.09. These limited cases verify actual API use and
  selection, not physical dry-soil events or calibrated accuracy. The default 0.8
  threshold remains an initial operating choice.

### Current production receipts

Both deployed source manifests matched all 13 changed files after activation.

| Host | Active deployment | Actual Jev observations |
| --- | --- | --- |
| CM5 | `/opt/open-deskos/releases/20261002-proactive-jev-v1`; orangepi Shell and personal bot services active | Natural weather push at `2026-10-02T13:28:35.309Z`, natural soil push at `13:28:48.703Z`, heartbeat at `13:29:34.649Z`; returned `jev-1.13.0`, probabilities 0.07–0.14 below 0.8 |
| Windows handheld | `voice-agent/releases/proactive-20261002-jev-v1/integrations/voice-agent`; OdkDesk/OdkVoice running, voice Node in Session 1 | Heartbeat at `2026-10-02T13:30:04.613Z`; authenticated programmatic weather-source hint at `13:30:26.445Z` reread actual readings and returned `jev-1.13.0`, probabilities 0.07–0.18 below 0.8 |

The Windows push probe sent only a selected source ID, not fabricated facts or
advice; it proves the production authenticated ingress, not a naturally timed
external weather update. CM5 production DOM confirmed the panel was hidden,
`proactive=false`, with no document horizontal overflow. Both authenticated status
channels were idle, had no proposal error and no pending weather suggestion. Old
threshold-only pending suggestions expired on migration. Ordinary weather was
therefore correctly not reoffered as an unconditional departure recommendation.
No proposal action or microphone capture ran during these checks.

Jev uses a separate protected key file on each host. CM5 adds the private
`30-jev.conf` user-service drop-in. Windows uses a retained launch wrapper under
`deploy-backups/proactive-20261002-jev-v1/windows-personal-bot-jev.ps1`; its missing default
runtime and Node arguments initially caused task exit 1 and were corrected before
the successful receipts above. The existing Windows environment file failed the
strict private ACL check and was left unchanged; the new key does not depend on
changing that file. Keep the wrapper while its task action references it.

CM5 rollback: restore `20261002-proactive-query-v1`, remove only `30-jev.conf`,
reload orangepi user systemd and restart Shell/voice. Windows rollback: restore
the seven Shell source backups and original OdkVoice task XML from
`deploy-backups/proactive-20261002-jev-v1`, then restart the two interactive tasks.
Retain prior dependency releases used by the Windows junction.

External coding daemons may publish `pi-tasks.<target>` through the same private
protocol; their emitter and a real completion push remain unverified. Tool launch
receipts track working sessions without creating a third inference origin. The
previous P6 real-daemon acceptance limitation remains open.

Local receipts: `/tmp/odk-jev-final-voice-tests.log`,
`/tmp/odk-jev-all-personal-bot.log`,
`/tmp/odk-jev-shell-tests.log`, `/tmp/odk-jev-cm5-native.log`,
`/tmp/odk-jev-win-native.log`, `/tmp/odk-jev-cm5-api.log`,
`/tmp/odk-jev-win-api.log`, `/tmp/odk-jev-cm5-production.log`, and
`/tmp/odk-jev-win-production.log`.

## Device E2E: real Jev, private channel and Electron

The owner requested E2E testing after deployment. On 2026-10-02, both native hosts
ran [the explicit opt-in E2E harness](../../../runtime/linux/tests/proactive-jev-e2e.cjs).
It used deployed source modules, the actual Jev API and actual Electron renderer,
with independent Hydra observations, voice socket/pipe, random channel token on
Windows, owner writes, private checkpoint and disposable Chromium profile. The
renderer's external HTTP was blocked; only the main-process Jev adapter called the
provider. No production main.js, microphone capture or action executor was invoked.

| Scenario | CM5 | Windows handheld |
| --- | --- | --- |
| Normal soil 60%: real heartbeat declines, panel hidden | 0.08, passed | 0.08, passed |
| Dry soil 5%: next actual periodic timer creates and displays advice | 0.89, passed | 0.89, passed |
| Another heartbeat refreshes the same pending proposal without another popup | 0.84; one popup, passed | 0.85; one popup, passed |
| Four accepted Hydra messages coalesce through Shell client and private channel to one push judgment and visible evidence | 0.92, passed | 0.92, passed |
| Renderer acknowledgement and UI Ignore cross IPC and persist to private checkpoint and isolated cooldown | Passed | Passed |
| Controlled adapter transport failure crosses the status channel, with no proposal or popup and no threshold fallback | Passed | Passed |

All real API decisions returned `jev-1.13.0`; threshold 0.8. The real DOM showed
the configured plant advice, soil 5%, live measurement time, nonmodal
`aria-modal=false`, 44px controls and no document horizontal overflow. No question,
MIC click or injected transcript was needed to activate either positive scenario.
The positive readings are synthetic isolated fixtures, not observations of a
physically dry plant. The failure case is a controlled transport fault, not an
observed provider outage.

CM5 ran hidden Electron on a dedicated temporary Xvfb display, with isolated XDG
directories and no product D-Bus session. Xvfb was downloaded/extracted into the
fixture, not installed as a system package. Windows ran a temporary interactive
scheduled task in Session 1. Its first attempt passed business assertions but
failed profile deletion with EPERM because Chromium still held the profile. The
external [Windows runner](../../../runtime/linux/tests/proactive-jev-e2e.ps1)
now waits for Electron to exit before deleting the exact fixture profile. The
final native rerun exited zero and recorded `cleanupComplete=true`.

### Production observations and restoration

Separate production probes read authoritative Desk Data: both hosts had live soil
55.3%/59.5%; CM5 live temperature 26°C and Windows live temperature 25°C. Actual
heartbeat/source-push receipts remained below the relevance threshold. Real DOM
inspection on both hosts confirmed the panel stayed hidden before and after a
programmatic source-ID hint, with idle voice state, no proposal error, no pending
suggestion and no horizontal overflow. These probes did not inject fixture values
into product channels or execute proposal actions. At this observation time the
owner's quiet hours were also active; the isolated positive tests deliberately had
no quiet-hours policy so they tested delivery itself.

Windows temporarily exposed Shell CDP only on loopback 9223 for the production
DOM probe. The original OdkDesk task arguments were restored and the temporary
debug task override was removed. OdkDesk/OdkVoice remained running. CM5 used its
existing production CDP port 9222 without restarting product services. The two
new test files are acceptance tools; no runtime implementation or deployment
version was changed by this testing turn.

Local evidence: `/tmp/odk-jev-e2e-cm5-final.log`,
`/tmp/odk-jev-e2e-cm5-final-receipt.json`,
`/tmp/odk-jev-e2e-win-final-receipt.json`,
`/tmp/odk-jev-e2e-cm5-production-final.log`,
`/tmp/odk-jev-e2e-win-production.log`,
`/tmp/odk-jev-e2e-cm5-readings.log`, and
`/tmp/odk-jev-e2e-win-readings.log`. Native logs are retained locally before removal
of the task-owned device staging trees and temporary Windows test task. Physical
touch, microphone/ASR and external coding-daemon completion pushes were not part
of this E2E run.

For another explicitly authorized device run, pass `--live-jev-e2e`,
`--runtime-root`, `--personal-bot-root`, `--jev-key` and `--receipt` to Electron running
`runtime/linux/tests/proactive-jev-e2e.cjs`. On Windows, invoke its `.ps1` runner
with `-RuntimeRoot`, `-PersonalBotRoot`, `-JevKey` and `-Receipt` from an isolated
interactive scheduled task. It refuses Session 0. On CM5, use an isolated Xvfb
display and XDG directories as above, not the product desktop display.


## Generated candidates and Jev selection — 2026-10-02

Current contract: version 2 owner goals, isolated configured generation model,
multiple evidence-cited candidates, then Jev usefulness and factual-support judgments.
Both scores must meet 0.8; at most three qualifying suggestions are selected per
batch. The tests did not lower thresholds to obtain acceptance.

Local RED/GREEN evidence covers owner schema, multiple/zero candidates, invalid
references, grounding rejection, superseded inference, stable keys, duplicate advice,
private audit output and preserved host citation IDs. Final voice suite: 411 tests,
410 passed, one existing skip; typecheck passed. A fresh independent review found no
blocking findings after citation and audit fixes.

Actual device E2E used arbitrary declared package sources `example.parcels` and
`example.ci` with synthetic fixture facts. Both hosts used their real configured
generation model and the live Typesafe `jev-1.13.0`, authenticated private voice
transport, real preload and Electron renderer. No microphone, transcript, action
execution or production reading writes occurred. Normal source values generated
zero suggestions. Positive fixture values generated two candidates:

| Host | Generation model | Heartbeat selected | Service push selected |
| --- | --- | --- | --- |
| CM5 | opencode-go/muse-spark-1.3-contributor | 1 of 2 | 1 of 2 |
| Windows handheld | cli-proxy/bailian/qwen3.8-flash | 2 of 2 | 2 of 2 |

Both paths verified visible nonmodal DOM, original source/time evidence, no horizontal
overflow, 44px controls and persisted Ignore. First runs failed: grounding references
lost their host IDs, and initial grounding wording conflated factual support with
source verification. Citation IDs now remain attached, and grounding checks claims
against the supplied observations while relevance and action authorization remain
separate. Invalid generation JSON and provider failures were also observed in live
probes and failed closed. Passing reruns are not a reliability or calibration claim.

Receipts retained locally: `/tmp/odk-generation-cm5-receipt.json`,
`/tmp/odk-generation-win-receipt.json`; the first-attempt CM5 receipt and local failure logs
preserve the unsuccessful run. CM5 used isolated Xvfb :199 and independent XDG
paths; Windows used an isolated interactive scheduled task and removed the Chromium
profile after Electron exited.

Both production hosts were activated under the user's existing deployment
permission. CM5 current release is `20261002-proactive-generation-v1`; Windows
OdkVoice uses `proactive-20261002-generation-v1` and retains its protected Jev
launcher. Version 1 private owner files were backed up before migration to version 2;
existing goals, delivery, quiet hours, suppression, snooze and exact coding scope were
preserved. New generated proposals are read-only. Old compatible processed history
remains; incompatible pending version 1 proposals expire. No credential is stored
in this document. Production observations must be reported separately from fixtures.

To repeat an explicitly authorized run use `--generated-e2e` and repeated
`--env-file` options in addition to the live Jev harness arguments above. The Windows
runner exposes `-GeneratedE2E` and `-EnvFile`; environment files are read without
printing credential values. Do not use the product desktop display for isolated CM5
acceptance. Physical microphone/touch and an actual external coding-daemon completion
push were not exercised by this generation E2E.

Production verification after activation: both authenticated voice status probes
returned idle, no proposal error, zero pending suggestions and no popup after a
source-ID-only weather refresh. CM5 production CDP showed the panel hidden and no
horizontal overflow. Both active models logged zero-candidate generation for normal
actual observations; no synthetic fixture readings were sent to production. Evidence:
`/tmp/odk-generation-cm5-production.log`, `/tmp/odk-generation-win-production.log`.
The temporary Windows task, device staging trees and CM5 isolated display were
removed after receipts were copied locally; active releases, credential files and
rollback owner/task backups were retained.


## Windows actual Widget data — 2026-10-02 22:56–23:03 CST

This run read the handheld's live authenticated Desk Data channel; no fixture source
values were published. The renderer/private voice endpoint, owner suppression writes,
and checkpoints were isolated in a temporary interactive Electron task. This establishes
actual-data model/transport/rendering behavior, not a popup on the product desktop.

Two scopes were tested:

- The unchanged production owner configuration: live plant and temperature fields,
  real configured generation model, one heartbeat and one source-ID-only push.
  Both produced zero candidates; Jev was consequently not called. The panel stayed
  hidden with no overflow or action execution.
- An in-memory test configuration expanded existing weather fields to condition/high/
  low, added greenhouse/second-plant observations, reading title/highlight and all
  twelve current Futu positions (symbol, price, day change and day profit/loss).
  It preserved the owner's quiet hours and did not save changes to the production
  owner file. Metadata inventory also identified Pi sessions, quota and package catalog;
  those application/catalog readings were not added as Widget suggestion topics.

The expanded first attempt failed during generation. In the second attempt, heartbeat
created three candidates and Jev accepted one, while source-push generation aborted at
30,026ms before judgment. These are retained failures, not successful E2E evidence.

The third expanded attempt completed heartbeat and push using real
`cli-proxy/bailian/qwen3.8-flash` and `jev-1.13.0`. Heartbeat generated three candidates;
all failed at least one 0.8 threshold. Push generated two candidates, both passed
Jev's thresholds. Quiet hours kept the automatic panel hidden; an explicit private
`proposal_list` request showed two nonmodal rows with original source values/times,
44px controls and no horizontal overflow. No actions or microphone captures occurred.
The pipeline harness returned pass, but overall content acceptance remains failed:

1. One generated candidate asserted an instrument leverage multiple that was absent
   from all supplied Widget observations. Jev assigned factual support 0.96 and accepted
   it. This is direct evidence that the current judgment prompt/threshold can admit
   unsupported instrument attributes; a high score does not prove grounding correctness.
2. Actual larger inputs exposed the existing 30-second generation timeout. Successful
   later attempts do not establish stable latency or reliable refresh behavior.
3. Current production owner selections omit weather condition and Futu. Expanded test
   behavior therefore does not imply these sources are enabled in production.

Private local receipts: `/tmp/odk-win-actual-widget-receipt.json` (original owner),
`/tmp/odk-win-expanded-first-receipt.json`,
`/tmp/odk-win-expanded-second-receipt.json`, and
`/tmp/odk-win-expanded-final-receipt.json`. These contain private actual data, remain
outside the checkout, and must not be committed or published. The test harness is
`/tmp/odk-win-actual-widget-e2e.cjs`; the local final stdout is retained separately.
This test changed no production runtime implementation, owner goals or deployment.


## 2026-10-03 Personal Bot migration and repair acceptance

The dated sections above preserve historical deployment names. The current product
is Personal Bot; audio recording/transcription remain capabilities. Active source,
package, renderer/IPC, tools, environment, endpoints, launchers, service names and
documentation use Personal Bot. Legacy names exist only for upgrade inputs and
historical/rollback paths. Upgrade preserves sessions and proposal checkpoints,
refuses unsafe state trees and migrates Windows ACLs before starting the Limited
interactive task.

Current activation: CM5 `/opt/open-deskos/releases/20261003-personal-bot-v3`,
`open-deskos-personal-bot.service`; Windows
`%LOCALAPPDATA%\open-deskos\personal-bot-releases\20261003-v3\integrations\personal-bot`,
`OdkPersonalBot`. Windows state is the separate `personal-bot` directory. Both
legacy voice services are disabled; Shell remains running.

Repairs include bounded generation with one format repair, closed-world Jev support
plus unsupported-assertion checks, and per-source revisions so unrelated pushes
do not cancel a holdings generation. Real Windows regression rejected an unstated
leverage attribute (support 0.04) and accepted observed-price evidence (0.84).

Local verification: Personal Bot 423 passed / 1 skipped; Shell 709 passed / 3 skipped;
Personal Bot typecheck and `git diff --check` passed. Fresh independent review
accepted migration, concurrent source guards and private receipt writing. The
receipt helper also rejects symlinks/hardlinks and writes only after permission
checks, using its verified file descriptor; no actual-data screenshot is produced.

Initial post-migration Windows actual-Widget E2E passed: heartbeat produced zero
candidates; service push generated five, Jev selected two holdings suggestions
(usefulness 0.85/0.80, support 0.82/0.86). Both rows displayed actual source values
and measurement times, had no horizontal overflow, and acknowledged explicit view.
Execution count was zero. CM5 actual-data generation passed with no candidates;
Futu was syncing and excluded, so this did not prove CM5 holdings judgment.
Final checked-in-harness repetition passed on both activated v3 hosts:
Windows heartbeat/push each generated four candidates, Jev completed both batches
and selected zero; CM5 completed two rounds with no candidates. Both reported
zero executions and zero production data writes. Receipts are
`/tmp/odk-personal-win-final-receipt.json` and
`/tmp/odk-personal-cm5-final-receipt.json` (private, not for publication).

CM5 isolated baseline: focused tests, styles, smoke, Widget application styles,
default density and proactive panel all passed. Proactive panel covered three
themes, three sizes and five proposal states, focus, confirmation and literal
untrusted text. Full Shell E2E ran to completion: driver, motion, geometry sweep,
interiors, sequential composition, Hydra and all five theme interaction suites
passed. Pixel-theme Pi Sessions density remains a pre-existing failure at
1920x1280, 1920x1080 and 480x854 (fill 13.9%, 17.3%, 14.9% versus 19% floor).
The Pi renderer is unchanged from the preceding release; no threshold was relaxed.
Therefore the broad Shell gate is not fully green, although Personal Bot flows
and migration checks passed. Physical microphone and manual foreground Windows interaction
were not exercised. Private raw receipts remain outside the checkout.
