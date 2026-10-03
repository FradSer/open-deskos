Feature: Confirmed personal DiDi rides
  Scenario: A model cannot authorize a purchase
    Given a fresh quote and selected product
    When the model submits without a subsequent exact host user confirmation
    Then no order is created
  Scenario: One confirmation purchases once
    Given a proposal containing route, price, product and unique confirmation phrase
    When the next host turn exactly matches that phrase
    Then at most one create request is sent after submitting is persisted
  Scenario: Quotes change or expire
    Given a previously confirmed quote
    When its quote changes or expires
    Then a new proposal and user confirmation are required
  Scenario: A lost create response survives restart
    Given a create request has an ambiguous outcome
    When the service restarts and queries the current account order
    Then the outcome stays unknown and another order is blocked
    And an unrelated account order is not adopted
  Scenario: Cancellation is a separate confirmed action
    Given an active order
    When the user confirms its exact cancellation phrase in a later turn
    Then cancellation is attempted once and an ambiguous result remains uncertain
  Scenario: Polling follows the documented lifecycle
    Given an active order
    When status is 0 or 1 then polling waits 30 seconds
    When status is 2 or 4 then polling waits 60 seconds
    When status is documented completed code 5 then polling stops
    When status is unrecognized then the order remains unknown and new orders are blocked
  Scenario: Query response cannot corrupt trusted order identity
    Given a known active order ID
    When a query explicitly returns a malformed or mismatched order ID
    Then the response is rejected and the trusted ID remains unchanged
  Scenario: Private transport and persistence
    Given a private credential file and private state directory
    When transport fails
    Then errors never contain credential values or endpoint URLs
    And persisted state is atomically written with owner-only permissions
  Scenario: Initialization and response streams are bounded
    Given the SDK initialization notification never completes
    When the connection deadline expires
    Then the connection is closed and a sanitized error is returned
    And oversized HTTP response bodies are rejected
  Scenario: Resident process owns private state exclusively
    Given one controller owns the state file
    When another process opens the same state file
    Then it fails closed without sending network requests
  Scenario: Simulated orders cannot be mistaken for real orders
    Given a sandbox controller
    When a tool returns a result
    Then it explicitly marks sandbox mode
    And a production controller cannot reuse its persisted state
  Scenario: Cancellation uncertainty remains explicit
    Given cancellation has an ambiguous outcome
    When a query reports an unrecognized status followed by an active order
    Then cancellation uncertainty remains and another cancellation is blocked
  Scenario: Status types are validated without coercion
    Given an active order
    When a query returns an array or object resembling a completed status
    Then the order remains uncertain and new orders are blocked
  Scenario: Coordinates must come from current search results
    Given no map search has returned the proposed endpoints
    When the model asks for a quote using remembered coordinates
    Then the quote is rejected
  Scenario: Text-only query is information rather than machine-readable status
    Given a sandbox order with a trusted order ID
    When query returns only nonempty text content without structuredContent
    Then the transport exposes at most 4096 characters with statusUnavailable true
    And the engine retains the order ID and last machine status as history
    And phase becomes unknown with 30 second polling and mutations blocked
    And tools explain that natural text cannot verify completion or cancellation
    When a structured query later returns a matching ID and documented status
    Then only the structured status restores lifecycle authority
  Scenario: Compatibility fallback never authorizes mutation results
    Given estimate, create or cancel returns only text content
    When the transport validates its response
    Then the response is rejected rather than interpreted as success
    And an attempted cancellation remains cancel_unknown
