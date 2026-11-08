# Live Personal Agent acceptance

This runner checks real-model behavior against synthetic reports and a local MCP server.
It does not establish production behavior or physical device acceptance.
The [implementation status](PERSONAL_AGENT_IMPLEMENTATION.md) owns the current verification state.

## Inspect the plan

Run this command from `integrations/personal-agent`.

```sh
pnpm test:agent:live --plan
```

Plan inspection makes no external requests.
It does not read provider credentials or require Docker.

## Select the evaluation layer

Daily checks use affected offline tests and, when necessary, one authorized targeted live scenario.
A deterministic service fix does not require a complete model evaluation.
Deployment acceptance uses the delivery core.

The default `core` mode covers six scenarios:

1. Install a staged Skill through a natural-language request.
2. Install a staged MCP connector through a natural-language request.
3. Create a saved identity with a name, role, and built-in avatar.
4. Execute a saved report and check its result and completion.
5. Restart the resident and check the saved identity, current result, completion, and a new full-entry experience read.
6. Execute a separate temporary child and check its result and completion.

The report connector does not create automatic experience.
The runner adds a known synthetic experience entry before the restart.
The report identifies that entry as a host fixture.
The read after restart proves retrieval of that fixture.
Child acceptance binds the task handle, turn, identity, and identity revision before grading.
Saved-child activity must carry the expected avatar metadata.
Rendered avatar acceptance remains separate.

Targeted mode supports two fixed scenarios:

- `saved-report` prepares packages and an identity through host APIs, then checks one saved child's execution and completion.
- `provider-health` checks one fixed tool-free model response and one fixed synthetic Jev typed choice.

Targeted setup records `naturalLanguageVerified: false`.
The compatibility flag `--task-evaluation` selects targeted `saved-report`.

## Limits and isolation

The default per-run limit is 80 shared generation and Jev requests, including format corrections.
Use `--max-requests=N` to select an explicit allowance from 1 to 256 shared requests.
The operator must also retain any authorized aggregate limit across attempts.
The transport counts HTTP requests before dispatch.
It refuses redirects and disables SDK request retries.
By default, each generation request permits at most 2048 output tokens.
Use `--max-output-tokens=N` to select an explicit limit from 1 to 16384 tokens.
The configured model can reduce this limit.
The limit includes reasoning tokens.
The transport checks the final HTTP payload and refuses larger sampling overrides before dispatch.
Plugin validation uses a 90000-millisecond timeout by default.
The runner validates `ODK_AGENT_PLUGIN_TIMEOUT_MS` and passes it through the private envelope.
Valid values range from 1000 to 180000 milliseconds.
The report records the effective value in `limits.pluginTimeoutMs`.
The default run deadline is 15 minutes.
Use `--deadline-ms=N` to select an explicit deadline from 1 to 1800000 milliseconds (30 minutes).
This option does not change request, output, or plugin timeout limits.
Scenarios, validators, and scoring remain unchanged.
Budget exhaustion stops dependent stages without retry.
The limit counts requests; it is not a monetary cost limit.

The runner uses a read-only candidate mount and private temporary state inside Docker.
Only the new evidence directory is writable on the host.
MCP executes the local synthetic report server.
The run creates no production task, deployment, service, order, or capture.

The runner uses the configured custom model and an explicit Jev credential.
The SDK supplies missing model defaults without a credential lookup or network refresh.
The report identifies explicitly configured prices with `pricingKnown`.
Default zero prices do not prove free service.
The report retains `actualCharge: not_established`; token counts do not establish actual charges.
Supported model APIs are `openai-responses`, `openai-completions`, and `anthropic-messages`.
It refuses unsupported model configuration instead of selecting another provider.
Credentials enter the container through standard input.
Credentials and provider responses do not enter host logs or evidence.
The report retains request counts, token counts, stage outcomes, scores, and source fingerprints.
It retains reported reasoning counts and counts generation calls that reach the output limit.
Missing reasoning counts remain unknown.
Plugin diagnostics retain bounded statuses, receipt-match facts, and counts without generated explanations or receipt text.
Fixed host validation categories identify rejected structure, scope, citations, and lesson text.
Report grading identifies missing, multiple, invalid, or valid result markers without retaining answer text.
Tool diagnostics retain fixed capability identities and failure categories without source, arguments, or error text.
The controller compares source fingerprints before and after the run.
A changed source sample prevents a passed result.
Container results remain provisional until the host completes source validation.
Source validation failure preserves a failed result.
Dependency bytes remain outside those source samples.

## Run after authorization

This command makes external model calls and can incur charges.
Use a new private output directory.

```sh
pnpm test:agent:live --live --output=/absolute/new/evidence-directory
```

The command requires Docker and `TYPESAFE_API_KEY`.
The selected custom model must exist in the current Pi agent configuration.
The evidence directory contains `report.json`.
A failed run preserves partial counts and outcomes.
It does not retry a failed task automatically.

Use `--max-requests=N` and `--deadline-ms=N` to retain the remaining authorization budget after a failed attempt.
Explicit options must satisfy per-attempt limits and the remaining aggregate authorization.
Start each full attempt from the beginning.
Do not combine partial results from failed full attempts.
Include consumed requests and active execution time from all earlier attempts.
An unlimited aggregate authorization does not remove the runner's per-attempt safeguards.

Select a targeted scenario explicitly:

```sh
pnpm test:agent:live --live --mode=targeted --scenario=saved-report --output=/absolute/new/task-evidence
pnpm test:agent:live --live --mode=targeted --scenario=provider-health --max-requests=2 --deadline-ms=30000 --max-output-tokens=16384 --output=/absolute/new/health-evidence
```

The health command permits two requests within 30 seconds.
Its output allowance accommodates reasoning without changing the global defaults.
A health deadline or request limit is a resource failure, not external blockage.
Completed probe metadata remains in the failed report.

Live core mode needs a container image with the locked Mem0 environment.
Set `ODK_AGENT_LIVE_IMAGE` to that image.
Set `ODK_AGENT_LIVE_MEM0_PYTHON` to the Python executable inside the image.
Set `ODK_PERSONAL_AGENT_MEM0_CONFIG` to a private test configuration.
Select an isolated test vector store and approved model endpoints.

## Stop after a failure

The runner never retries an SDK request, a complete turn, or a mutation automatically.
It records `stopPolicy`, the failed operation, its provider kind, and a bounded failure category.
A single failure has `externalBlocked: false`.
An unknown error or one rejected response does not prove persistent external blockage.

For each provider and operation, the operator can authorize one fixed health check and one explicit targeted retry.
Retry eligibility requires an explicit temporary condition: HTTP 429, 502, 503, 504, or a recognized temporary transport error.
Do not retry HTTP 451 automatically.
Do not replay a mutation to test availability.
Configuration, permission, authorization, resource, evidence, and quality failures are not external blockage.
A resource failure requires a separately authorized limit or smaller scope; it does not justify a hidden retry.

Record the original failure, health report, explicit retry report, and their hashes in private operation evidence.
Use `external_blocked` only when this bounded sequence establishes a persistent temporary external failure.
Keep provider kinds and operations separate.
A successful Jev probe cannot clear a failed model probe.
A fresh HTTP 200 proves only that probe's availability; it does not rewrite an earlier failure.
Do not restart the full workflow automatically or combine partial runs into a passed result.

Use `--host-relay` when Docker cannot reach a configured HTTP provider that the host can reach.
The container must resolve `host.docker.internal` to the host.
The temporary relay binds only to `127.0.0.1` and requires a random per-run key.
It forwards authenticated POST requests only to the configured provider path.
It preserves the provider authority and strips its private access key before forwarding.
The key remains in memory and enters the container through standard input.
The controller closes relay connections after the attempt.
HTTPS providers use the direct path.

## Interpret evidence

`realModel` and `realJev` identify actual inference.
These flags come from recorded requests, not the requested test mode.
`functionalPassed` refers only to the selected coverage.
`deliveryCorePassed` and `targetedPassed` identify the accepted layer after host source validation.
These fields remain false while host validation is pending or fails.
`offlineFixture: true` identifies the runner's scripted contract test.
The [memory evaluation](MEMORY_EVALUATION.md) records recall and answer quality on public data.

Run the zero-call contract checks with this command.

```sh
node --test tests/agent-live-contract.test.mjs tests/agent-live-provider-bound.test.mjs tests/agent-live-relay.test.mjs tests/agent-live-plugin-evidence.test.mjs
```
