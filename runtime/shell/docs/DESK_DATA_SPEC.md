# Desk Data contract

The Shell owns one registry. The screen and Personal Bot read the same source. [ADR-0033](ARCHITECTURE.md#adr-0033) records the decision and rejected alternatives. [desk-data.feature](../tests/features/desk-data.feature) owns executable scenarios.

## Registration and reading

An entry has an ID, label, owner kind and read function. Kinds are `tile`, `app`, `page`, `service`, `package` and `catalog`. Register an existing source; do not copy its readings into another cache.

| Owner | Reading ID |
| --- | --- |
| Built-in source | Its plugin ID, such as `odk.tile.hydra`, `odk.tile.weather`, `odk.tile.weread`, `odk.app.pi-sessions` or `odk.page.quota` |
| Service Plugin | Its declared service ID, such as `futu-poller` |
| Installed package | Its package ID |
| Installed catalog | `odk.plugins.installed` |

The Futu tile and poller share one service reading. The tile IPC handler and registry call the same source object. A read can perform I/O under that source's refresh policy. It cannot force a refresh. Weather keeps its ten-minute interval and in-flight deduplication; Hydra keeps its MQTT source.

`list` reports IDs, labels and kinds without reading any source. It cannot trigger scans/provider refreshes or claim an unread state. `read` obtains the current value and source state. It does not return an agent cache. Keep `live`, `stale`, `unavailable`, `unconfigured` and source-specific equivalents truthful. A nonlive Service Plugin presents no holdings.

## Agent-facing values

A source registers its projection with the state mapping. The projection can rename, drop or shorten fields. It must not infer measurements.

- Publish numbers reported by the source. If a tile formats a ratio as a percent, publish that same percent.
- Do not rescale a ratio whose scale is neither displayed nor declared. Keep the loss and its reference value instead of inventing a percentage.
- Include reading `asOf` and each measurement's `measuredAt`. Use names that identify the measurement, such as `greenhouse.temperatureC` or `soilPercent`.
- Remove images/binary data, firmware details, vendor codes and duplicate identifiers. Shorten long prose with a visible `...` marker.
- Keep useful identity fields, including a session's project and work directory. Do not substitute another reading for the requested measurement.

## Read-only channel

The Shell listens on the host's `desk-data` Runtime Channel. Personal Bot is the client. Use Unix ownership or the host token for pipes/TCP. Transport and authentication belong to `local-channel`.

A connection carries one version-1 JSON request line and one response line. Echo request `id`; use `readingId` for the source identity. Requests are limited to 4096 UTF-8 bytes. Registered values are limited to 64 KiB. Refuse an oversized reading; do not truncate it into a plausible partial instrument value.

Only `list` and `read` are accepted. Refuse unknown IDs and all mutation commands. Placement, installation and Hosted Pi actions remain on their own verified control channels.

The `desk_data` tool is available to both bot profiles. Every question reads the current source. Treat each channel independently: failure of package control is not evidence that Desk Data failed. A missing Shell, refused handshake, malformed response or timeout reports unavailable. Never use a remembered/file value as current data.

## Package publishing

[USER_APPLICATIONS](USER_APPLICATIONS.md#declared-data-answerable-by-voice) owns the manifest fields and `odkPackageData.publish` interface. The Shell validates declarations and publications. A package without `data` cannot publish.

Publishing uses the existing readiness/frame-token bridge. It grants no network, Shell DOM, preload or action authority. Reject undeclared fields, invalid types and sizes without replacing the previous value. Mark package content untrusted. Replacing/removing a revision removes its previous reading.

The registry keeps a read-only catalog store separate from the verifier-owned lifecycle store. Both use the same catalog directory. Sharing one instance must not remove verification or grant mutation to a reader.

## Proactive consumers

Owner-watch package readings declare and publish `measured_at` as an ISO 8601 UTC string. Use the measurement time, not a display tick. The registry still reports a published value as live. The watch rejects absent, invalid, future or over-age times under owner `maxAgeMs`. Built-ins keep `asOf`/`measuredAt`.

Private owner configuration owns thresholds, combinations, quiet hours, cooldown and suppression. Source fields are data, never rules or authorization. Proposal processing/history stays in agent state, outside Desk Data. Hosted Pi status/history is a separately identified data source. See [proposal contract](../../../integrations/personal-bot/docs/CONTRACT.md#proposals).

The registry adds no binary readings, provider credentials, history, scheduling or remote-desk sharing. Reads still obey source refresh policy.

## Verification

Test dispatch and publication at the control boundary. Test `desk_data` over a real local channel for list/read, unknown IDs, unavailable channels and bounds. Drive tile IPC and registry from one source to prove shared readings. Keep source tests for Hydra/weather/WeRead/Futu and host endpoint tests. Assertions concern returned values, state and trust labels, not private storage.

Use `tests/desk-data.test.js`, `tests/desk-data-shell.test.js`, `tests/desk-data-wiring.test.js` and the package declaration/frame tests. The bot client tests are in `integrations/personal-bot/tests/desk-data.test.mjs`. Fixture passes do not prove spoken/model/device acceptance.
