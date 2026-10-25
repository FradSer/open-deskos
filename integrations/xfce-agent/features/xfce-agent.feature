Feature: Isolated desktop task runtime
  Scenario: Load the canonical coordinator before fixture startup
    Given the coordinator uses the Personal Agent integration directory
    When the anonymous fixture entry starts without private arguments
    Then its coordinator imports resolve from that directory
    And it rejects missing configuration and output arguments
    And it creates no fixture files or worker process

  Scenario: Admit one desktop task idempotently
    Given a private runtime and a unique request ID
    When the same request is submitted twice
    Then both receipts identify the same task
    And another payload cannot reuse that request ID
    And only one task can own the desktop

  Scenario: Require independent completion evidence
    Given the model reports that its task is done
    When the independent verifier rejects the result
    Then the task requires review
    And the model statement cannot establish completion

  Scenario: Drain observations before private takeover
    Given a screenshot or decision is pending
    When the operator requests private takeover
    Then the runtime invalidates the old epoch
    And takeover waits for pending work and input release
    And late observations cannot reach the model or evidence directory
    And public status contains no private resume ticket

  Scenario: Resume private work with an exact operator ticket
    Given a task waits for private user input
    When a caller resumes without the current operator ticket
    Then the runtime rejects the request
    When the operator resumes with the exact ticket and revision
    Then a new epoch supplies a fresh observation

  Scenario: Preserve uncertain effects after restart
    Given a dispatched action has no confirmed outcome
    When the runtime restarts
    Then the task requires reconciliation
    And the runtime does not replay the action
    And a successful independent check still requires explicit resume

  Scenario: Stop after cancellation or shutdown
    Given a desktop action is pending
    When cancellation or shutdown starts
    Then the runtime aborts and drains owned work
    And the runtime releases keyboard and pointer input
    And no later task action can start

  Scenario: Fence failed input release
    Given QMP does not confirm a key or pointer release
    When another action is requested
    Then the input controller refuses the action
    And a release retry sends every unconfirmed key and button up

  Scenario: Fence unavailable storage
    Given a journal write fails
    When a caller submits or resumes a task
    Then the runtime refuses further execution
    And input release does not depend on another journal write
    And public results contain only committed state

  Scenario: Close private connections during transitions
    Given a private operator connection is active
    When resume or cancellation begins
    Then new VNC connections are refused throughout the transition
    And existing connections close before the model resumes
    And cancellation of a historical task cannot affect another task

  Scenario: Authenticate the complete operator page
    Given an operator opens the login page without a session
    When the operator authenticates using the private credential
    Then the browser can load the application and noVNC assets
    And unauthenticated callers cannot load private desktop data
    And response limits measure UTF-8 bytes

  Scenario: Invalidate a changed virtual machine
    Given a worker has observed the virtual machine
    When QMP reports reset or shutdown or stop or disconnection
    Then old screenshot actions and private connections are refused
    And automatic worker restart requires operator inspection

  Scenario: Bind verification to one fixture run
    Given a fresh anonymous shopping fixture and its unique run ID
    When the fixed cable task is admitted
    Then another goal or fixture run is refused
    And completion requires one new matching cart addition in that run

  Scenario: Report an unavailable visual provider
    Given the configured provider refuses a visual request because its quota is exhausted
    When execution stops
    Then the result reports that no completion was established
    And no input or automatic retry occurs
    And only fixed failure tags and retry metadata enter the journal
