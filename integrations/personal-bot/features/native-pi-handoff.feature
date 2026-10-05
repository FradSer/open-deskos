Feature: Continue the original native Pi session
  Scenario: An idle native Pi receives a Personal Agent instruction
    Given an isolated native Pi SDK session with its actual Open DeskOS extension
    And a configured control helper for that session
    When the Personal Agent continues the task through coding tools
    Then the original session receives a user message and writes the requested marker
    And its session ID and session file remain unchanged
    And no replacement session starts
    And the receipt reports unknown delivery without certifying a mutation outcome

  Scenario: A working native Pi receives a follow-up instruction
    Given the same native Pi session is working
    When the Personal Agent requests followUp delivery
    Then the receipt reports unknown delivery without certifying a mutation outcome
    And it directs reconciliation without a retry
    And the original session executes the instruction after its current turn
    And the persisted user message and marker prove delivery

  Scenario: A working native Pi uses normal Enter delivery
    Given the original native Pi session is working
    When the Personal Agent omits streamingBehavior
    Then the original session receives the instruction through steer delivery
    And its persisted user message and marker prove delivery without a retry

  Scenario: Long temporary parent paths do not exceed the native socket limit
    Given the fixture project uses a long temporary parent path
    When the fixture declares its session endpoint
    Then it uses a separate short private socket directory
    And it removes only its own temporary directories

  Scenario: An explicitly enabled Windows transport acceptance controls a disposable Mac session
    Given the operator explicitly enables the Windows acceptance fixture
    And read-only preflight confirms the existing Mac target and private endpoint directory
    When installed Windows coding tools continue the new isolated Mac Pi session
    Then idle, followUp, and normal Enter instructions execute in that original session
    And three user messages and three marker writes prove session execution
    And mutation receipts remain unknown
    And no existing session, service, target configuration, or credential is changed

  Scenario: A complete acceptance reply ends observation before SSH exits
    Given SSH remains alive after a bounded correlated JSON reply
    And Chinese reply text arrives in split UTF-8 chunks
    When the acceptance observer reads the complete reply line
    Then it preserves the Chinese text and completes without waiting for SSH exit
    And it stops the disposable observation process

  Scenario: An uncorrelated acceptance reply cannot certify execution
    Given a reply has another acceptance ID or fixture identity
    When the acceptance observer reads the reply
    Then it refuses the reply without replaying a mutation

  Scenario: An authorized real-provider fixture exposes only its new native session
    Given the operator enables real-provider acceptance with an available model
    When the fixture starts in its own approved temporary project
    Then it publishes a new native Pi session with a unique name
    And local status reports its original identity and persisted user messages
    And marker verification reads only files inside the fixture project
    And shutdown removes only the fixture project and its session endpoint

  Scenario: A real device Personal Agent routes an injected natural-language transcript
    Given the operator authorizes real provider and device acceptance
    And the current resident deployment is verified before fixture imports
    When authenticated toggle commands use the actual Personal Bot service
    And the recorder and transcription dependencies supply one synthetic transcript
    Then the actual model and Jev route the natural continuation request
    And actual configured coding tools reach only the named original native session
    And the fixture preserves selected execution evidence before its own cleanup
    And it does not claim physical microphone or device UI acceptance

  Scenario: A lost mutation reply preserves the actual mutation identity
    Given an exact fixture continuation fails with its actual mutation identifier
    When the acceptance runner records the failure
    Then it preserves the identifier and original task identity
    And it records unknown delivery without another mutation attempt

  Scenario: Cleanup failures cannot retain owned fixture resources
    Given abort rejects or a close operation exceeds its time limit
    When either real acceptance helper shuts down
    Then it still attempts each endpoint, session, environment, and directory cleanup
    And it records bounded cleanup failures without unhandled signal rejection

  Scenario: Invalid service frames stop acceptance observation safely
    Given the fixture service sends malformed or oversized JSON
    When the observer reads the frame
    Then it rejects observation and destroys the observation socket
    And the runner preserves its receipt and performs independent cleanup

  Scenario: Acceptance excludes unrelated production mutations
    Given the installed Personal Agent contains other product capabilities
    When the fixture registers its custom tool catalog
    Then it permits only required coding reads and one exact continuation
    And it excludes task creation, user App writes, and ride mutations

  Scenario: Device startup uses the resident service user
    Given SSH uses another account than the resident Personal Bot
    When the acceptance runner checks process identity before provider imports
    Then it refuses startup before it reads private provider credentials
    And an explicit service-user launch can use the existing owner files

  Scenario: Ordinary Pi CLI publishes its original native session
    Given an approved isolated project has private settings and no reporting targets
    When installed Pi CLI starts in RPC mode with the actual package extension
    And a bootstrap instruction requests only a ready response
    Then its real resource loader and session lifecycle publish the native endpoint
    And a later desk continuation uses the same CLI UUID and session file
    And one exact prompt and marker write prove execution without a replacement

  Scenario: Ordinary Pi CLI resumes the exact existing task before continuation
    Given the isolated ordinary CLI task has a persisted session file
    When the idle CLI closes and reopens that exact file without another bootstrap
    Then the original UUID and session file remain unchanged
    And the new CLI process publishes the original session endpoint
    And baseline prompt and file bytes remain available as separate evidence
    And the marker verifier counts only the requested continuation write

  Scenario: Windows rejects a remote production root
    Given a Windows desk has a remote Mac target
    And its declared root is /opt/open-deskos/current
    When the desk loads its target configuration
    Then it rejects the production root before a remote request

  Scenario: Windows acceptance uses a private named pipe
    Given an isolated Windows Personal Agent fixture
    When it creates its authenticated control endpoint
    Then the endpoint retains the Windows named pipe prefix
    And it does not use a filesystem socket
