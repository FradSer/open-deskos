Feature: Gmail access for Personal Agent
  Gmail authorization belongs to the operator and grants read-only access.

  Scenario: Run Gmail through the external service supervisor
    Given a Docker service package and private external credential bindings
    When the supervised Gmail daemon starts
    Then its private Unix socket accepts bounded MCP sessions
    And its readiness probe makes no Google request
    And a socket bridge exposes the existing read-only Gmail tools without credentials
    When the supervisor stops the daemon
    Then active sessions close and only its owned socket is removed

  Scenario: Refuse unsafe or unbounded service clients
    Given the Gmail daemon owns a private Unix socket
    When clients send invalid, oversized, or incomplete frames
    Then bounded session handling closes those clients without exposing request contents
    And another live listener or replaced socket cannot be removed
    And coalesced valid frames retain their separate size limits
    And a closed bridge output stops its session without an uncaught error

  Scenario: Validate the independent MCP boundary
    Given the standalone Gmail plugin with a private credential path
    When an MCP client discovers tools and reads a selected message
    Then only status, search, and read tools are available
    And invalid tool arguments fail before a Google request
    And token values never appear in the MCP response
    And multibyte message text fits the host byte limit with explicit truncation

  Scenario: Register an independently installed version
    Given an immutable Gmail plugin directory and a canonical Node executable
    When the operator generates a connector manifest
    Then it selects that exact plugin entry without embedded credentials
    And the manifest declares owner-only access and private data
    And a symlink deployment path is refused

  Scenario: Authorize Gmail through the system browser
    Given a Google Desktop OAuth client and a new private credential path
    When the operator connects Gmail
    Then the browser uses a random loopback port, state, and PKCE S256
    And only the Gmail read-only scope is requested
    And only a refresh token is saved in the private credential file

  Scenario: Reject an invalid authorization callback
    Given an active Gmail authorization request
    When the callback state differs or the user denies consent
    Then authorization fails without saving credentials or exposing tokens

  Scenario: Bound authorization lifetime
    Given an active Gmail authorization request
    When the user does not complete authorization before the deadline
    Then the callback listener closes and authorization fails

  Scenario: Disconnect Gmail
    Given private Gmail credentials
    When the operator disconnects Gmail
    Then the refresh token is revoked before local credentials are removed
    And a failed revocation preserves the local credentials
    And a different grant installed during revocation is preserved

  Scenario: Gmail is not configured
    Given no Gmail credential file
    When Personal Agent checks Gmail
    Then the result is unconfigured
    And no Google request is sent

  Scenario: Search and read Gmail without modifying the mailbox
    Given private Gmail credentials
    When Personal Agent searches or reads email
    Then search results and pagination are bounded
    And MIME text is decoded without downloading attachments
    And mixed MIME siblings retain distinct plain text and HTML content
    And plain text preference applies only within alternative MIME parts
    And mail content is untrusted data rather than instructions

  Scenario: Refresh credentials are no longer valid
    Given Google rejects the refresh token with invalid_grant
    When Personal Agent checks Gmail
    Then Gmail reports that reconnection is required
    And no token appears in the result

  Scenario: Credentials disappear during a request
    Given a Gmail request is pending
    When the operator removes the credential file
    Then the pending request cannot publish a stale result

  Scenario: A private observation remains bound to its selected account
    Given the observer checked one account before another grant was selected
    When search or read supplies the expected account key
    Then the provider checks that account with the same grant used for the requested data
    And a different account fails before any message endpoint is called
    And returning to the original account cannot relabel another account's data

  Scenario: Cancel a turn during shared credential refresh
    Given two Gmail reads share one pending access-token refresh
    When one owner turn is cancelled
    Then its read stops without waiting for refresh completion
    And the other read can finish with the shared refresh

  Scenario: Private credentials are stored exclusively
    Given a private operator credential path
    When Gmail credentials are saved
    Then the file grants access only to its owner
    And an existing credential file cannot be overwritten
    And unsafe paths and aliases are rejected

  Scenario: Private mail does not become learned experience
    Given a task reads Gmail with automatic learning enabled
    When the completion plugin verifies the answer
    Then the Gmail receipts cannot support learned experience
    And no learning model or experience write runs for that task

  Scenario: Forget local Gmail credentials
    Given private Gmail credentials that cannot be revoked
    When the operator forgets Gmail
    Then only the matching local credentials are removed
    And no Google request is sent
    And the result does not claim that Google access was revoked

  Scenario: Credentials change during disconnection
    Given the operator starts disconnecting one Gmail grant
    When another grant replaces the stored credentials before revocation completes
    Then disconnection cannot remove the replacement grant

  Scenario: Install Gmail as an optional MCP connector
    Given Gmail is not installed in the agent package catalog
    When the owner installs the reviewed Gmail MCP manifest
    Then discovery exposes only Gmail status, search, and read tools
    And missing credentials return an unconfigured result
    And Gmail call receipts are marked as private data

  Scenario: Remove and restore a Gmail connector
    Given the installed Gmail connector has an active stdio session
    When the owner removes Gmail
    Then the connector session closes and further Gmail calls are refused
    When the owner restores the retained revision
    Then Gmail can reconnect through that exact revision

  Scenario: Restrict Gmail to the owner
    Given Gmail is installed with an owner-only policy
    When a non-owner channel reads the catalog or calls Gmail
    Then Gmail is omitted from channel context and calls are refused

  Scenario: Package Gmail for an isolated host
    Given the Gmail plugin source and its dependency lockfile
    When the operator creates a local plugin archive
    Then the archive contains the lockfile and required runtime files
    And the archive excludes credentials, tests, and installed dependencies
    And an existing archive cannot be overwritten

  Scenario: Bound malformed HTML processing
    Given a message contains repeated incomplete HTML tags within the response limit
    When Personal Agent reads that message
    Then body extraction completes within the processing deadline
    And the message remains untrusted with explicit truncation metadata
    And ordinary plain text and HTML bodies retain their meaning

  Scenario: Real Gmail content appears in a Personal Agent message
    Given CM5 has an authorized read-only Gmail service and an exclusive acceptance window
    When the owner requests a summary of one inbox message
    Then the resident commits successful Gmail search and read receipts for that turn
    And the answer contains a summary based on the returned message body
    And the Shell displays that answer in the same owner turn
    And verification reports hashes without printing private mail content
    And Gmail performs no message write

  Scenario: An uncertain acceptance submission is not repeated
    Given a real-mail acceptance request has a persistent submission record
    When its delivery or completion cannot be confirmed
    Then verification reconciles the original request
    And it does not submit another model request automatically

  Scenario: Concurrent grants do not exchange account-bound data
    Given the first grant has a pending account profile request
    When a second grant completes an account-bound message read
    Then the first request fails if the second grant remains selected
    And restoring the first grant uses its original token for profile and message access
    And account keys do not enter provider request URLs
