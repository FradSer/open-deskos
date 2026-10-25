Feature: ESP-NOW frame builders
  The main node and the sub-nodes used to hand-fill every FleetMessage frame, repeating
  the version stamp, type tag, and MAC copy. The builders in domain/fleet_codec.h are the
  single construction point, so the wire header is set once and identically on both ends.

  Background:
    Given the fleet protocol version is 6

  Scenario: Every builder stamps the version and the type tag
    When any frame is built
    Then its version equals the fleet protocol version
    And its type equals the message kind it was built for

  Scenario: An env broadcast carries the derived metrics and the main node's time
    When the main node builds an env broadcast for 24.5 C, 60% RH, 101000 Pa, 800 lux, 1.2 kPa VPD at 07:30 in month 10
    Then the frame type is EnvBroadcast
    And the node id is 0
    And the temperature, humidity, pressure, lux, and VPD match the inputs
    And the hour is 7, the minute is 30, and the month is 10

  Scenario: An env broadcast with no valid time carries the 0xFF marker
    When the main node (RTC unset, pre-SNTP) builds an env broadcast
    Then the hour, minute, and month fields are all 0xFF
    And sub-nodes ignore the time slice but still accept the env

  Scenario: A status report carries soil readings and the reporting node's MAC
    When sub-node 3 with MAC AA:BB:CC:DD:EE:01 builds a status report for raw 1500, 42%, valid, status 2
    Then the frame type is StatusReport
    And the node id is 3
    And the MAC equals AA:BB:CC:DD:EE:01
    And the soil raw, percent, valid flag, and status match the inputs

  Scenario: A pair request carries the requester id and MAC
    When an unprovisioned sub-node with MAC AA:BB:CC:DD:EE:02 builds a pair request
    Then the frame type is PairRequest
    And the node id is 0
    And the MAC equals AA:BB:CC:DD:EE:02

  Scenario: A plan command carries the target node and the plan code
    Given the plan vocabulary is the wire contract for one command byte
    When the main node builds a plan command of the standard plan to node 3
    Then the frame type is PlanCommand
    And the node id is 3
    And the command byte carries the standard plan code
    And no field of the frame is added or retyped for it

  Scenario: A Directive is only read as one when it is addressed to this node
    Given a plan command addressed to node 3
    When node 3 decodes it
    Then it is a Directive for node 3
    And a plan command addressed to another node, one decoded by an unprovisioned node, one
      carrying an unknown plan code, and a pump command are all not Directives
    And the zone is left untouched by each of them, because a stray byte must never start
      pump time

  # A firmware that predates this vocabulary has no PlanCommand branch in its
  # dispatch and falls through to "ignore". No test of the current code can observe
  # that, so the property is kept here as documentation: it holds because the plan
  # code rides an existing command byte under a *new* kind, which the scenario above
  # and the prefix-freeze discipline in AGENTS.md pin.
  Note: an older sub-node ignores an unknown message kind and keeps its own policy.

  Scenario: A pair assign carries the new id, subject MAC, and the main node's channel
    When the main node builds a pair assign of id 4 to MAC AA:BB:CC:DD:EE:03 on channel 6
    Then the frame type is PairAssign
    And the node id is 4
    And the MAC equals AA:BB:CC:DD:EE:03
    And the channel is 6

  Scenario: A pump command targets a node and sets the pump flag
    When the main node builds a pump command turning node 2 on
    Then the frame type is PumpCommand
    And the node id is 2
    And the pump flag is 1

  Scenario: A spotlight command targets a node and sets the view flag
    When the main node builds a spotlight turning node 5 off
    Then the frame type is ViewSpotlight
    And the node id is 5
    And the view flag is 0

  Scenario: Unused payload fields stay zero
    When the main node builds a pump command turning node 2 on
    Then every field unrelated to a pump command is zero
    Including the env/time fields hour, minute, and month

  # Forward compatibility: a future field addition (schema bump) OTA'd to the
  # main node first must not strand sub-nodes still on the older schema. The
  # recv path accepts a frame whose version is >= this firmware's schema and
  # whose length is >= the layout it compiled against, parsing the prefix it
  # knows and ignoring trailing bytes it does not. This is what lets a sub-node
  # still receive an OtaAnnounce from a newer main and self-upgrade over the air.

  Scenario: A node accepts a frame from a newer protocol with extra trailing bytes
    Given a sub-node compiled against protocol version 3
    When a frame arrives with version 4 and length greater than its layout
    Then the frame is accepted
    And the node parses the prefix it knows and ignores the trailing bytes

  Scenario: A node accepts a frame from its own protocol version
    Given a sub-node compiled against protocol version 3
    When a frame arrives with version 3 and the matching length
    Then the frame is accepted

  Scenario: A node rejects a frame from an older protocol
    Given a sub-node compiled against protocol version 3
    When a frame arrives with version 2
    Then the frame is rejected

  Scenario: A node rejects a truncated frame
    Given a sub-node compiled against protocol version 3
    When a frame arrives with version 3 but length less than its layout
    Then the frame is rejected

  # The Timetable block. ADR-0006 replaced the Directive with a Window's worth of
  # watering times, so the frame grows once and the protocol version bumps with it.
  # The block is APPENDED after every existing field: the prefix stays byte-stable,
  # which is the only reason an older sub-node can still be reached over the air.

  Scenario: A timetable frame carries a whole Window
    When the main node builds a timetable frame for node 2
    And the Window's identity is 29712345
    And the author declared the summer season
    And the Window holds four entries
    Then the frame type is Timetable
    And the node id is 2
    And every entry's offset, intent, and night marker match the authored ones

  Scenario: A timetable entry is an intent, never pulse parameters
    When the main node builds a timetable frame for node 1
    Then the entry carries a plan code and nothing else about the dose
    And no field of the frame carries pulse timing or a threshold

  Scenario: A timetable with no entries is a frame that exists
    When the main node builds a timetable frame for node 1
    And the author scheduled no watering for the Window
    Then the frame type is Timetable
    And the entry count is 0
    But that is not the same as no frame arriving at all

  Scenario: A released message kind is not reused
    Given the PlanCommand kind is retired
    When a timetable frame is built
    Then its type is a kind of its own
    And the retired kind is left unused rather than reassigned

  Scenario: A timetable for another node is not decoded
    When a timetable frame addressed to node 2 arrives at node 3
    Then the frame is not decoded as a timetable

  Scenario: A timetable arriving at an unprovisioned node is not decoded
    When a timetable frame arrives at a node with no assigned id
    Then the frame is not decoded as a timetable

  Scenario: A timetable with an unusable byte is not decoded
    Given a timetable frame whose declared season is not one this firmware knows
    When it arrives
    Then the frame is not decoded as a timetable

  Scenario: A malformed timetable is not decoded rather than partly used
    Given a timetable frame whose entry offsets do not increase
    When it arrives
    Then the frame is not decoded as a timetable
    And no part of the Window is executed

  Scenario: The timetable block leaves room under the radio's ceiling
    When a timetable frame is built
    Then it carries the timetable block appended after every existing field
    And the layout stays under the ESP-NOW frame limit

  # Outcome telemetry. The executor's verdict on the entry it consumed rides the
  # StatusReport back to the main node, so the author of a Table can see what became
  # of it. The block is APPENDED after the timetable block: nothing before it moves.

  Scenario: A status report carries the executor's outcome telemetry
    When sub-node 3 builds a status report carrying the verdict the executor reached
    Then the frame's outcome window, index, code, ran count, and refused count match
    And the outcome block is appended after the timetable block

  Scenario: The outcome record is published on change
    Given a node whose last entry was refused by the inter-cycle gap
    When the bridge builds the outcome payload
    Then it names the Window, the counters and the refusal by name
    And an unchanged verdict is not republished on its own

  Scenario: A status report with no verdict reports no window
    When sub-node 3 builds a status report before any entry has come due
    Then the frame's outcome window is 0
    And a window of 0 is not a Window the main node publishes
    And a Window whose identity is 0 is refused rather than executed

  # Forward compatibility. The gate accepts a newer schema at its full length, and
  # rejects anything older: a frame from an older schema may be missing a field this
  # firmware expects, and zero-filling it would invent a value nobody sent.

  Scenario: A frame from an older schema is rejected
    When an unupgraded frame arrives stamped with an older version
    Then the frame is rejected
