Feature: Ambient light sensing for caladium care
  As a home gardener
  I want the main node to report ambient light levels
  So that I can verify my caladiums receive bright indirect light (1000-10000 lux)

  Scenario: BH1750 reports lux on the main node
    Given the main node has a BH1750 on PaHub channel 5
    When the environment sensor reads
    Then the reading includes a valid lux value in the range 1-65535

  Scenario: BH1750 read failure reports invalid lux
    Given the BH1750 is not responding on I2C
    When the environment sensor reads
    Then the reading includes lux=0 with luxValid=false
    And the temperature and humidity are still valid from ENV III

  Scenario: Low light warning for caladium
    Given the lux reading is below 500 (insufficient indirect light)
    When the display renders
    Then the light level is shown as "LOW"

  Scenario: Direct sun warning for caladium
    Given the lux reading is above 30000 (direct sun risk)
    When the display renders
    Then the light level is shown as "BRIGHT"
