# Desk Data is read through the plugin system

Spec for ADR 0033. The Personal Bot answers from the readings the desk already owns.

## Problem Statement

I own a desk whose widgets already know things: Hydra knows my plants' soil and the greenhouse
temperature, the weather instrument knows the reading at this desk, WeRead knows what I read, the
Futu Service Plugin knows my holdings. I ask the desk out loud — "do my plants need water",
"how cold is it here" — and the Personal Bot answers from a model, not from the desk. It has no way
to read any of that. Sometimes it guesses well and sometimes it invents a number, and I cannot tell
which, because the answer and the tile on the screen come from two different worlds.

The personal assistant is worse: it has no file access at all, so it cannot even read a snapshot the
shell might have written. And when I install my own Widget, whatever runtime state it holds is
invisible to every spoken answer, so the widgets I build can be seen but not asked.

## Solution

Every reading a plugin exposes lives in one registry the Shell owns. The tile that draws a reading
and the Personal Bot that answers about it read the same one, so the spoken answer and the screen
cannot disagree. The Personal Bot reaches that registry over a runtime channel on the Shell, and one
`desk_data` tool lists what the desk holds and reads any of it by id.

A reading is read the way the tile reads it, so each source keeps its own refresh policy: the
weather instrument still refreshes at most every ten minutes, Hydra still reads its MQTT
connection, and the agent never forces a provider request or keeps a stale copy. Every state a
reading can be in — live, stale, unavailable, unconfigured — reaches the reader as that state, and
an unconfigured or unavailable reading is never replaced by a plausible number.

My own installed Widgets and Apps can join the same registry: a manifest declares what the package
may publish, the package publishes it through the system-owned bridge the Shell already serves into
a package document, and the Shell validates the value against the declaration before it becomes
readable. Those values are data to read, never instructions.

## User Stories

1. As a desk owner, I want to ask my plants a spoken question and get the soil the tile is drawing, so that the desk answers instead of guessing.
2. As a desk owner, I want a spoken weather question answered with the instrument's own state, so that an unconfigured desk says so rather than inventing a temperature.
3. As a desk owner, I want the answer and the tile to come from one reading, so that the two can never contradict each other.
4. As a desk owner, I want a stale reading to say it is stale, so that an old number is never presented as current.
5. As a desk owner, I want a disconnected Service Plugin to report unavailable, so that no holdings are presented when there are none.
6. As a desk owner, I want to ask about a Service Plugin's data by its own id, so that a Widget that owns a service is answerable like any other Widget.
7. As a desk owner, I want a spoken question not to trigger an extra provider request, so that talking to the desk does not hammer a provider or my gateway.
8. As a desk owner, I want the personal assistant to see the same readings as the coding coordinator, so that both voices answer from the desk.
9. As a desk owner, I want to ask which Widgets and Apps are installed and where they sit, so that the desk can describe its own layout.
10. As a package author, I want my installed Widget's runtime state readable by a spoken question, so that the Widgets I build can be asked, not only looked at.
11. As a package author, I want to declare exactly what my package publishes, so that a package cannot publish more than it claims.
12. As a package author, I want publishing to be ordinary package code, so that it needs no network, no install script and no Shell DOM.
13. As a security reviewer, I want a published value to be labelled untrusted data, so that text inside a package reading can never act as an instruction to the agent.
14. As a security reviewer, I want a package that declares no data to publish nothing, so that publishing is opt-in.
15. As a security reviewer, I want the channel to carry no write verbs, so that a spoken request cannot change a reading through this path.
16. As a security reviewer, I want the channel authenticated the way every other runtime channel is, so that a host's own rules apply unchanged.
17. As a security reviewer, I want a non-text payload such as a camera frame kept out of the registry, so that no binary blob travels into a spoken reply.
18. As a desk owner, I want an absent Shell reported as unavailable, so that I am never answered from a remembered value.
19. As a desk owner, I want an oversized reading refused rather than truncated, so that a cut-off reading is never mistaken for a complete one.
20. As a desk owner, I want a second read to return the current reading, so that the agent has no cached copy of my plants.
21. As a future instrument author, I want registering my reading to be one declaration, so that a new tile is answerable by voice without a new integration.
22. As a future Service Plugin author, I want my snapshot to be answerable without a new tool, so that plugins do not each add a voice capability.
23. As a desk owner, I want `list` to name every reading the desk holds with its id and kind, so that the agent can say what exists before reading any of it.
24. As a desk owner, I want the agent to keep using its existing tools for anything that changes the desk, so that reading data never becomes a second, weaker way to act.
25. As a desk owner, I want a reading to carry only what an answer can use, so that a cover image or a firmware version does not crowd out the measurement I asked about.
26. As a desk owner, I want each reading to name what it measures and when it was measured, so that a question about the room is answered from the room's reading and a stale number is not called live.

## Scenarios

Stored as `runtime/linux/tests/features/desk-data.feature`.

```gherkin
Feature: Desk Data is read through the plugin system

  Background:
    Given the Shell holds a Hydra reading, a weather instrument, a Futu Service Plugin, and one installed package

  Scenario: A spoken question about a plant is answered from the tile's own reading
    Given the Hydra source is connected and one plant's soil is 30 percent
    When the Personal Bot reads the Hydra Desk Data
    Then the answer carries the same 30 percent reading the tile is drawing
    And the reading is reported as live rather than estimated

  Scenario: One reading serves the tile and the spoken answer
    Given a registered reading changed after the tile last drew
    When the tile and the Personal Bot read that registered reading
    Then both receive the current reading from the one source

  Scenario Outline: An instrument state reaches the reader as itself
    Given the weather instrument is <state>
    When the Personal Bot reads the weather Desk Data
    Then the reading is reported as <state>
    And no temperature, place or daily range is presented as current

    Examples:
      | state        |
      | unconfigured |
      | unavailable  |
      | stale        |

  Scenario: Reading a Desk Data source never forces a provider request
    Given the weather instrument already read the provider inside its freshness interval
    When the Personal Bot reads the weather Desk Data
    Then no further provider request is made for that read

  Scenario: A Service Plugin reading is answerable by its declared id
    Given the Futu poller published a holdings snapshot
    When the Personal Bot lists and reads Desk Data
    Then the poller's reading is listed under the service id its package declared
    And reading it returns the published snapshot
    And no other id answers for that same reading

  Scenario: A Service Plugin that is not live presents no holdings
    Given the Futu poller's last snapshot is older than its own freshness window
    When the Personal Bot reads that service's Desk Data
    Then the reading is reported as the plugin reported itself
    And no holdings are presented


  Scenario: The installed Widget and App catalog is readable
    Given the Shell has two installed packages, one of them placed on a grid page
    When the Personal Bot reads the installed catalog
    Then it lists both packages with their kind, version and placement

  Scenario: Listing names every reading without reading any of them
    Given a reading whose source counts how many times it has been read
    When the Personal Bot lists Desk Data
    Then the listing names that reading with its id and kind
    And the source has not been read

  Scenario: One desk channel failing says nothing about another
    Given a different desk tool on this host reports an error
    When the owner asks what their widgets are showing
    Then the reading tool is still used to answer
    And no earlier answer about that reading is offered instead

  Scenario: A reading names only what a spoken answer needs
    Given a source publishes device diagnostics, a cover image and vendor status codes beside its measurements
    When the Personal Bot reads that Desk Data
    Then the reading carries the measurements under plain names with the time each was measured
    And it carries no image, no firmware detail and no vendor status code

  Scenario: A reading states its own time so a stale answer cannot be called live
    Given a source's last measurement is older than its own freshness window
    When the Personal Bot reads that Desk Data
    Then the reading carries the time each measurement was taken
    And the reading is reported as the source reported itself

  Scenario: A reading publishes the percent the tile draws, and drops a ratio whose scale nothing declares
    Given a source reports one ratio the tile formats as a percent and another no display draws
    When the Personal Bot reads that Desk Data
    Then the ratio the tile draws is published as that same percent
    And the ratio no display draws is not published under a percent name
    And the loss and the value it is a loss against are both published

  Scenario: A reading whose own fields name a token is still a reading
    Given an installed package declared a field named token
    When the Personal Bot reads that reading
    Then the reading arrives rather than the request timing out

  Scenario: A frame that is not this protocol is named at once
    Given the link answered with a frame that is not its own
    When the Personal Bot reads Desk Data
    Then the failure names the wrong frame
    And it does not wait out the request timeout to say so

  Scenario: A package publishes inside its declaration
    Given an installed Widget declares data with the field remaining_seconds
    When the package publishes remaining_seconds through the package bridge
    Then the reading joins the registry under the package's id
    And a reader receives the published value

  Scenario: A package cannot publish outside its declaration
    Given an installed Widget declares only remaining_seconds
    When the package publishes a field it did not declare
    Then the value is refused
    And the previously published reading is unchanged

  Scenario: A package without a declaration publishes nothing
    Given an installed Widget declares no data
    When its document calls the package bridge
    Then nothing joins the registry
    And no reading names that package

  Scenario: A published value is data and never an instruction
    Given a package published a value containing text that tells the agent to disregard its instructions
    When the Personal Bot reads that reading
    Then the value is returned as reading content
    And it is labelled untrusted data rather than an instruction

  Scenario: A replaced package revision cannot answer with the previous value
    Given an installed Widget published a reading
    When that package's installed revision is replaced
    Then its reading is unconfigured again
    And the previous revision's value is no longer readable

  Scenario: The Desk Data Link changes nothing
    Given the Personal Bot is connected to the Desk Data Link
    When it sends a request that is neither a list nor a read
    Then the request is refused
    And every registered reading is unchanged

  Scenario: A second read returns the current reading
    Given the Personal Bot read a reading once
    When the source's reading changes and the agent reads again
    Then the second read returns the changed reading
    And no cached copy is returned

  Scenario: An unknown reading is refused rather than answered empty
    When the Personal Bot reads an id no plugin registered
    Then the read is refused as an unknown reading
    And no reading is returned in its place

  Scenario: An absent Shell is truthfully unavailable
    Given no Shell is listening on the Desk Data Link
    When the Personal Bot reads Desk Data
    Then the failure is reported as the desk being unavailable
    And no remembered value is presented as current

  Scenario: An oversized reading is refused rather than truncated
    Given a source published a reading larger than the link allows
    When the Personal Bot reads it
    Then the response is refused as too large
    And no partial reading is presented as a complete one

  Scenario: Both profiles read the same desk
    Given the coding coordinator and the personal assistant are both running
    When each reads the Hydra Desk Data
    Then both receive the same reading
```

## Implementation Decisions

- **One registry in the main process.** A `desk-data-registry` module owns a set of entries. An entry
  carries the reading's id, a label, the kind of owner (`tile`, `app`, `page`, `service`,
  `package`, `catalog`), and a read function that returns the current bounded reading plus a state.
  Registration is a declaration: a source that already exists registers itself, and no reading is
  copied, mirrored or cached anywhere else.
- **Ids are the plugin's own id.** A built-in reading uses the id its tile already registers
  (`odk.tile.hydra`, `odk.tile.weather`, `odk.tile.weread`, `odk.app.pi-sessions`, `odk.page.quota`),
  a Service Plugin reading uses the service id its installed package declared (`futu-poller`), an
  installed package uses its package id, and the installed catalog uses `odk.plugins.installed`. A
  reading is held once: the Futu Widget and the poller that feeds it are one reading under the
  service's own id, not two ids for one value. A tile's `ipcMain` handler keeps calling the source
  it already calls and the registry entry resolves that same source object, so there is one reading
  and no copy of it; the only thing a tile has that a reader does not is its own affordance, such
  as the weather tile's explicit force-refresh.
- **The read path is the tile's read path.** A registered read function may perform I/O under the
  source's own policy — the weather instrument's ten-minute interval and in-flight dedupe are
  unchanged, and no read is ever forced. The registry adds no freshness rule of its own.
- **Each channel is reached and described on its own.** The `desk_data` tool and the application
  lifecycle tools resolve their endpoints from the host the same way, and each presents the host
  channel token where a pipe carries no owner. The tool description and both system prompts state that
  one channel's failure is not evidence about another, and that every question re-reads the reading:
  a real device showed a broken lifecycle tool leading the coordinator to deny a working reading tool
  for four consecutive questions.
- **Projections are the agent-facing shape.** Each source registers a projection beside its state
  mapping. It renames, drops and shortens; it never infers, and it never invents a measurement. Every
  number a reader sees is a number the source reported, with one exception that is a unit conversion
  rather than a claim: where a tile formats a ratio as a percent, the reading publishes that same
  percent, so a spoken answer cannot differ from the tile by a factor of a hundred. A ratio no display
  draws and no payload declares the scale of is not rescaled and not published under a percent name:
  the loss and the value it is a loss against are both published, which is what the percentage would
  have been computed from anyway. Each reading carries an `asOf`, and each measurement
  carries its own `measuredAt`, and a reading's fields say what they measure
  (`greenhouse.temperatureC`, `soilPercent`, `remainingPercent`, `profitLoss`), so a reader answers
  a question from the reading that measures that thing. Three rules say what happens to the rest: a
  binary payload is dropped rather than shortened (a cover image is not a reading), long prose is
  shortened with a visible `...` marker rather than dropped (a quote is still the answer), and an
  identifier that duplicates a name already carried is dropped (a session's `uuid` beside its `id`,
  device boot detail beside a measurement, a vendor status code beside a measurement that already
  says whether it is fresh). What is kept identifies or measures: a session keeps the project name
  and the working directory it runs in, because that is how the owner names a session.
- **State vocabulary.** Every reading carries one of `live`, `stale`, `unavailable`,
  `unconfigured`, or a source's own equivalent reported as `state` alongside the value; a reading
  with no value never carries a substitute. The registry does not invent a fifth state and does not
  normalize a source's internal states away. A state is known only by reading: `list` performs no
  reads at all, so a listing can never trigger the Pi Sessions scan, a quota fetch or a WeRead
  refresh, and it reports no state it did not read. A Service Plugin that is not live presents no
  holdings at all, so a stale or credential-blocked plugin cannot be quoted as if it had them.
- **The Desk Data Link.** A new logical link name in the host's endpoint table joins the existing
  `user-app-control`, `remote-bridge`, `personal-bot` and `desk-link` entries, so Unix hosts get a
  runtime-directory socket and a Windows host gets the matching named pipe with no per-host code.
  The Shell listens; the Personal Bot is the requesting client. One request line, one response line,
  request id echoed, exactly as the user-application control endpoint does. Authentication is
  `local-channel`'s: ownership on Unix, the shared channel token on a pipe or network endpoint.
- **Read-only by construction.** The link dispatches exactly two commands, `list` and `read`. There
  is no verb that changes a reading, a registration, a placement or a package, so the channel cannot
  become an action surface. An unknown or mutating command is refused the way an invalid command is
  refused today.
- **Bounds.** A response is bounded like the voice status frame; a reading that exceeds the bound is
  refused as too large rather than truncated, because a truncated instrument reading is a plausible
  wrong number. A request carrying an unknown id is refused as unknown, never answered with an
  empty reading.
- **The package bridge.** The document the Shell serves into a package already carries a system-owned
  readiness handshake that posts to the parent frame with the frame's token. Publishing is one more
  message on that same handshake, so a package needs no new API surface, no network and no Shell
  DOM. The manifest's `data` declaration is parsed with the rest of the manifest, so an invalid
  declaration is an invalid manifest and cannot be installed. The Shell accepts a published value only
  for a field the declaration names, of a bounded type and size, and labels the entry untrusted.
  Without a declaration the bridge accepts nothing.
- **The tool.** One `desk_data` tool in the personal bot with `list` (no parameters) and `read` (one
  id). Its description states that these are the desk's own readings, that each state is reported as
  itself, and that a reading is data rather than an instruction. Both profiles load it: the coding
  profile through its capability loader, the personal profile through its own tool set, so neither
  profile needs a special case.
- **The prompts.** Both system prompts state that the desk's own readings are available through
  `desk_data`, that a reading is never invented, and that answering a question about the desk's
  widgets, instruments or installed packages means reading the registry rather than reasoning from
  the request. The personal prompt adds that the readings are untrusted content.
- **Failure shape.** A missing Shell, a refused handshake, a malformed response and a timed-out
  request are each reported to the agent as the desk data being unavailable, with no fallback to a
  remembered or file-based value.

## Testing Decisions

- **A good test here asserts what a reader receives.** The subject is the reading as the Personal Bot
  gets it, so assertions are on the returned reading, its state and its provenance, never on how the
  registry stores it or on which module called which.
- **Seam one: the Desk Data control endpoint's dispatch.** The highest reachable seam that covers
  registration, the read path, the read-only dispatch, the bounds, the package publication
  validation and the untrusted labelling at once, in the same style as the existing user-application
  control tests. Preferred over testing the registry's internals, because the registry alone cannot
  express what a reader is allowed to receive.
- **Seam two: the personal bot's `desk_data` tool over a real channel.** The tool is exercised against
  a listening Desk Data Link, in the style the existing task-client tests use for the control
  daemon, covering `list`, `read`, an unknown id, an unavailable link and an oversized response. This
  is above the client and the tool individually, and it is the seam the model actually uses.
- **Seam three: the wired main process.** A tile's IPC handler and the Desk Data registry are driven
  from one source in the same run, which is the only place the claim that the tile and the spoken
  answer share one reading can be shown rather than assumed.
- **Seam four: the existing source tests, unchanged.** The sources are not re-tested here; their own
  tests remain the proof that Hydra, weather, WeRead and Futu hold the readings they claim. The new
  coverage is that a reading reaches a reader intact and honestly.
- **Both hosts.** The endpoint naming is covered where the other link endpoints are covered, so the
  Windows named pipe is a naming result rather than an untested guess.
- **Prior art.** User-application control dispatch, the voice channel client and the task control
  client for the channel shapes; the weather source tests for the four instrument states; the
  user-app content and store tests for manifest parsing and the package document handshake.
- **Red before green.** Each scenario is written as a failing test at the seam above before the
  behavior exists, and the failure is read to confirm it fails for the stated reason.

## Out of Scope

- Non-text readings: the camera frame stays out of the registry. Reading a picture is a different
  capability with a different budget.
- Any mutation through the channel. Starting, stopping, installing, removing and placing remain with
  the verified lifecycle tools and the Hosted Pi control tools.
- Provider credentials, provider network access or any new egress for the agent. The agent never
  talks to a provider, a gateway or an MQTT broker.
- History, trends, alerts and scheduling of readings. A reading is the current one; a widget that
  wants a history publishes it through its own declaration.
- Package-side computation of a reading from a source the package cannot reach. A package with no
  network has nothing new to say; a package that needs provider data asks the Shell for it the way
  any other instrument does.
- A second way for a Widget to expose data. One declaration, one bridge, one registry entry.
- Desk Link sharing of readings to a second desk, and any remote desk data surface.

## Further Notes

Deploying this to the reference host turned up a release-gate defect that had nothing to do with it;
that fix and its evidence are recorded with the release tooling rather than here.


- The visible proof for the owner is a spoken question answered with the same number the tile shows,
  with an unconfigured instrument saying so.
- A Widget that owns a Service Plugin is answerable under the service's own id, so `futu-poller` is
  both the plugin's id and the name a reader uses for the Futu holdings. A future revision may
  prefer the Widget's id instead; that is a naming decision, not a transport one, and it does not
  need this change to be redone.
- The camera tile is the clearest case of a reading that is not Desk Data, and its exclusion is the
  boundary this registry is meant to hold.
- The Shell builds one read-only store for the registry while the lifecycle backend keeps its own
  verified store over the same catalog directory, as the Futu service refresh already did. Folding
  them into one instance would hand the registry the verifier's store or strip the verifier from the
  lifecycle, and neither is worth the coupling.
- The Desk Data listener repeats the user-application control listener's request shape rather than
  sharing one framed-request helper. Extracting that helper belongs in the local channel itself,
  where the token gate and the ownership rules live, and this change has no second consumer to
  justify touching it; the duplication is the price of not editing the authentication path to serve
  a second protocol.

## Proactive consumer freshness convention

The voice-service watch is a read-only consumer of this registry. Package sources
intended for owner-triggered proposals declare and publish `measured_at` as an
ISO 8601 UTC string alongside signal fields. This is a publication convention, not
a new registry state or write verb: published package readings remain live, while
the watch rejects absent, invalid, future and over-age measurements under owner
`maxAgeMs`. Built-in projections retain their existing `asOf` and per-plant
`measuredAt` fields. Polling still respects each source's refresh policy (story 7).

Rules, thresholds, combination predicates, quiet hours, cooldown and suppression
belong to private owner configuration. Source fields never become rules, model
instructions or authorization. Proposals and their processing history belong to
agent state and are not published back into Desk Data. Hosted Pi status/history
is the explicitly labelled second data plane. Read
@../../../integrations/personal-bot/docs/PROACTIVE_SUGGESTIONS.md when implementing
or reviewing that consumer; its scheduling contract replaces the previous future
consumer boundary without adding registry alerts, history or scheduling.
