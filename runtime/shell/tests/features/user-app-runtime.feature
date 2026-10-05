Feature: Sandboxed self-contained user applications

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
