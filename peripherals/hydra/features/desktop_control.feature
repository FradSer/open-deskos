Feature: Authenticated desktop irrigation control
  The desktop uses one encrypted gateway link and a separate control key.
  The local fleet keeps its physical controls and autonomous irrigation policy.

  Scenario: A generic raw peer sender cannot operate a pump
    Given a main node with an independent private control key
    When a packet has no valid HMAC or has a different gateway or main identity
    Then the main node performs no action and sends no control response

  Scenario: A command consumes one short device challenge
    Given a signed challenge request with a new command identifier
    When the main node issues a challenge for five seconds
    Then a matching signed command can execute once before the device deadline
    And retries return the cached acceptance without extending a watering lease
    And expired, conflicting, old boot, and replayed commands perform no action

  Scenario: Desktop watering has a finite device lease
    Given a confirmed watering request for at most thirty seconds
    When the desktop disconnects or the lease expires
    Then the main node releases only its desktop force owner
    And the sub-node stops that remote owner within its one second watchdog
    And independent physical controls remain available

  Scenario: A plan uses the existing device policy
    Given a complete relative four hour plan with at most four intent entries
    When the main node accepts the authenticated plan
    Then the whole plan must pass structural validation
    And main acceptance does not claim leaf installation or pump execution
    And a leaf installation observation identifies the same window and plan

  Scenario: Default firmware has no control authority
    Given no private control key in the main node
    When any desktop control packet arrives
    Then the main node remains telemetry only
