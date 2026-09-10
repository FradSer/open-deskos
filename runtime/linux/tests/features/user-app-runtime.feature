Feature: Sandboxed self-contained user applications
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
