Feature: Remove selected sample widgets

  Scenario: Keep the built-in Weather tile while removing the extra sample
    Given Home contains the built-in Weather tile and CM5 has the weather-widget sample installed
    When the selected sample widgets are removed
    Then Home keeps odk.tile.weather and removes odk.tile.camera
    And Desk removes odk.tile.chat and odk.tile.settings while keeping Hydra
    And the weather-widget installation is absent while built-in weather data remains available
