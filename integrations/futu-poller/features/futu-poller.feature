Feature: Futu poller desk links
  Scenario: A desk that closes its channel is retried as unavailable
    Given a configured desk connection closes after a record is written
    When the poller reads the desk response
    Then it treats the record as undelivered
    And it releases the closed connection for the next poll
