# Feature: Remote Bridge Transport Plugins and Host Arbitration

  Scenario: Remote Bridge Host dynamically loads transport plugins
    Given a Remote Bridge Host is initialized with transport plugins
    When the host starts
    Then it initializes and starts the highest-priority available transport
    And Unix domain socket clients receive the active link state

  Scenario: Remote Bridge fails over from USB CDC to wireless gateway
    Given both USB CDC and Wireless Gateway transports are registered
    When USB CDC connects
    Then the active transport is USB CDC with link state usb
    When USB CDC disconnects and Wireless Gateway is active
    Then the active transport transitions to wireless with link state wireless
    And the Unix domain socket connection is not closed
