# Intent routing deployment and device acceptance — 2026-10-03

The owner authorized deployment and actual E2E testing of the generic intent/tool
boundary fix. Scope is the Personal Bot runtime on CM5 and the Windows handheld;
the unrelated working-tree Shell rename and broader audit changes are not part
of this deployment. No order, application installation, or Pi task mutation was
performed.

## Release identity and recovery

- Candidate: `20261003-personal-bot-v4` (Windows directory `20261003-v4`).
- Both hosts validated SHA-256 for all 47 shipped runtime/package files against
  the developer snapshot. Existing dependency declarations matched, so installed
  host dependencies were reused without an upgrade.
- CM5 cloned the previous release and switched `/opt/open-deskos/current`.
  Windows registered the existing interactive `OdkPersonalBot` task against a
  new code root and retained its previous XML/action for rollback.
- Previous code releases, state, credentials and host-local configuration were
  preserved. The Windows dependency junction still depends on the previous
  release's `node_modules`; that directory must be retained.

## Acceptance contract

Given a running deployed Shell and Personal Bot, when an automated renderer MIC
intent starts a recording of a known question, then the real transcription
provider must transcribe that question, mandatory Jev must select its intent, the
configured conversation model must query actual host channels, and the final
answer must reach the visible Shell panel. Queries cover plant readings, weather,
and installed user applications. Assertions compare the transcript and rendered
answer to service state, check viewport containment/overflow, and preserve
before/after source observations and screenshots. Session traces distinguish
successful direct calls from successful Code Mode execution.

## Observed results and limitations

- CM5 controlled PCM input: all three cases passed through the installed service,
  real device-local STT, real Jev, real configured conversation model, actual
  Desk Data/application channels, and the running Shell renderer. Real Code Mode
  execution fetched readings and application inventory. The physical microphone
  configuration was restored afterward; both services are active on v4.
- Windows controlled PCM input initially completed all three queries and displayed
  their results. Successful direct `desk_data`, `user_apps_list`, and
  `user_apps_desktop` calls are present in the production session trace, replacing
  the previous `Tool desk_data not found` result. A temporary disconnect occurred
  during the weather case; a stricter rerun reproduced disconnection during a
  plant query. Stable Windows acceptance remains under investigation.
- Physical speaker-to-microphone playback failed to transcribe the expected
  question on both devices. This is not physical voice acceptance. Controlled
  PCM substitutes only capture input; neither STT, Jev, conversation inference,
  service protocol, data backends, nor renderer responses are fixture answers.
- These checks establish data retrieval and delivery, not universal factual
  correctness of model commentary. Plant health conclusions and historical
  comparisons require their own evidence; raw sensor values alone are not a
  validated health assessment. Physical touch/gamepad operation, owner speech,
  order lifecycle, app creation/installation, and Pi continuation were not tested.

Local verification preceding deployment: 452 passed, one Windows ACL check
skipped on macOS (453 total); typecheck and independent boundary review passed.
The final 33-case synthetic real-Jev routing run passed. Those are separate from
device acceptance and do not eliminate the limitations above.
