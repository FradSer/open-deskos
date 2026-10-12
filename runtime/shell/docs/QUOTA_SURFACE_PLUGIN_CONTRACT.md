# Quota surface replacement contract

Read this when replacing `odk.page.quota` rendering, refresh interaction, disclosures, or subscription ownership.
The [built-in guide](AI_PLUGIN_GUIDE.md) owns page registration and supplied context.
The [source contract](QUOTA_PLUGIN_CONTRACT.md) owns provider access and normalized readings.
The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md) owns loading, stylesheet admission, selection, and recovery.

## Consumer and rendering

Quota is an App page with the existing `plugins/quota-page.css` stylesheet.
It consumes `ctx.subscription.status()`, `lastCheck()`, `subscribe()`, and `refresh()`.
The registry owns cleanup registered through `ctx.trackCleanup()`.
The surface does not read credentials, files, or providers directly.

Provider names, account identity, plan, quota windows, reset times, and optional credits retain their existing meaning.
Only finite numeric percentages between zero and 100 produce numeric readings and accessible meters.
Zero remains an exhausted reading; missing, invalid, and string percentages remain unavailable.
Account errors precede other states.
Exhausted windows precede low readings; low readings precede unknown windows.
Unknown providers retain the default provider label and icon fallback.
Untrusted provider strings remain inert text.
The heading counts failed accounts as subscriptions.
Unavailable status with retained accounts identifies the previous response.
Unauthorized, unconfigured, unavailable, and empty responses retain their distinct recovery messages.

The current default's inline fill widths are blocked by the Shell document's Content Security Policy.
The independent fixture preserves that existing behavior alongside its numeric and accessible meter readings.
Agreement does not certify correct visual meter fill or repair this existing issue.
A separate repair needs an updated behavior scenario and verification of affected consumers.

## Refresh and lifecycle

Mount starts a refresh and subscribes to current readings.
Pending refresh retains accounts, disables the button, and exposes busy state.
Rejected refresh retains accounts and restores the action with persistent recovery wording.
Changed account content preserves expanded disclosures and focused summaries by account identity.
Browser keyboard input can activate the actual refresh button.
Programmatic focus checks do not establish keyboard traversal or assistive-technology acceptance.

Disable and shutdown release subscriptions and click handlers.
Failed subscription release retains ownership and blocks another mount until release succeeds.
Released surfaces ignore late readings and pending refresh completion.
Enable restores the selected implementation; built-in recovery selects captured defaults.
Replacement and recovery retain the actual page and comparison containers.
Disable can remove the desktop page; enable creates its placement again.
The document and independent peers remain available.

## Independent implementation and evidence

The [independent entry](../tests/fixtures/quota-surface-replacement/entry.js) constructs DOM nodes and owns projection, refresh state, and disclosure recovery.
It does not call the default factory or import its projection helpers.
Static provider artwork, Shell styles, fonts, and the public subscription service remain shared dependencies.
This evidence does not establish independent provider access or arbitrary stylesheet replacement.

[Scenarios](../tests/features/quota-surface-replacement.feature) define the shared behavior.
[Browser checks](../tests/quota-surface-electron.test.js) exercise actual preload, private Main IPC, development links, signed loading, and the public Renderer controller.
Subscription observation starts before initial mounting and checks the first actual consumer before adding a comparison consumer.
Three themes and two viewport sizes compare actual and comparison consumers across default, independent, and restored phases.
Nineteen state cases include mixed priorities, partial errors, unknown providers, malformed percentages, and inert markup text.
Held and rejected refreshes use a controlled subscription facade; ordinary reads still pass through actual preload and Main IPC.
Cleanup failures remain injected until an explicit retry; late callbacks and pending completion cannot update released nodes.
The keyboard check uses browser input dispatch with emulated focus and no foreground window request.

These checks do not certify authenticated production Main activation, joint source replacement, density, raster pixels, live accounts, physical input, or supported-device acceptance.
The [feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining acceptance gaps.
[Plugin coverage](PLUGIN_COVERAGE.md) owns measured results and command status.
