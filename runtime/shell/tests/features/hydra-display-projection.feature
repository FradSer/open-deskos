Feature: A display-only host renders the resident Hydra projection

  Windows has no local Hydra controller. The resident agent publishes the
  current Hydra reading through the authenticated status channel. The Desk
  Widget must render that projection instead of its empty local snapshot.

  Scenario: The Hydra Widget uses the status-channel projection
    Given the local Hydra source reports unconfigured
    When the status channel carries a live Hydra projection
    Then the Hydra IPC handler returns that projection
    And the Widget shows live readings instead of Unconfigured

  Scenario: A stale status projection cannot show invented readings
    Given the status channel carries an invalid Hydra projection
    Then the handler does not publish it as live data
