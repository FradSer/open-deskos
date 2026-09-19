# The Pi Sessions page shows live sessions and reads like Pi

## Status

Accepted. Supersedes ADR-0007's control row and ADR-0008's All-filter default and Overview-as-chooser framing. ADR-0012's bounded Markdown result body is extended, not replaced.

## Context

The operator inspected the running desk and reported three problems with the fourth page.

The list showed sessions that had already exited, so live work was buried under history: a machine with several stale registry records reported them all. Numbering the Session Filter buttons made this worse rather than better, because the widest setting was the default.

The page also mixed its own chrome with Pi's state. The title said "Pi Sessions", a filter group and session controls sat beside it, and the selected session's state appeared again as a badge in the body. Nothing on the page said what Pi was doing in Pi's own terms, and the user's prompt was wrapped at a fixed 65-character measure instead of the width the detail actually had.

Two data defects made the page wrong beyond its layout. The Desk Link Service emitted one row per (Reporting Machine, session) pair, so a session described by two reporters appeared twice and counted twice; the page keys its rows by session identity, so those duplicates also collided and accumulated grid nodes on every scan. And session events were looked up from the first machine that merely knew the session rather than from the machine that owned it, which answered "no events yet" for sessions that had a readable stream.

The reporting machine produces rich output that the page then flattened. Pi renders an assistant reply, its code fences, and its diffs with a reading palette; the page showed one bounded grey line for a reply and unbounded, uncoloured monospace for a result.

## Decision

- **The page lands on live sessions.** The Session Filter defaults to Live — running plus settled — so the first thing the operator sees is current work, never a field of history. Exited sessions remain reachable, but only when asked for.
- **The Session Filter lives in the Session Overview.** Its tabs are Live, Working, Idle, Exited, and All, above the list they narrow, and the Remote Control Strip carries one filter button whose label is the current filter and which advances on press. The Session Detail carries no tabs; a first attempt put them nowhere and was corrected after the operator asked for the tabs back where they had been.
- The Session Detail carries **no page title and no controls**. Its heading is the state of the thing it is showing, and its only controls are the Remote's persistent Back and Select plus its own directional input.
- **The Session Overview is the page's home view.** The Session Filter sits above a single-column list of the Session Set: one row per selected session with its state, goal, directory, and activity. Choosing a row shows that session's Session Detail; Back, Escape, or primary input returns to the list.
- **A Session Detail's title is Pi's own state**: `Working...` beside Pi's ten-frame braille indicator at 80ms while the session streams, or `Idle` when it is alive but waiting. The session's full directory is the subtitle, and the elapsed label sits at the right of that title row. Reduced motion holds one frame; the indicator is information, so it is never removed.
- **A quoted prompt wraps to its container.** The fixed 65-character measure is removed so the detail's own width decides where the text turns.
- **Session Event bodies read like Pi.** Every kind keeps the body Pi produced, with its own byte limit and an explicit truncation flag: a tool result 64 KiB, an assistant reply 16 KiB, a prompt 8 KiB, and a thought or tool call 4 KiB. Nothing is flattened to a single line any more, so a bash command, a prompt, and a result read as Pi wrote them; the Session Overview's one-line activity remains a summary made for that row. Fenced code is highlighted with the same tokenizer Pi uses, and a unified diff is coloured by line. Markdown, syntax, and diff colours come from Pi's own theme roles, scoped to quoted content as a documented DESIGN.md exception.
- **The retained window follows the measurement.** Real sessions on the reporting machine hold 186–2,695 events and 0.3–2.9 MB of text, so the earlier 60-event / 256 KiB window showed only a sliver and was read as heavily omitted content. The window is now 300 events and 1 MiB per session, byte-bounded as before, and the renderer memoizes rendered event markup so a long stream re-parses only what changed.
- **One session is one row.** When several Reporting Machines describe the same session, the richest report wins: one with events over one without, then the newest. Counts, workspaces, and the page all follow the deduplicated set. The Desk Link Service resolves this where the (machine, session) cross product is created, and the runtime resolves it again for every source, so a desk never shows one session twice even while an older service is still running. The operator reported exactly that: duplicated rows, each carrying the selection band, which was the page keying two rows by one identity.
- **Session events are read from the machine that owns them.** A session known to several machines is answered by whichever one actually holds its events; only when none does is the answer "no reported events", and only a session no machine knows is reported as missing.

## Consequences

- History is one tab away rather than absent. The Session Filter is transient page state, so a shell restart returns the page to Live; the scanner, the status bar, and the desk link always report the exited count too.
- One Remote Back performs two things at once: it returns the page from a session to the live list, and the Shell exits App Focus Mode. The list is therefore browsed by entering focus again with Select, after which directional input moves its cursor. Remote Back is deliberately ignored by the list itself so bounded paging stays available from it.
- The page publishes exactly one Remote Control Strip button, the Session Filter, because the page owns directional input and the Remote therefore cannot walk DOM focus to reach a tab. The strip's persistent Back and Select remain the rest of the interface, which is what makes a page without on-screen session controls usable on the Remote.
- Only the visible view may own the Shell's `data-page-focus` entry point, so focus lands on the live list's selected row or on the session detail, never on a covered surface.
- The Pi reading palette is a deliberate exception to "built-in plugins use only DESIGN.md semantic tokens". It is bounded to Session Event bodies and justified by the operator's requirement that a transcript read as it does in Pi; the page's own surfaces remain on semantic tokens.
- Bodies cost more of the per-session budget than summaries did, so the byte bound is now the binding one more often than the event count. Retention still drops whole oldest events rather than splitting one, so the stream stays a contiguous tail with no half-record.
- The Session Filter's tabs are pointer- and keyboard-reachable, and the Remote reaches them through the Strip's single filter button rather than by walking DOM focus, because the page owns directional input in both of its views.
- Verification stays split: the harnesses prove the DOM, geometry, colours, and Remote routing on the CM5 headlessly; physical touch, the ESP32-S3 Remote's own Back, GPU rendering, and screen-reader behaviour still need device acceptance.