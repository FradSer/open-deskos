Feature: The Personal Bot reads and drives a web page through a bounded capability
  Scenario: A redirected private page is not returned as public content
    Given a public target redirects to a private or credential-bearing address
    When a browser result identifies that final address or snapshot origin
    Then the capability refuses the result without returning page content

  Scenario: Page delimiters remain unpredictable without CLI boundary metadata
    Given page text contains the previous fallback closing delimiter
    When the CLI omits its optional boundary metadata
    Then each response receives a fresh host-generated delimiter nonce

  Scenario: Provisioning verifies downloaded bytes before installation
    Given the installer downloads a pinned CLI or browser archive
    When its SHA256 digest differs from the reviewed digest
    Then provisioning refuses the download before execution or extraction

  Scenario: A page reading carries provenance and a bound
    Given the desk browser capability is configured in the personal profile
    When the coordinator reads a page through codemode
    Then the returned text is wrapped in the browser's page-content markers
    And the result states that the text is untrusted data
    And a page longer than the configured limit is truncated with an explicit marker
    And the returned bytes never exceed the configured limit

  Scenario: The browser refuses a target that reaches the desk
    Given the owner asks the coordinator to open an address
    When the address uses a scheme other than http or https
    Or the address carries credentials
    Or the address names a loopback, private, link-local or single-label host
    Or the host is an alternative numeric encoding of such an address
    Then the capability refuses it before any browser command runs
    And the refusal names the reason and is not retried in another form

  Scenario: An action whose outcome is unknown is never repeated
    Given a click, fill or press command exceeds its deadline
    When the capability reports the failure
    Then it states that the outcome is unknown
    And it does not repeat the command
    And a read-only command that times out is not reported as an unknown outcome

  Scenario: A page supplies data, never instruction or authority
    Given a page whose text tells the coordinator to visit another address or change its rules
    When the coordinator answers the owner
    Then the page text is reported as page content
    And it is never followed as an instruction, permission or confirmation

  Scenario: The browser is released when the agent closes
    Given the resident agent created a browser session
    When the agent closes
    Then the browser is released
    And an unconfirmed release makes runtime disposal report a cleanup failure

  Scenario: Browsing is its own routed workflow
    Given a personal profile with capabilities.browser configured
    When the owner asks to read a page or look a fact up on a website
    Then Jev selects the browse workflow
    And only the browser capabilities are active for that turn
    And a conversation turn or a desk measurement query cannot invoke them
    And general knowledge answered without reading a page stays in conversation

  Scenario: The capability is absent until the operator configures it
    Given a personal profile without capabilities.browser
    When the resident agent starts
    Then no browser capability is registered
    And the reviewed browser skill is not offered
    And a coding profile cannot declare browser settings

  Scenario: Parent and child browsers have separate sessions
    Given each agent has a private state directory
    When the host creates its browser capability
    Then the session namespace depends on that private state directory
    And each runtime and page epoch has a new host-owned session identity
    And parent, temporary child, and saved child sessions differ
    And closing one session cannot close another session
    And a lifetime cancellation prevents later browser commands

  Scenario: Browser infrastructure is provisioned outside the immutable release
    Given the release is read-only
    When the installer provisions the browser
    Then it writes host artifacts only under /opt/agent-browser
    And the interaction probe runs as a non-root user

  Scenario: A failed browser provisioning does not fail the installation
    Given browser provisioning fails
    When the Shell installer continues
    Then it reports the unavailable capability and a remedy

  Scenario: Provisioning proves the browser drives a page
    Given the CLI and Chrome are installed
    When the interaction probe clicks its local fixture button
    Then the page reports the expected changed state

  Scenario: A repeated provisioning run downloads nothing
    Given the pinned CLI and Chrome are installed
    When the installer runs again
    Then it reuses both host artifacts

  Scenario: Closing a page does not dispose the resident capability
    Given the browser tool closed its page after a turn
    When the next turn opens a public page
    Then the same resident capability can start its private browser again
    And final runtime disposal still prevents later commands

  Scenario: A dispatched action without a valid response has an unknown outcome
    Given a mutating command reached the CLI
    When cancellation or transport loss prevents its response
    Or its response cannot prove a valid result
    Then the capability reports an unknown outcome without retry
    And cancellation before dispatch remains a refusal without an unknown outcome

  Scenario: A root provisioning probe cannot follow user-owned paths
    Given the runtime user controls its home and cache
    When root writes the interaction fixture
    Then it uses a new root-owned private temporary directory
    And it grants read access only after root finishes writing
    And cleanup removes only that probe directory

  Scenario: A retired daemon cannot receive the next page command
    Given scoped close returned while its daemon still exits
    When the next page command starts
    Then the host selects a fresh session epoch before its first dispatch
    And it does not repeat a failed or unknown action
    And final disposal retries only owned epoch cleanup

  Scenario: An unproved page release cannot become a completion receipt
    Given scoped cleanup fails or returns an invalid response
    When the close tool reports its result
    Then it reports an unknown outcome without claiming the browser closed
    And later browsing uses a new private epoch
    And runtime disposal retries only owned cleanup

  Scenario: Final disposal requires evidence for every dispatched session
    Given the runtime dispatched commands to private session epochs
    When final disposal finishes all scoped cleanup attempts
    Then it rejects if any epoch lacks a successful cleanup receipt
    And a never-started session needs no cleanup command
