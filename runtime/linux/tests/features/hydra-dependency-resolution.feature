Feature: Hydra MQTT dependency resolution
  Scenario: Load MQTT from its canonical package location
    Given MQTT resolves through a node_modules symlink to a pnpm package
    When a configured Hydra source starts without an inspector
    Then MQTT is loaded from the canonical entry path
    And the source connects and receives live Hydra readings

  Scenario Outline: Dependency failures remain contained and retryable
    Given MQTT <stage> fails when a configured Hydra source starts
    When the source is polled before 30 seconds have elapsed
    Then the source remains disconnected without another load attempt
    When the dependency is available and 30 seconds have elapsed
    Then the source retries and connects

    Examples:
      | stage            |
      | resolution       |
      | canonicalization |
      | loading          |

  Scenario: An unconfigured source does not load MQTT
    Given no Hydra broker URL is configured
    When the Hydra source starts and is polled
    Then no MQTT dependency is resolved or loaded
