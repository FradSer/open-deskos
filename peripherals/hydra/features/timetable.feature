Feature: Timetable watering
  The model authors a Timetable once per Window and a program on the sub-node executes
  it. The Window owns the routine trigger for its whole length, so the device's own
  threshold loop stands down inside it and resumes the moment it expires or no Timetable
  has arrived. A Timetable entry is an intent, never pulse parameters (ADR-0002), and the
  device clamps it with the seasonal preset the author declared.

  Executing a Timetable never reads the device clock: entries carry offsets from receipt,
  because a sub-node has no RTC and would otherwise lose the plan exactly when the hub
  went quiet.

  Scenario: No Timetable leaves the local loop in charge
    Given no Timetable has arrived for a zone
    When the executor is asked what to do
    Then the zone does not own the trigger from a Timetable
    And no entry is due

  Scenario: A Timetable owns the trigger for its whole Window
    Given a Timetable with one entry one hundred minutes from receipt
    When the executor is asked what to do ten minutes after receipt
    Then the Timetable owns the trigger
    And no entry is due

  Scenario: A Timetable of no entries waters nothing and still owns the trigger
    Given a Timetable with no entries
    When the executor is asked what to do ten minutes after receipt
    Then the Timetable owns the trigger
    And no entry is due
    And the zone waters nothing for the Window

  Scenario: An entry starts its intent at its own offset
    Given a Timetable with a top-up entry ten minutes from receipt
    When the executor is asked what to do ten minutes after receipt
    Then the top-up entry is due and may start

  Scenario: An entry starts without any soil dryness
    Given a Timetable with a standard entry ten minutes from receipt
    And a valid soil reading well above every threshold
    When the executor is asked what to do ten minutes after receipt
    Then the standard entry is due and may start

  Scenario: An entry is attempted once and never re-offered
    Given a Timetable with an entry ten minutes from receipt
    When the executor is asked what to do at ten minutes and again at eleven minutes
    Then the entry is offered only at ten minutes

  Scenario: An entry refused by the inter-cycle gap is discarded rather than deferred
    Given a Timetable with an entry ten minutes from receipt
    And the last pulse cycle ended inside the minimum gap
    When the executor is asked what to do at ten minutes and again at eleven minutes
    Then the entry is refused at ten minutes
    And the entry is not offered again at eleven minutes
    And the Window still owns the trigger

  Scenario: A dormant season refuses every entry
    Given a Timetable whose declared season is dormant
    And a Timetable with an entry ten minutes from receipt
    When the executor is asked what to do ten minutes after receipt
    Then the entry is refused
    And the Window still owns the trigger

  Scenario: An unreadable probe refuses an entry
    Given a Timetable with an entry ten minutes from receipt
    And the soil reading is invalid
    When the executor is asked what to do ten minutes after receipt
    Then the entry is refused

  Scenario: A manual force refuses an entry without suspending the Window
    Given a Timetable with an entry ten minutes from receipt
    And a manual force is active for the zone
    When the executor is asked what to do ten minutes after receipt
    Then the entry is refused
    And the Window still owns the trigger
    And the next entry is still scheduled

  Scenario: A running pulse cycle is not interrupted by a due entry
    Given a Timetable with an entry ten minutes from receipt
    And the zone is already running a pulse cycle
    When the executor is asked what to do ten minutes after receipt
    Then the entry is refused
    And the running cycle is left to finish

  Scenario: The Window expires and hands the trigger back
    Given a Timetable with an entry ten minutes from receipt
    When the executor is asked what to do at two hundred and forty minutes
    Then the zone does not own the trigger from a Timetable
    And the local loop decides again

  Scenario: A redelivered Timetable for the same Window does not re-arm the schedule
    Given a Timetable with an entry ten minutes from receipt, for window one hundred
    And the entry has already been attempted
    When the same Window arrives again
    Then the Timetable is not replaced
    And the entry is not offered again

  Scenario: A newer Window replaces the live one
    Given a Timetable for window one hundred with an entry ten minutes out
    When a Timetable for window one hundred and one arrives with an entry five minutes out
    Then the newer Window is in force
    And its entry is due at five minutes from its own receipt

  Scenario: A malformed Timetable is rejected whole
    Given a Timetable that is malformed
    When it arrives
    Then the Timetable is not accepted
    And no part of it is executed

  Scenario: A rejected Timetable leaves a held Window running
    Given a live Timetable with an entry ten minutes from receipt
    When a malformed Timetable arrives
    Then the malformed Timetable is not accepted
    And the live Window still owns the trigger

  Scenario: The declared season bounds the entry, not the device clock
    Given a Timetable whose declared season is summer
    And the device's own clock season is autumn
    When an entry is due
    Then the summer preset bounds the cycle

  Scenario: Offsets are measured from receipt and never from a clock
    Given a Timetable accepted at an arbitrary instant
    When the same elapsed time passes from a different instant
    Then the same entry is due at the same elapsed offset

  # The night marker. It is parsed, carried on the wire, and shown on the serial line,
  # but it is never a gate: ADR-0006 keeps every policy clamp out of code, so a night
  # entry still starts its cycle.

  Scenario: A night entry still starts its cycle
    Given a Timetable with a standard entry ten minutes from receipt, marked night
    When the executor is asked what to do ten minutes after receipt
    Then the standard entry is due and may start
    But its night marker is carried and never consulted

  Scenario: The started entry carries its Window, index, offset, intent and marker
    Given a Timetable for window one hundred with a top-up entry five minutes out and a standard entry ninety-five minutes out marked night
    When the executor starts both entries
    Then the first start names window one hundred and entry zero
    And the second start names entry one, its own offset, intent and night marker

  # The outcome the author reads back. Everything here is per Window, because the wire
  # names the Window the verdict belongs to.

  Scenario: A live Window with nothing consumed reports no verdict
    Given a Timetable with an entry ten minutes from receipt
    When the executor is asked what to do five minutes after receipt
    Then the last outcome reports no Window

  Scenario: An entry that ran is recorded in the outcome
    Given a Timetable with a standard entry ten minutes from receipt
    When the executor starts that entry
    Then the last outcome names the Window, entry zero, and the ran code
    And the Window's ran count is one

  Scenario: A refused entry is recorded with the code that refused it
    Given a Timetable with an entry ten minutes from receipt
    And the soil reading is invalid
    When the executor is asked what to do ten minutes after receipt
    Then the last outcome's code is the probe refusal
    And the Window's refused count is one

  Scenario: A newer Window starts its counters over and reports no verdict
    Given a live Timetable for window one hundred whose entry has already run
    When a Timetable for window one hundred and one arrives
    Then the new Window reports no verdict until one of its entries is consumed

  Scenario: Each refusal the wire spells has a name
    Given the executor's refusal codes
    Then RAN names the code for an entry that ran
    And DORMANT, PROBE, FORCE, MIN_GAP and BUSY name the five refusals

  # The controller's half of the contract. The executor says what the Window wants; these
  # are the behaviours the zone shows because of it, at the seam the device presents.

  Scenario: A live Timetable stands the device's own threshold down
    Given a zone whose soil is below its dry threshold
    And a live Timetable that waters nothing
    When the controller ticks
    Then the zone does not pump
    And it is not the gate that stopped it

  Scenario: A Timetable entry starts a cycle without any dryness
    Given a zone whose soil is well above every threshold
    And a Timetable with an entry due now
    When the controller ticks
    Then the zone starts a pulse cycle

  Scenario: Critical dryness still starts a cycle inside a live Timetable
    Given a zone whose soil is at or below the critical threshold
    And a live Timetable that waters nothing
    When the controller ticks
    Then the zone starts a pulse cycle

  Scenario: A live Timetable hands the trigger back when it expires
    Given a zone whose soil is below its dry threshold
    And a Timetable that has run its four hours
    When the controller ticks
    Then the zone starts a pulse cycle on its own threshold

  Scenario: The controller reports the outcome the executor decided
    Given a Timetable with an entry due now
    When the controller ticks
    Then the snapshot names the outcome Window, the entry, and the ran code

  Scenario: The controller hands the started entry to its composition root once
    Given a Timetable with an entry due now, marked night
    When the controller ticks
    Then its one-shot notice names the Window, the index, the offset, the intent, and night
    And the notice is not offered again

  Scenario: A refused entry is reported with its refusal code and no start notice
    Given a Timetable with an entry due now
    And a manual force owns the zone
    When the controller ticks
    Then the snapshot names the force refusal
    And no start notice is filed