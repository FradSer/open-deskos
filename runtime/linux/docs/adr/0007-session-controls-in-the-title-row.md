# The Pi Sessions title row carries the global session controls

## Status

Accepted. Supersedes the part of ADR-0005 that kept the title row title-only and confined the screen-side Session Filter to the Session Overview.

## Context

ADR-0005 moved the screen controls off the Pi Sessions page and onto the Remote Control Strip, leaving the title row with only the title. Reviewing the running page showed the cost: changing the Session Filter needed two steps (open the Session Overview, then choose a filter), while the only always-visible control, the Overview opener, sat in the Session Detail's identity row next to the session's own facts. The filter, the opener and the status-bar indicator were therefore spread across three places with no single home.

## Decision

- The title row carries the title and every control that acts on the global Session Set: the Session Filter group and the Session Overview control.
- The Session Detail states session facts only and offers no control.
- The Session Overview header keeps the set summary and no longer carries the filter group, so one control has one home.
- The Remote Control Strip keeps its Session Filter and Session Overview buttons, sharing the same state as the title row.
- The title row wraps at narrow widths instead of squeezing the title: title, filter group, then the Overview control, each on its own line.
- The State Bar Pi indicator stays a cross-page surface and is not duplicated into the page's title row.

## Consequences

- Changing the filter is one step again, and touch and keyboard reach it without opening the overview.
- The title row is no longer quiet; it is a control row, which is what ADR-0005 traded away for calm.
- The narrowest supported width stacks three elements in the title row, so the Session Detail starts lower than before at 320x480.
- Filter state remains page-local and transient: the strip button, the title row, and the overview all read one value.
