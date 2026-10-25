Feature: Local soil drying-rate signal
  As a watering sub-node that must stay autonomous when the main node is offline
  I want to derive how fast my own soil is drying from a local sample history
  So that I can water earlier for a thirsty plant without depending on the hub

  # SoilHistory<N> is a per-zone ring of soil% samples. The drying rate is the
  # least-squares slope of soil% over the window, in %/hour (negative = drying,
  # positive = wetting after a watering cycle). It is a purely local signal -- it
  # needs no main node -- so it keeps modulating decidePump even when the hub is down.

  Scenario: A fresh history has no rate yet
    Given a soil history with no samples
    Then the drying rate is not yet valid
    And the drying rate reads zero

  Scenario: One sample is not enough to derive a rate
    Given a soil history with a single sample
    Then the drying rate is not yet valid

  Scenario: Two samples make the rate valid
    Given a soil history with two samples an hour apart
    Then the drying rate is valid

  Scenario: Falling soil yields a negative (drying) rate
    Given soil that fell 10% over two hours
    Then the drying rate is about -5 %/hour

  Scenario: Rising soil yields a positive (wetting) rate
    Given soil that rose 12% over one hour
    Then the drying rate is about +12 %/hour

  Scenario: A span shorter than the minimum yields no rate
    Given two samples only 30 seconds apart
    Then the drying rate reads zero

  Scenario: The rate is the least-squares slope across the whole window
    Given four samples whose downward trend is noisy
    Then the drying rate reflects every sample, not just the endpoints

  Scenario: The window evicts the oldest sample once full
    Given more samples than the window holds
    Then the drying rate uses only the live window

  Scenario: The rate survives the millis() timer wrap
    Given two samples straddling the 49-day millis() rollover
    Then the drying rate is computed from the true elapsed time
