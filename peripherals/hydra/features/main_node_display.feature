Feature: Main-node sensor hub display
  As a home gardener
  I want the main node screen to show the local environment at a glance
  So that I can read temperature, humidity, pressure and light without serial

  Scenario: First page shows the four environment metrics
    Given the main node has a valid ENV III and BH1750 reading
    When the display renders the first page
    Then temperature and humidity are shown large (primary)
    And atmospheric pressure in hPa is shown below
    And ambient light in lux is shown with an OK/LOW/BRIGHT status

  Scenario: Missing environment data shows placeholders
    Given the ENV III reading is invalid
    When the display renders the first page
    Then temperature, humidity and pressure show "--"

  Scenario: Missing light data keeps the rest of the page
    Given the ENV III reading is valid but the BH1750 is not responding
    When the display renders the first page
    Then temperature, humidity and pressure are still shown
    And the light field shows "-- lx"

  Scenario: Semantic environment values preserve valid and invalid readings
    Given valid environment metrics of 25.4 C, 61% humidity and 101325 Pa pressure
    When the display model is built
    Then it returns "25.4", "61" and "1013" for the primary values
    And it marks the environment valid
    But invalid environment metrics return "--" primary values and no VPD status

  Scenario Outline: Light status is classified from a valid lux reading
    Given valid light at <lux> lx
    When the display model is built
    Then the light text is "<text>"
    And the light status is <status>

    Examples:
      | lux   | text  | status |
      | 499   | 499   | LOW    |
      | 5000  | 5000  | OK     |
      | 30001 | 30001 | BRIGHT |

  Scenario Outline: VPD status is classified from valid environment metrics
    Given valid environment metrics with VPD <vpd> kPa
    When the display model is built
    Then the VPD text is "<text>"
    And the VPD status is <status>

    Examples:
      | vpd  | text | status |
      | 1.80 | 1.80 | DRY    |
      | 0.30 | 0.30 | HUMID  |
      | 1.00 | 1.00 | OK     |

  Scenario: Soil semantics distinguish valid readings from a disconnected probe
    Given an online node with valid 42% soil
    When the node display model is built
    Then the soil text is "42" with an OK status
    But an invalid soil reading has text "--" and NC status

  Scenario: Node connectivity is semantic state
    Given an offline node
    When the node display model is built
    Then it is marked offline
    And its display state is OFFLINE

  Scenario: Force watering overrides the last reported pump state
    Given an online node reporting IDLE
    When the main node is force-watering it
    Then the node display model pump state is WATER
