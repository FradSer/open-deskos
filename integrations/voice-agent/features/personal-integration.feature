Feature: Personal assistant integration with the resident voice service
  Scenario: Personal assistant cannot bypass transaction tools
    Given a configured personal profile with reviewed skills
    When its SDK session options and resources are loaded
    Then no native filesystem or shell tools are enabled
    And coding project instructions and coding sessions are not inherited

  Scenario: Only accepted current speech authorizes a tool mutation
    Given an idle personal agent and a pending confirmation
    When the actual user transcript is accepted
    Then that exact transcript reaches the transaction gate before model execution
    And authorization is cleared after success or failure
    And a concurrent rejected prompt cannot change authorization

  Scenario: Background ride changes reach idle feedback safely
    Given a ride is being tracked
    When its state changes while the voice service is busy
    Then feedback is deferred until the current request settles
    And the transcript is preserved
    And shutdown suppresses late notifications

  Scenario: Failed requests do not invite duplicate purchases
    Given a request might have reached a remote transaction service
    When voice processing fails
    Then recovery asks the user to query order status before another order
