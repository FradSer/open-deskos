# Desk Data is one Shell-owned registry the Personal Bot reads

## Status

Accepted

## Context

Every reading on the desk already has an owner. The main process holds it — `hydra-mqtt` for the plants and the greenhouse environment, `weather-source` for the instrument, `weread-source` for the reading highlight, `futu-source` for the Service Plugin snapshots, the Pi Sessions scanner, the OpenCode Go quota — and hands it to a tile through one `ipcMain` channel each. ADR 0010 already fixed the shape of that seam for weather: the trusted main process owns the provider, the renderer asks for a snapshot, and the renderer never performs provider I/O.

The Personal Bot could not read any of it. It is a separate resident process (ADR 0031) whose tools are file and shell access to the workspace checkout, the user-application lifecycle endpoint, and the Hosted Pi control tools. The owner's requirement is that spoken questions reach the same readings the screen shows — ask whether the plants need water and get the soil the tile is drawing, not a guess and not a second integration.

The obvious answer, a snapshot file the shell writes and the agent reads, is wrong in three ways. It is a second copy of state that can disagree with the tile. It goes stale without ever saying so. And the personal profile has no file read at all, so the desk's own assistant would be the one profile that cannot see the desk.

## Decision

- The Shell owns one Desk Data registry in the main process. A source registers the reading it owns under its plugin id with a label, and both the tile's `ipcMain` handler and the Personal Bot read that one registered source. There is no second integration of a provider and no copy of a reading anywhere else.
- The Desk Data Link and the existing application control link are one family: the Personal Bot resolves
  each link's endpoint from the host and presents the host channel token where a pipe carries no owner.
  A link is reached on its own, so a failure of one is never evidence about another — a real device
  showed the opposite: one broken channel tool led the coordinator to deny a working one for hours.
- A reading is what the reading says, not the source's payload. A source registers a projection
  beside its state mapping: the measurements a spoken answer needs, under plain names, each with the
  time it was taken. A projection renames, drops and shortens; it never infers, and every number it
  publishes is one the source reported, except a ratio a tile formats as a percent, which is published
  as that same percent so the two cannot differ by a factor of a hundred. A ratio no display draws and
  no payload declares the scale of is dropped rather than guessed. A binary payload is dropped rather than
  shortened, long prose is shortened with a visible marker, and device firmware, vendor status codes
  and duplicate identifiers do not reach a reader at all, because a reading that carries them invites
  a reader to answer from the wrong field or to call a stale value live.
- A reading is read through the same path the tile uses, so the source's own refresh policy decides whether a read performs I/O: the weather instrument keeps its ten-minute interval and in-flight dedupe, the Hydra source keeps its MQTT connection, and the Personal Bot never force-refreshes and never has a private freshness rule.
- The Personal Bot reaches the registry over the Desk Data Link, a Runtime Channel in the same family as `user-app-control`: the Shell listens, the agent is the requesting client, one JSON request and one JSON response per line, resolved by `local-channel` so a Unix host authenticates by ownership and a Windows host by the shared Channel Token. The link is declared in `LINK_ENDPOINTS` and inherits both hosts from that one name, and a request carries its reading under `readingId` so a correlation id is never confused with a reading.
- The link reads and changes nothing. It is not an action surface: a reading is not a mutation, and the actions a voice request can take stay with the user-application lifecycle tools and the Hosted Pi control tools. The channel dispatches `list` and `read` and refuses every other command.
- `list` names what the desk holds and reads none of it: a listing that read every source would trigger the Pi Sessions scan, a quota fetch and a WeRead refresh to answer a question that asked for no reading, and it would report states it had read rather than states that stand. A state is known only by reading one.
- One tool, `desk_data`, carries it: `list` returns every reading with its id, label and kind, and `read` returns one bounded reading by id with its state. Both profiles have it, so the coding coordinator and the personal assistant answer from the same desk.
- A source whose payload is not structured text — the camera frame — is not Desk Data and does not enter the registry. Reading a picture is a different capability with a different budget, and a base64 frame in a spoken reply helps nobody.
- A Service Plugin's snapshot enters the registry under the service id its own installed package declared, so a Widget that owns a service is answerable by that id. A reading is held once: the Futu Widget and the poller that feeds it are one reading, not two ids for one value. A Service Plugin that is syncing, waiting for a credential or offline reports its own state and presents no holdings at all, rather than the last ones it happened to hold.
- An installed package declares in its manifest what it may publish (`data`), and publishes through the system-owned bridge the Shell serves into a package document. The Shell validates the shape against the declaration before the value joins the registry, and the value is untrusted content: it is data to read, never an instruction and never authorization. A package gains no network, no Shell DOM, and no other capability by publishing.
- Every state a reading can be in is stated as itself, which the weather instrument already fixed: `live`, `stale`, `unavailable`, and `unconfigured` each reach the reader as that state, and a reading that is not live is never substituted by a plausible number.

## Considered Options

- **A snapshot file the shell writes and the agent reads.** Rejected: it is a second copy that can disagree with the tile, it goes stale silently, and the personal profile has no file read, so the desk's own assistant would be the one profile blind to the desk.
- **Let the renderer plugins publish their data.** Rejected: the renderer's account of a reading is a rendering concern — Hydra's tile already knows how to turn a soil percentage into "30%" and a dry-meter class, which is not the reading — and it would make a sandboxed document the source of truth for something an agent acts on by speaking.
- **One tool per source (`hydra_status`, `weather_status`, and so on).** Rejected: the tool list then grows with every plugin the desk ever installs, and a Widget that owns a Service Plugin needs its own tool anyway. A single tool with `list` and `read` scales with the registry rather than with the code.
- **One Personal Bot tool family judging the desk's channels by each other.** Rejected on a real
  device: the application lifecycle tools threw a platform error there, and the coordinator then
  answered that it had no channel to the desk's readings for four consecutive questions, in the same
  session where the reading tool worked. Each channel is now described and prompted as its own, and
  every question re-reads the reading.
- **Let the agent connect to providers itself (MQTT, the Futu gateway, a weather API).** Rejected: it puts provider credentials, network egress, and a second truth for every reading inside a conversation loop that runs model-authored text.
- **Handing the reader each source's own payload.** Rejected on a real device, not on paper: the
  WeRead reading carried a base64 cover, the Hydra reading carried firmware, boot id and an `IDLE`
  status code, and one spoken question about the room was answered from the greenhouse sensor instead
  of the weather reading. A payload is a tile's input, not a reading's.
- **Pushing readings into the agent's prompt every turn.** Rejected: it spends context on data no request asked for, and it freezes readings at session start, which is exactly the staleness the pull avoids.
- **Giving the link write verbs so a spoken request could act on a reading.** Rejected for the first version: every mutation a voice request can make already has a verified lifecycle tool with its own confirmation and rollback rules, and a data channel that could also change things would be a second, weaker one.

## Consequences

- The tile and the spoken answer cannot disagree, because there is one reading and both read it.
- The registry is the place to look for every future instrument, which is what ADR 0009 predicted for Service Plugins and this extends to built-in readings.
- A package that wants to be answerable declares `data` and publishes through the bridge; a package that does not is invisible to the agent, which is the default and needs no policy.
- An unavailable Shell is a truthful answer rather than a silent stale file, and the personal profile gains desk readings it previously had no way to reach.
- Publishing readings is read-only, so this decision does not widen the agent's authority; a future action surface is a separate record.

## Acceptance

`runtime/shell/tests/features/desk-data.feature` holds the scenarios: a reading the tile and the Personal Bot share, the four instrument states reaching the reader as themselves, a Service Plugin reading under its declared id, a package publishing inside its declaration and refused outside it, a link that refuses to change anything, an unavailable Shell reported as unavailable, and a package value read as data rather than as an instruction.

`runtime/shell/tests/desk-data.test.js` covers the registry and the control endpoint at the dispatch seam: one registered read for both readers, a listing that reads nothing and reports no state, each source's own state reaching the reader, a projection that keeps every number the source reported while dropping images, firmware and vendor status codes, a read-only dispatch over the connected socket, an unknown id, a second read that is not a cached copy, and a reading past the bound refused rather than trimmed. `runtime/shell/tests/desk-data-shell.test.js` covers what the Shell registers, the state each source's own vocabulary maps to, a Service Plugin that is not live presenting no holdings, the bounded installed catalog, and a catalog that cannot be read leaving what the desk holds as it was. `runtime/shell/tests/desk-data-wiring.test.js` covers the wired main process: a tile's IPC handler and the registry resolving one source, and a package publishing through the shell's own handler. `runtime/shell/tests/user-app-store.test.js` covers the manifest `data` declaration and an invalid one; `runtime/shell/tests/user-app-runtime.test.js` covers the package document's publish bridge; `runtime/shell/tests/user-app-frame.test.js` covers a package publishing through that bridge and nothing else reaching the Shell. `integrations/personal-bot/tests/desk-data.test.mjs` covers the client's endpoint on both hosts, the `desk_data` tool in both profiles reading one desk, a refusal, an oversized response, and an absent Shell reported as unavailable.
