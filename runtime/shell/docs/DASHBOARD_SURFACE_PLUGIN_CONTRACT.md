# Dashboard surface plugin contract

## Ownership

`odk.page.dashboard` owns the Today briefing surface.
The desktop layout owns its placement and display role.
The Shell owns paging, foreground Apps, Back, authorization, and recovery.
The shared Home Briefing service owns validated briefing frames.
The shared Tick service supplies local dates.
The surface performs no provider requests or credential access.

Read [the built-in guide](AI_PLUGIN_GUIDE.md) for the public surface context.
Read [runtime replacement](RUNTIME_PLUGIN_REPLACEMENT.md) for loading and management authority.
[Agent Home scenarios](../tests/features/agent-home.feature) own visible briefing behavior.

## Preserved behavior

The surface renders briefing segments as safe Markdown.
HTML remains literal, images cannot load, and links remain display-only text.
Approved fact icons retain the Shell theme adapter and static artwork.
Temperature readings retain their Celsius units.
Portfolio changes use direction colors only for signed, nonzero values with live sources and a live frame.
The briefing frame retains source metadata and omitted-source counts.
The surface has no attribution footer, update timestamp, or Sources controls.
Loading and empty frames can show the empty placeholder.
Unavailable, error, and stale frames report availability only through the generation indicator.
Their paragraphs contain available facts or remain empty.
The paragraph uses a polite status region.
Home fits the paragraph and inline icons within the space below the date row.
The date row and card geometry do not change with briefing length.
Long content remains scrollable at the 16-pixel reading floor.
The date retains its English weekday, month, day, and year.
A red presence dot stays beside the weekday.
The existing `loading` briefing state changes that same dot into a spinner without changing its position.
Error, stale, and unavailable states show a static failure ring with an exclamation mark.
The indicator supplies an accessible status label and automatic recovery description.
Live and empty states restore the red dot.
Reduced motion keeps a static busy ring and an accessible busy state.
Loading shows the retained briefing without refresh narration.
An initial load uses the empty placeholder with `aria-busy`.
Automatic briefing refresh does not add conversation messages.
Current callbacks update the active placement.
Released callbacks cannot change former nodes or later placements.
Failed unsubscribe retains cleanup ownership for retry.

## Independent implementation evidence

[The independent fixture](../tests/fixtures/dashboard-surface-replacement/entry.js) constructs its own nodes and formats readings without default factory delegation.
It shares approved static icon paths, Shell styles, fonts, the public icon adapter, public services, and the safe Markdown renderer.
These shared dependencies limit independence claims for appearance and data providers.
The fixture is acceptance code, not an installed product default.

[Electron acceptance](../tests/dashboard-surface-electron.test.js) loads development links and signed installed revisions through actual loaders.
It replaces and restores the Dashboard inside one unchanged Shell document.
The default mount is forbidden during independent activation.
Both paths compare ten controlled frames across Instrument, Pixel, and Border Beam.
Each positive path makes sixty replacement or restoration comparisons against the default.
Comparisons cover literal content, element geometry, styles, icon paths, and availability messages.
Leaf text and narrative text exclude static markup indentation from the comparison.
Product assertions also check literal rendering, portfolio direction, and the absence of source controls.
Controlled invalid candidates must fail at the empty-message comparison through both loading paths.
Additional invalid candidates leave the actual page empty or let released callbacks modify former nodes.
Each control must fail at its intended boundary through both loading paths.

The checks preserve the Today container, Clock placement, and foreground Clock App node.
Browser pointer input closes the App through Back.
Every frame compares actual Today content with the controlled placement.
The page has no source controls after Back.
Controlled forward and backward dates exercise the actual shared Tick.
Captured callbacks from previous implementations cannot change the active placement.
They also cannot change retained nodes from former placements.
Final shutdown releases observed briefing subscriptions, discovery handlers, and signed asset access.
The parent removes private files only after the Electron child closes.

## Authenticated production Main activation

[Main acceptance](../tests/dashboard-main-bootstrap.test.js) runs production Main with every Main plugin enabled and controlled external inputs.
It starts from built-in and signed Dashboard selections in separate private processes.
The authenticated CLI activates signed revisions, restores the built-in page, and activates an updated signed revision.
Receipts identify the exact selected revision, and executed entries report their version.
Recovery succeeds with malformed external configuration and revoked publisher trust.
Recovery preserves those unavailable prerequisites until the fixture restores its private files.

The checks retain the Shell document, Today container, selected page, foreground Clock App, peer nodes, and Main port identities.
Each positive path compares ten frames across three themes for four activation or recovery operations.
Briefing and Tick observations begin before the initial Shell document acquires subscriptions.
Their counts remain stable through activation and reach zero after Renderer shutdown.
A signed candidate without a briefing subscription must fail the ownership assertion after authenticated activation.
Browser Escape still closes the foreground App.
Normal shutdown releases Main handlers, protocol routes, and five private listeners before parent cleanup.

One initial blank document primes debugger controls before the single Shell document loads.
The fixture controls external provider inputs through the existing composition isolation helper.
The actual Bot client has no transport while injected briefing frames control the comparison.
The hidden Main window uses offscreen rendering and a fixed 1920 by 1280 viewport at unit scale.
Linux uses software rendering for this isolated fixture.
That helper limits Main socket connections; it is not a general child-process or Chromium network sandbox.
The fixture separately denies Chromium HTTP requests.
The narrower browser fixture above uses the actual App Manager with unrelated Main plugins disabled.

## Remaining acceptance

These checks do not establish independent density, raster parity, arbitrary themes, live providers, or physical input.
Windows and CM5 acceptance remain separate.
Installed App page replacement is a separate feature gate.
[Coverage](PLUGIN_COVERAGE.md) owns measured results.
[The feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining work.
