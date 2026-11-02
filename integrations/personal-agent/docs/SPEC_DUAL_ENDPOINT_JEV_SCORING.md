# Separate generation and Jev endpoints

## Purpose

The Personal Agent uses the Pi model runtime for dialogue, generation, and typed judgments.
An operator can send generation and Jev requests to different endpoints.
A model gateway owns upstream authentication, account selection, and failover.

For OpenCode Zen, set `ODK_JEV_PROVIDER=opencode` and `ODK_JEV_MODEL=jev-free`.
The client maps `jev-free` to the Pi model `jev-1.13-free`.
`opencode-zen` and `zen` are aliases for `opencode`.
`ODK_JEV_BASE_URL` changes the selected classifier address without changing the generation model.
The configured endpoint must implement the System One protocol used by Pi.
The gateway must provide its own routing and account management.
The selected Pi provider supplies credentials and headers to the custom address.
If authentication supplies a different address, the client rejects that configuration.
Remote custom addresses require HTTPS. Local loopback addresses can use HTTP.
This project has not established System One support for every gateway.

## Overview behavior

Overview obtains candidate facts from the current local source declarations.
The host sends anonymous source and service identifiers to the selection model.
It replaces free text with a fixed marker and groups numeric values into ranges.
The model still receives categories, state words, length ranges, and request timing.
These signals can disclose information and do not make a request anonymous.
Dialogue and other Agent requests use their own data contracts.

Jev scores displayable candidates in bounded batches.
The host applies scores when it selects and orders facts.
It permits one selected fact for each service and enforces the display budget.
After successful judgment, the host shows at most three services.
It keeps only facts within twelve score points of the highest score.
A tie prefers a measurement over an identity-only label.
Plant, weather, and holding text states the fact without repeating the source label.
The leading icon identifies the service.
When the selection model returns no items, the host keeps the most important current facts.
Local fallback uses the same three-service and twelve-point bound.
When Jev is disabled, the generation model returns finite selectors and cannot insert display text.
The host binds the selected facts to current local source templates.
The source remains responsible for the accuracy of each fact.
A score is a model output, not proof of calibration or importance.

Overview waits at most three seconds for all judgment batches.
A timeout, invalid response, rate limit, or other judgment failure selects local source facts.
A cancellation stops selection and does not publish a fallback.
Local fallback uses existing attention rules and does not call the generation model.
The production Home reports an error state and does not record a successful generation time.

## Evidence and limits

The synthetic regression tests cover source binding, data minimization, batching, cancellation, and local fallback.
Provider tests use isolated credentials and a stub transport.
The Shell rendering test uses synthetic data in four themes and three viewport sizes.
A prior synthetic request received an OpenCode Zen `jev-1.13-free` response.
That request does not establish production ranking quality, calibration, or gateway compatibility.
Device acceptance and deployment require separate authorization and checks.

See [ADR-0039](../../../runtime/shell/docs/ARCHITECTURE.md#adr-0039) for the architecture decision.
See [Agent Home scenarios](../../../runtime/shell/tests/features/agent-home.feature) for the behavior cases.
