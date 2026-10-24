Feature: Sandboxed self-contained user applications

  Scenario: Bound native macOS verification without optional background maintenance
    Given a candidate has visible content or a controlled script failure
    When the isolated macOS verifier starts
    Then its initial process arguments delay best-effort tasks until shutdown
    And other platforms keep their original process arguments
    And sandbox, permissions, and network restrictions stay active
    And the child closes normally within the unchanged eight-second deadline
    And its exit code agrees with its final verdict

  Scenario: The selected catalog owns installed runtime availability
    Given the installed runtime uses a selected package catalog
    When that catalog is disabled or fails to start
    Then the installed runtime is blocked without constructing another store or verifier
    And its IPC handlers, document route, and control listener are released
    When the selected catalog is enabled again
    Then the runtime uses that catalog's installed revisions and publications
    And no package is removed or reinstalled during recovery

  Scenario: Runtime release drains an accepted installation
    Given an accepted installation is waiting for verification
    When its runtime stops
    Then cleanup waits for that installation to settle
    And the accepted installation retains its ordinary result and persisted revision
    And no change notification is sent after stopping begins

  Scenario: Stopped runtime refuses retained request callbacks
    Given a caller retains runtime IPC and control callbacks
    When the runtime has stopped
    Then those callbacks cannot start another store operation
    And retained protocol callbacks return an unavailable response

  Scenario: Runtime release drains accepted content and data synchronization
    Given an accepted content request or package data synchronization is pending
    When its runtime stops
    Then cleanup retains dependencies until that operation settles
    And rejected operations do not prevent resource cleanup

  Scenario: Runtime release retains the verifier until actual child closure
    Given verification has returned a timeout, abort, or output-limit failure
    And the verifier child has not closed
    When its runtime stops
    Then cleanup retains ownership until the child closes
    And the failure verdict remains unchanged
    And a closed verifier refuses new verification

  Scenario: Runtime release drains initial package data synchronization
    Given default or signed selected runtime startup has started package data synchronization
    When its Host stops before synchronization settles
    Then the data provider remains owned until synchronization settles
    And a synchronization rejection is handled before provider release

  Scenario: CLI acceptance retains verifier process evidence without changing its verdict
    Given the private CLI fixture uses the production verifier with its existing deadline
    When installation, update, rollback, or controlled rejection completes
    Then diagnostics distinguish process spawn, reported result, actual verdict, and process closure
    And a reported success cannot replace the verifier's required normal process exit
    And diagnostics exclude package contents, paths, and subprocess output

  Scenario: A completed verifier requests exit without another scheduling turn
    Given an isolated candidate has a success or failure verdict
    And stdout has backpressure and does not complete its write callback
    When the runner writes its result file
    Then it requests the matching process exit in the same turn
    And exit does not wait for an immediate callback or stdout flushing
    And the parent still requires actual closure and a matching normal exit for success

  Scenario: Package verification uses one nonpersistent session
    Given an isolated candidate needs document and policy verification
    When the runner creates its verification session
    Then that session uses an in-memory partition with caching disabled
    And its window, protocol, permissions, and network restrictions use that session
    And the runner does not use default persistent session APIs

  Scenario: Failed runtime cleanup retains resource ownership for retry
    Given the installed package runtime owns IPC handlers, a protocol route, and a control listener
    When handler removal or listener close fails during plugin shutdown
    Then failed resources remain owned and required providers cannot release
    And startup cannot allocate a replacement runtime before cleanup succeeds
    When the owner retries shutdown
    Then only retained resources release again
    And concurrent cleanup callers share one release operation
    And cancellation drains a late listener before shutdown completes

  Scenario: Startup does not create resources after quit
    Given Shell startup is waiting for an asynchronous catalog or control listen
    When Electron emits before-quit before that operation finishes
    Then startup creates no window or timer after the operation finishes
    And a control listener that finishes after quit closes immediately
  Scenario: Render a valid user document
    Given a bundle with inline HTML, CSS and JavaScript
    When the isolated frame reaches DOMContentLoaded with visible body content
    Then its token-authenticated readiness promise succeeds
    And the frame has only the allow-scripts sandbox capability

  Scenario: Reject broken or blank documents
    Given a bundle with a JavaScript exception or no visible body content
    When the isolated verifier runs the exact bundle HTML
    Then verification fails without installing it

  Scenario: Bound hostile verification
    Given a bundle whose JavaScript never terminates
    When the independent Electron verification process exceeds its deadline
    Then the process group is killed and verification fails
    And the calling process remains responsive

  Scenario: Verify packages concurrently without sharing an Electron profile
    Given two valid packages are verified at the same time
    When each independent Electron process starts
    Then both verifications succeed without using the global Electron profile
    And userData and sessionData use the same private directory before Electron readiness
    And the macOS verifier hides its Dock entry before readiness
    And hidden verification windows do not throttle document processing
    And every temporary bundle, result and profile directory is removed

  Scenario: Retry cleanup after a verifier releases its profile lock
    Given verifier cleanup is blocked by a profile lock until the child closes
    When the child closes after verification has already settled
    Then the temporary bundle, result and profile directory are removed

  Scenario: Deny privileged access and external resources
    Given a self-contained application running at an opaque origin
    When it attempts network access, navigation, popups or parent access
    Then its CSP, sandbox and dedicated verifier session deny those capabilities

  Scenario: Ignore unrelated frame messages and dispose pending frames
    Given an application awaiting readiness
    When another frame posts a ready message or the application is disposed
    Then unrelated messages do not authenticate readiness
    And disposal settles readiness as failed and removes the frame

  # Runtime iframe CPU scheduling is not an isolation guarantee.
  # Remote shell key events do not cross into opaque frames; touch/mouse works directly.

  Scenario: Preserve a reported failure when the verifier cannot exit
    Given the verifier has written a bounded failure result to its result file
    When the verifier process remains alive until its deadline
    Then the parent terminates the process and preserves the reported failure reason
    And a success file or console output cannot bypass the process exit requirement

  Scenario: Installed runtime consumes the selected package catalog
    Given a replacement catalog provides installed package operations
    When the default or signed selected installed runtime starts
    Then its list, commands, and content requests use that catalog instance
    And IPC and local control forward installation, import, update, rollback, and placement arguments to that instance
    And a selected catalog refusal does not invoke the unused default catalog
    And it does not construct a second default catalog or verifier
    And the default catalog owns verification and releases its verifier through plugin cleanup

  Scenario: Runtime release waits for catalog verification without retiring the catalog
    Given the selected catalog owns a verification child that has not closed
    When the installed runtime stops after receiving a verification verdict
    Then runtime cleanup waits for that child to close
    And the catalog can verify another package after runtime restart

  Scenario: Selected installed runtime preserves Widget import and placement
    Given the default or signed selected runtime uses the installed package catalog
    When local control imports a Widget and IPC moves it to another free Cell
    Then list and desktop consumers report the same placement and revision
    And content requests serve the imported document
    When a client requests an occupied Cell
    Then the persisted catalog and active placement remain unchanged
    When the runtime restarts
    Then the imported Widget retains its placement and revision
    When IPC removes the Widget
    Then local control and content consumers no longer expose it

  Scenario: Selected installed runtime preserves package revision operations
    Given the default or signed selected runtime uses the installed package catalog
    When IPC and local control clients update and roll back a package
    Then both consumers report the same active revision
    And content requests serve that revision's captured document
    When verification rejects a later update
    Then the active revision and persisted catalog bytes remain unchanged
    And runtime restart retains the accepted revision and rollback history

  # Creation contract: verified packages declare public HTTPS JSON sources.
  # The main process owns requests, freshness, response limits, and failure states.
  # Frames remain opaque and cannot fetch directly or select undeclared URLs.
  # CM5 acceptance requires Agent creation and modification of a Widget and App.
  # The Widget shows sourced UTC time; the App adds a named Refresh control.
  # Both inherit the active appearance and retain readable unavailable states.
  Scenario: Read a declared public API through the system bridge
    Given an installed revision declares a fixed public HTTPS JSON source
    When its authenticated frame requests that source by name
    Then the main process returns bounded JSON and its retrieval time
    And concurrent reads share one request and respect the declared refresh interval
    And an App can request the same source through its Refresh control
    And the iframe keeps its network restriction

  Scenario: Refuse undeclared and unsafe API access
    Given a package requests an undeclared source, old revision, or private network address
    When the system checks its verified declaration and resolved addresses
    Then no network request starts
    And redirects, non-JSON responses, oversized responses, and timeouts fail explicitly
    And a failed refresh reports stale data without labelling it live
    And closing the runtime aborts requests and refuses later reads
