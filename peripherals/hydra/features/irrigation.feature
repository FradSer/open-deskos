Feature: Soil-driven automatic irrigation with pulse watering
  As a home gardener
  I want each watering zone to keep its soil within a healthy moisture band
  So that plants are watered automatically without flooding or drought

  Background:
    Given a zone configured for summer with dry threshold 35% and wet target 80%
    And pulse watering with 5 seconds ON, 40 seconds OFF, maximum 12 pulses
    And a pump accumulated safety limit of 75 seconds
    And a minimum interval of 4 hours between watering cycles

  Scenario: Dry soil starts a pulse cycle
    Given the zone is idle
    And the soil moisture reads 30%
    And watering is allowed
    When the controller ticks
    Then the pump turns on (pulse 1 begins)

  Scenario: Pulse ON phase ends after configured ON duration
    Given a pulse has been ON for 5 seconds
    And the soil moisture reads 40%
    When the controller ticks
    Then the pump turns off (soak phase begins)

  Scenario: Soak phase transitions to next pulse
    Given the pump is in soak phase
    And 40 seconds have elapsed since the pulse turned off
    And the soil moisture reads 45%
    And fewer than 12 pulses have been delivered
    When the controller ticks
    Then the pump turns on (next pulse begins)

  Scenario: Cycle completes when soil reaches wet target during soak
    Given the pump is in soak phase
    And the soil moisture reads 82%
    When the controller ticks
    Then the cycle ends
    And the pump stays off
    And the pulse counter resets

  Scenario: Cycle completes after delivering all pulses
    Given 12 pulses have been delivered
    And the pump is in soak phase
    When the controller ticks
    Then the cycle ends
    And the pump stays off

  Scenario: Accumulated ON time safety cap stops the cycle
    Given the accumulated pump ON time in this cycle reaches 75 seconds
    And the soil moisture still reads 50%
    When the controller ticks
    Then the cycle ends immediately
    And the pump turns off

  Scenario: Invalid soil reading during pulse ON ends the cycle
    Given the pump is in pulse ON phase
    And the soil moisture reading becomes invalid
    When the controller ticks
    Then the cycle ends immediately
    And the pump turns off

  Scenario: Invalid soil reading during soak phase ends the cycle
    Given the pump is in soak phase
    And the soil moisture reading becomes invalid
    When the controller ticks
    Then the cycle ends immediately

  Scenario: Minimum interval blocks a new cycle
    Given a cycle ended 2 hours ago
    And the soil moisture reads 30%
    When the controller ticks
    Then the pump stays off

  Scenario: Minimum interval elapsed allows a new cycle
    Given a cycle ended 4 hours ago
    And the soil moisture reads 30%
    And watering is allowed
    When the controller ticks
    Then the pump turns on (new cycle begins)

  # A pot whose probe cannot see the water is disarmed by its own cycle: the soil never comes
  # back above the trigger, so the zone waits instead of firing again when the minimum gap
  # lapses. One field zone ran four cycles in a day like that, with its probe moving +0.5, 0.0
  # and -0.2 %, and its settled reading lower than when the cycle started.

  Scenario: A cycle the probe never saw disarms the zone
    Given a zone whose soil stayed under its dry threshold through the last cycle
    When the minimum gap lapses
    Then the zone does not start another cycle

  Scenario: Recovery arms the zone again
    Given a disarmed zone
    When the soil comes back above the dry threshold by a margin
    And it then falls below the threshold again
    Then the zone starts a cycle

  Scenario: A retry is not refused forever
    Given a disarmed zone whose soil stayed dry
    When the fault window has passed since the cycle ended
    Then the zone may try once more
    And repeated weak cycles still reach the fault that tells a human to look

  # Saturation is the failure that kills the plant; an early stop is one it recovers from. The
  # wet cap is read from the same probe that missed the last cycle, so an unconfirmed probe does
  # not get the benefit of the doubt about it.

  Scenario: An unconfirmed probe narrows the dose, not the trigger
    Given a zone whose last cycle the probe did not register
    And its soil falls below the dry threshold again
    When the controller ticks
    Then the pump runs
    But the cycle stops short of the seasonal wet ceiling
    And a zone whose absorption is confirmed still runs the full profile

  # Care quality, not economy. The plant's own guidance is "water in the morning and keep the
  # foliage dry overnight": a free-moisture film through a warm humid night is the fungal
  # infection window, and substrate that stays wet through a low-evaporation night is the rot
  # regime. The same guidance prefers a narrow band checked often over a wide dry-then-soak
  # swing -- which is a statement about the DOSE, not about the trigger.

  Scenario: Routine watering waits for the morning
    Given the time-of-day gate is open
    And the local hour is in the afternoon
    And the soil sits just under the dry threshold
    When the controller ticks
    Then the pump stays off
    And the pot can hold until morning

  Scenario: A deeply dry pot does not wait for the morning
    Given the time-of-day gate is open
    And the local hour is in the afternoon
    And the soil is further below the threshold than the deep-dry margin
    When the controller ticks
    Then the pump turns on

  Scenario: An unknown hour still only lets critical dryness through
    Given the clock has gone stale, so the hour is unknown
    And the soil is further below the threshold than the deep-dry margin
    When the controller ticks
    Then the pump stays off
    And only the critical threshold would start it

  Scenario: The device's own dose is a nudge at the low edge of the band
    Given a pot that was watered within the day and whose absorption is confirmed
    And its soil sits at the low edge of its band
    When the controller ticks
    Then a top-up runs: fewer pulses than the seasonal profile allows
    And a pot that has gone a long time without water still gets the full profile
    And an unconfirmed probe never gets the nudge

  Scenario: Critical dryness is never disarmed
    Given a disarmed zone
    When its soil reaches the critical threshold
    Then the pump turns on

  Scenario: A single weak cycle does not fault
    Given a cycle completed with at least one pulse delivered
    And the soil moisture peak rose less than the efficacy delta during the cycle
    And no prior consecutive weak cycles
    When the cycle ends
    Then no pump fault is flagged
    And the weak-cycle streak is 1

  # Regression: the EndCycle reading lags percolation/EMA and reads as a trough,
  # but water did reach the probe mid-cycle. Judgment uses the cycle peak, not the
  # EndCycle instant, so an effective cycle is not false-faulted.
  Scenario: An effective cycle is judged by its peak, not the EndCycle trough
    Given a cycle completed with at least one pulse delivered
    And the soil peaked at least the efficacy delta above its start mid-cycle
    And the EndCycle reading fell back below the efficacy delta
    When the cycle ends
    Then no pump fault is flagged
    And the weak-cycle streak resets to 0

  Scenario: Consecutive weak cycles flag a fault
    Given two consecutive weak cycles have already been recorded
    And another cycle completed with the soil peaking less than the efficacy delta
    When the cycle ends
    Then a pump fault is flagged
    And the display shows FAULT

  Scenario: A good cycle resets the weak-cycle streak
    Given two consecutive weak cycles have already been recorded
    And a cycle completed with the soil peaking at least the efficacy delta
    When the cycle ends
    Then no pump fault is flagged
    And the weak-cycle streak resets to 0

  Scenario: An unjudgeable cycle neither faults nor resets the streak
    Given a cycle ended with an invalid soil reading or zero pulses
    When the cycle ends
    Then no pump fault is flagged
    And the weak-cycle streak is unchanged

  Scenario: A fault auto-clears after the retry window
    Given a pump fault has been active for the full retry window
    When the controller ticks
    Then the fault is cleared automatically
    And the weak-cycle streak resets to 0
    And normal operation resumes

  Scenario: Fault can still be cleared manually before the retry window
    Given a pump fault is active
    When the user presses BtnA
    Then the fault is cleared
    And the weak-cycle streak resets to 0
    And normal operation resumes

  Scenario: Watering is blocked when not allowed
    Given the zone is idle
    And the soil moisture reads 25%
    And watering is not allowed
    When the controller ticks
    Then the pump stays off

  Scenario: A scheduled night does not interrupt an active pulse cycle
    Given a pulse cycle is in progress (pulse 3 of 12)
    And the valid clock moves outside the watering window
    When the controller ticks
    Then the pulse cycle continues uninterrupted

  Scenario: A stale main clock safely aborts a noncritical active cycle
    Given a routine pulse cycle began under a valid daytime EnvBroadcast
    And the environment broadcast stays absent for the full stale window
    And the current soil moisture is above critical threshold
    When the runtime invalidates the stale clock and the controller ticks
    Then the pump turns off immediately
    And the cycle returns to IDLE with WAIT displayed
    And no later pulse begins until trusted daytime is restored

  Scenario: Critical soil may finish an active cycle after the main clock is stale
    Given an active pulse cycle has current soil moisture below critical threshold
    And the environment broadcast stays absent for the full stale window
    When the runtime invalidates the stale clock and the controller ticks
    Then the critical cycle remains eligible to continue

  Scenario: Manual pump toggle cancels in-progress pulse cycle
    Given a pulse cycle is in progress (pulse 4 of 12)
    When the user presses BtnB (manual pump toggle)
    Then auto mode is paused
    And the pulse state is reset (counter and accumulated time)
    And the pump is driven by manual control

  Scenario: Pausing auto mode resets pulse state but preserves cooldown
    Given a pulse cycle is in progress
    When the user presses BtnA (pause)
    Then the pump turns off
    And the pulse counter resets
    And the last-cycle-ended time is preserved for cooldown

  Scenario: Morning window allows watering
    Given the current time is 07:30 (morning window)
    And the zone is idle
    And the soil moisture reads 30%
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump turns on (pulse 1 begins)

  Scenario: Evening window allows watering
    Given the current time is 17:30 (evening window)
    And the zone is idle
    And the soil moisture reads 30%
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump turns on (pulse 1 begins)

  Scenario: Night blocks watering
    Given the current time is 22:00 (outside active hours 6-21)
    And the zone is idle
    And the soil moisture reads 30%
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump stays off (WAIT state displayed)

  Scenario: Time-blocked status remains local to each zone
    Given two idle zones on a valid clock at 22:00 (outside active hours 6-21)
    And zone 1 soil moisture reads 45% (at or below dry threshold but above critical)
    And zone 2 soil moisture reads 60% (above dry threshold)
    When the controller ticks
    Then zone 1 displays WAIT
    And zone 2 displays IDLE

  Scenario: A controller snapshot carries one zone's reportable state
    Given an idle zone with a valid 60% soil reading
    When the controller ticks
    Then its snapshot contains 60% soil
    And its snapshot reports IDLE and zero pulses
    And its snapshot contains the effective dry threshold and season

  Scenario: Local and remote force ownership overlap safely
    Given remote force watering is active
    And local hold force watering starts
    When remote force ends while local hold remains active
    Then the pump stays on
    And automatic irrigation remains paused
    When local hold ends
    Then the pump turns off
    And automatic irrigation resumes

  Scenario: Winter dormancy rejects local hold force watering
    Given the current month is January (winter) with a valid clock
    And the zone is idle
    When local hold force watering starts
    Then the pump stays off
    And the zone displays DORMANT instead of WATER

  Scenario: Winter dormancy rejects remote force watering
    Given the current month is January (winter) with a valid clock
    And the zone is idle
    When remote force watering starts
    Then the pump stays off
    And the zone displays DORMANT instead of WATER

  Scenario: Winter selection clears an active forced pump
    Given local or remote force watering is active under the summer configuration
    And the clock transitions to January while the forced zone runtime is idle
    When the controller ticks and selects the winter configuration
    Then every forced-pump owner is cleared
    And the pump turns off and displays DORMANT

  Scenario: Critical dryness overrides time block
    Given the current time is 22:00 (outside active hours 6-21)
    And the zone is idle
    And the soil moisture reads 25% (below critical threshold 35%)
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump turns on (emergency watering)

  # Clock safety: before the first valid EnvBroadcast, or once a valid broadcast
  # grows stale, an invalid clock is treated as night. Routine watering waits for
  # trusted time; only critical dryness may override.

  Scenario: Invalid clock blocks routine watering
    Given the clock is invalid (cold boot, no EnvBroadcast received yet)
    And the zone is idle
    And the soil moisture reads 40% (above critical threshold 35%)
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump stays off (WAIT state displayed)

  Scenario: Invalid clock still allows emergency watering below critical
    Given the clock is invalid (cold boot, no EnvBroadcast received yet)
    And the zone is idle
    And the soil moisture reads 25% (below critical threshold 35%)
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump turns on (autonomous emergency watering)

  Scenario: Stale main time blocks routine watering but not critical dryness
    Given the clock was valid at 14:30 from EnvBroadcast
    And the environment broadcast has been stale for the full stale window
    And one idle zone soil moisture reads 40% (above critical threshold 35%)
    And another idle zone soil moisture reads 25% (below critical threshold 35%)
    When the controller ticks
    Then the stale clock is invalid
    And the routine-dry zone displays WAIT
    But the critical-dry zone starts emergency watering

  # A closed gate is reported as WAIT whenever the zone is dry against the
  # environment-modulated effective threshold, not only against the unmodulated
  # seasonal one. Between the two thresholds a blocked zone used to report IDLE,
  # which made a long gate stall indistinguishable from a zone that simply had
  # nothing to do.
  Scenario: A closed gate over a zone dry against the modulated threshold displays WAIT
    Given the current time is 22:00 (outside active hours 6-21)
    And a fresh environment broadcast reports 2.5 kPa VPD, raising the effective dry threshold to 55%
    And one idle zone soil moisture reads 52% (above the seasonal dry threshold, below the effective one)
    And another idle zone soil moisture reads 60% (above both)
    When the controller ticks
    Then the pump stays off on both zones
    And the dry-against-effective zone displays WAIT
    But the dry-against-neither zone displays IDLE

  Scenario: Fresh main time restores the normal gate after staleness
    Given the clock was invalidated by a stale environment broadcast
    When a fresh EnvBroadcast arrives with time 16:00
    Then the clock snaps to 16:00 and becomes valid
    And routine watering follows the normal daytime gate again

  Scenario: Autumn reduces watering (October)
    Given the current month is October (autumn)
    And the zone is idle
    And the soil moisture reads 25%
    And watering is allowed
    When the controller ticks
    Then the pump turns on with autumn config (dry 50%, wet 70%, max 10 pulses)

  Scenario: Winter dormancy disables watering (January)
    Given the current month is January (winter)
    And the zone is idle
    And the soil moisture reads 10%
    And watering is allowed
    When the controller ticks
    Then the pump stays off (dormancy)

  Scenario: Winter dormancy blocks a zero-percent critical reading without emergency override
    Given the current month is January (winter) with a valid clock
    And the zone is idle
    And the soil moisture reads 0%
    When the controller ticks
    Then the pump stays off (dormancy)
    And no critical-dry override is reported
    When the clock becomes invalid and the controller ticks again
    Then the pump stays off (dormancy)
    And no critical-dry override is reported

  Scenario: Winter dormancy safely ends a prior active cycle at zero soil
    Given a winter dormant configuration applies to an active pulse or soak phase
    And the soil moisture reads 0%
    And the trusted clock has become stale
    When the controller ticks
    Then the pump turns off immediately
    And the cycle ends without starting another pulse

  # Seasonal default on boot with no clock: a sub-node that boots before the main
  # node has synced time has an invalid clock, so it cannot read the month. The
  # default season is Summer (NOT Winter): the time-of-day gate already blocks
  # routine watering on an invalid clock, and Summer keeps disabled=false + the
  # real criticalPercent so the critical-dry emergency override stays alive.
  # Defaulting to Winter would set disabled=true, which decidePump short-circuits
  # before the critical override.

  Scenario: Boot with invalid clock blocks routine watering but keeps critical override
    Given the clock is invalid (cold boot, no EnvBroadcast received yet)
    And the zone is idle
    And the soil moisture reads 30% (above critical threshold 35%)
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump stays off (time gate treats invalid clock as night)

  Scenario: Boot with invalid clock still emergency-waters below critical
    Given the clock is invalid (cold boot, no EnvBroadcast received yet)
    And the zone is idle
    And the soil moisture reads 25% (below critical threshold 35%)
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump turns on (critical override survives unknown season)

  Scenario: Real winter with valid clock still blocks critical (dormancy)
    Given the current month is January (winter) with a valid clock
    And the zone is idle
    And the soil moisture reads 25% (below critical threshold 35%)
    And the minimum interval has elapsed
    When the controller ticks
    Then the pump stays off (dormancy disables even critical)

  Scenario: Season holds last-known-good while the clock is intermittent
    Given the clock was valid last month (October, autumn) and is now invalid
    And the zone is idle
    When the controller ticks
    Then the active season remains autumn (no flap to default on stale clock)

  Scenario: Spring ramps up watering (April)
    Given the current month is April (spring)
    And the zone is idle
    And the soil moisture reads 28%
    And watering is allowed
    When the controller ticks
    Then the pump turns on with spring config (dry 55%, wet 73%, max 12 pulses)

  Scenario: Seasonal config latches at idle only
    Given a pulse cycle is in progress
    And the month transitions from summer to autumn
    When the controller ticks
    Then the current cycle continues with summer config
    And the next cycle uses autumn config

  Scenario: Transient ADC noise does not mark zone NC
    Given the zone was returning valid soil readings
    And a single noisy sample has high spread (cheap charger ripple)
    When the zone reads soil
    Then the zone returns the last known-good reading
    And the zone is not marked NC

  Scenario: Sustained ADC noise marks zone NC
    Given the zone has received consecutive invalid readings equal to the threshold
    When the zone reads soil
    Then the zone is marked NC

  Scenario: Slew rate limiter prevents unrealistic jumps
    Given the zone was returning valid soil readings at 1800 raw
    And a new reading produces 1850 raw after EMA smoothing
    And the slew rate limit is 15 counts per tick
    When the zone reads soil
    Then the raw value is clamped to 1815
    And the percent is calculated from the clamped value

  Scenario: Slew rate limiter allows normal moisture changes
    Given the zone was returning valid soil readings at 1800 raw
    And a new reading produces 1810 raw after EMA smoothing
    And the slew rate limit is 15 counts per tick
    When the zone reads soil
    Then the raw value remains 1810
    And the percent is calculated normally

  # Environmental modulation: the main node broadcasts VPD/lux; the sub-node fuses
  # them with its own locally-derived soil drying rate to shift the dry threshold.
  # The two halves are independently valid so an offline main node never silences
  # the sub-node's own signal (the autonomous-watering guarantee).

  Scenario: High VPD waters earlier
    Given a fresh env broadcast with VPD above the high threshold
    When the watering decision is evaluated
    Then the effective dry threshold is raised

  # The band's own dry edge is a FLOOR on the trigger. "Humid" and "dim" describe how fast the
  # pot loses water -- a reason to water EARLIER than the edge when the air is hot and dry, never
  # a reason to let a pot sit below the edge the plant actually needs. Left unclamped the two
  # adjustments did exactly that: on a dim humid morning the trigger read 45 % against a band edge
  # of 50, and a pot at 47.3 % satisfied neither the device nor the author.

  Scenario: Humid air does not lower the trigger below the band's edge
    Given a fresh env broadcast with VPD below the low threshold
    When the watering decision is evaluated
    Then the effective dry threshold is the band's own edge

  Scenario: Dim light does not lower the trigger below the band's edge
    Given a fresh env broadcast with lux below the dim threshold
    When the watering decision is evaluated
    Then the effective dry threshold is the band's own edge

  Scenario: A pot below the band's edge is watered whatever the weather says
    Given the air is humid and the light is dim
    And the soil reads just under the band's dry edge
    When the watering decision is evaluated
    Then the pump turns on

  Scenario: A hot dry afternoon still waters before the edge
    Given a fresh env broadcast with VPD above the high threshold
    And a pot drying at a rate this fleet really sees
    When the watering decision is evaluated
    Then the effective dry threshold is above the band's edge

  Scenario: A dead light sensor does not suppress watering
    Given a fresh env broadcast whose lux is marked invalid
    When the watering decision is evaluated
    Then the lux adjustment is not applied

  Scenario: A fast-drying plant waters earlier even with the main node offline
    Given no fresh env broadcast (the main node is offline)
    And the local soil drying rate is faster than the threshold
    When the watering decision is evaluated
    Then the effective dry threshold is raised by the drying-rate adjustment

  Scenario: Stale wire env suppresses VPD but keeps the local drying signal
    Given the last env broadcast is older than the stale window
    And the air would otherwise read as very dry
    And the local soil drying rate is fast
    When the watering decision is evaluated
    Then the VPD and lux adjustments are not applied
    But the drying-rate adjustment is still applied

  Scenario: Within the VPD deadband the threshold is unchanged
    Given a fresh env broadcast with VPD between the low and high thresholds
    When the watering decision is evaluated
    Then the effective dry threshold equals the base

  Scenario: VPD and drying-rate adjustments stack
    Given a fresh env broadcast with VPD above the high threshold
    And the local soil drying rate is faster than the threshold
    When the watering decision is evaluated
    Then both the VPD and drying-rate adjustments raise the effective dry threshold

  # The drying-rate term used to be a step below -5 %/hr, and this fleet's pots dry at 0.2-0.4
  # %/hr -- so it contributed exactly nothing and only the VPD step moved the threshold, which
  # is how the trigger became noise that flaps across 1.5 kPa instead of a drying signal.

  Scenario: The drying-rate adjustment scales with how fast the pot is actually drying
    Given the pot is drying at a rate this fleet really sees
    And no fresher env broadcast exists
    When the watering decision is evaluated
    Then the effective dry threshold is raised in proportion to the rate
    And a steeper rate raises it further

  Scenario: The drying-rate adjustment has a noise floor and a cap
    Given a drying rate at the noise floor
    When the watering decision is evaluated
    Then the threshold is unchanged
    Given a steeply drying pot
    When the watering decision is evaluated
    Then the raise is capped, so one noisy slope cannot move the threshold far
