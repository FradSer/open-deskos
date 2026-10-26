Feature: Private recommendation sources use reviewed read-only connectors
  Scenario: Explicit private feedback refines only an abstract recommendation preference
    Given the owner responds to a current private review recommendation
    When the asynchronous Pi refines that feedback
    Then its input contains only the feedback decision and a fixed review stage
    And no mail, derived advice, account, message identifier, or private link enters that input
    And later private events can use that topic preference
    And invalid source bindings cannot enable private learning
    And a host policy denial blocks refinement and derived preference reuse

  Scenario: Only an owner file selects a reviewed private source profile
    Given a private owner configuration selects an installed Gmail connector
    When Personal Agent starts its recommendation source
    Then it loads no arbitrary source module and starts no provider before observation
    And a missing optional connector does not stop the Agent
    And a linked or shared configuration is refused without changing its permissions

  Scenario: Gmail supplies private observations through an independent session
    Given the owner enabled the installed Gmail recommendation source
    When the source observes one inbox message
    Then its private session uses only status, search, and read tools
    And the observation has host-owned private provenance
    And public producer readings do not receive the message
    And automatic learning remains forbidden for the observation

  Scenario: A connector changes during observation
    Given a private observation is in progress
    When its connector is removed, disabled, or replaced
    Then the old observation cannot publish
    And its own MCP session closes without cancelling an interactive turn

  Scenario: Source updates preserve message identity
    Given a message has an existing recommendation event
    When the connector updates or rolls back and observes the same account and message
    Then its event key and review handle stay unchanged
    And an old source snapshot remains invalid

  Scenario: Reviewing a message performs a real read-only operation
    Given the current source observed a private message
    When the owner executes its review handle
    Then the source checks the current account and rereads that message
    And it returns bounded private content with current provenance
    And email text cannot authorize publication or establish who performed an action

  Scenario: An account changes before review
    Given a review handle belongs to one connected Gmail account
    When Google reports another account
    Then the source refuses the old review before reading its message

  Scenario: A provider does not support account-pinned reads
    Given an installed Gmail provider lacks the reviewed account-pin parameter
    When the private recommendation source discovers its tools
    Then the source stays unavailable without reading messages
    And it does not fall back to an unpinned request

  Scenario: Cancellation interrupts connector startup or discovery
    Given a private source is opening a connector or discovering tools
    When the owner disables that source or cancels its operation
    Then the observation stops without waiting for provider completion
    And a late connector session closes without dispatching a read

  Scenario: Cancellation interrupts recommendation validation
    Given a current private event requires account validation
    And the account status request is pending
    When the recommendation owner cancels validation or review eligibility
    Then the source returns false without waiting for the provider
    And it does not publish or execute the stale event

  Scenario: Repeated reads preserve an unchanged private event binding
    Given the source observed one private message
    When a later read has the same account, revision, epoch, and semantic values
    Then its binding snapshot remains valid
    And its reading time reflects the later read
    And changed semantic values invalidate the old snapshot without changing the event identity

  Scenario: An unchanged private event keeps its presented recommendation
    Given a private event has a presented recommendation
    When the next source observation changes only the measurement time
    Then the same recommendation remains executable without another generation or notification
    And a changed authorization binding expires its earlier confirmation
    And the replacement recommendation has a different identifier

  Scenario: Handled private events do not replay after transport changes
    Given the owner handled a private event recommendation
    When its connector updates, rolls back, disappears, or restarts
    Then the stable event receipt suppresses another recommendation for that event
    And no private message content enters the receipt

  Scenario: Private recommendation reads taint the interactive turn before errors
    Given the Watch has private recommendations
    When proposal inspection or response validation runs
    Then the host marks the current turn private before returning content or errors
    And source snapshots remain outside model generation input

  Scenario: Completing a private review preserves owner cooldown configuration
    Given a generated private recommendation is current and presented
    And its rule is absent from the owner configuration
    When the owner confirms its read-only review action
    Then the private review completes without a configuration-save warning
    And its handled event receipt prevents another recommendation
    And the owner cooldown configuration stays unchanged
    And declared owner rule cooldowns remain writable
    And unknown owner rule cooldowns remain invalid
