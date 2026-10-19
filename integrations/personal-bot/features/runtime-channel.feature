Feature: Bounded requests over runtime channels
  Scenario: CM5 owns the shared Personal Agent
    Given CM5 runs the resident Personal Agent
    And the Windows display uses its authenticated local channel and a restricted SSH connection
    When either display sends a new owner request
    Then CM5 alone admits the request and generates its owner identity
    And both displays receive the same conversation, task, and briefing state
    And connection recovery subscribes without replaying an owner request
    And Windows does not initialize a model or transcribe audio

  Scenario: Batched input retains the limit for each command
    Given two valid commands arrive in one bounded transport batch
    When each command is smaller than the input frame limit
    Then both commands reach the service in their original order
    And an oversized command or unfinished frame closes its connection

  Scenario: Concurrent services publish only complete authentication tokens
    Given a service has opened its candidate token but has not written its bytes
    When another service requests the same host token
    Then both services receive the same complete token
    And neither service overwrites a published token

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
