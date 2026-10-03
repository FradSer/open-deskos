Feature: Bounded requests over runtime channels
  Scenario: Authenticate a named pipe override
    Given a named pipe endpoint supplied on a Unix host
    When a client decides whether ownership authenticates the endpoint
    Then the channel requires a token

  Scenario: Cancel before opening a connection
    Given a request whose signal was already aborted
    When the runtime channel receives the request
    Then it reports cancellation without opening a connection

  Scenario: Refuse an incomplete response without waiting for the deadline
    Given a peer that sends no complete response line
    When the peer closes its connection
    Then the request fails immediately with a closed-channel reason
