Feature: A Service Plugin's data keeps arriving for as long as the service does

  # The shell listens for the plugin and the plugin publishes; nothing here polls
  # a provider. These scenarios are about the seam staying answerable over time:
  # a listener that failed to bind is not a running listener, a declaration that
  # moved is followed, and a plugin that went away stops claiming to be live.

  Scenario: A service that could not listen is asked again
    Given a declared service whose endpoint cannot be bound
    When the obstacle is gone and the Shell refreshes its services
    Then the Shell listens on that endpoint
    And a plugin connecting there is answered

  Scenario: One service that cannot listen does not silence the others
    Given two declared services and an endpoint that cannot be bound for the first
    When the Shell refreshes its services
    Then the second service is listening
    And the refresh still states why the first one is not

  Scenario: A declaration that moved is followed
    Given a declared service the Shell is already listening for
    When its declaration names a different endpoint
    Then the Shell listens on the new endpoint
    And the previous endpoint is no longer served

  Scenario: A plugin that went away stops claiming to be live
    Given a service that published a snapshot
    When the plugin's connection closes
    Then the service reports its last measurement as stale rather than live
    And that measurement is still available to be shown dimmed

  Scenario: A plugin that comes back is live again
    Given a service whose plugin connection closed
    When the plugin reconnects and publishes again
    Then the service reports live

  Scenario: One desk that dropped does not stop the others
    Given a poller feeding two desks and one desk's connection has been reset
    When the poller publishes a snapshot
    Then the desk that is still reachable receives it
    And the reset desk is reported as the failure it is

  Scenario: A removed catalog declaration is withdrawn from the Shell
    Given the Shell has refreshed an installed service declaration
    When that declaration is absent from a later readable catalog
    Then the Shell stops listening for that service
    And Desk Data no longer lists the removed service

  Scenario: Shell services stop when the application quits
    Given the Shell has started its Remote, Hydra, and service sources
    When Electron emits before-quit
    Then each source stops exactly once

  Scenario: A pending service listen cannot resurrect after quit
    Given the Shell is starting a declared service listener
    When the application stops before that listener finishes
    Then the listener closes as soon as it finishes
    And the stopped Shell has no service listener

  Scenario: An explicit service start restarts after stop
    Given the Shell has stopped its service listener
    When the Shell explicitly starts the service again
    Then the service listener is available again

  Scenario: An unreadable catalog cannot prove a service was removed
    Given the Shell has refreshed an installed service declaration
    When a later catalog read fails
    Then the last successfully read service declaration remains available
