Feature: Managed System Overlay Alert Channel

  Scenario: Plugin posts a high-priority system overlay alert
    Given a running background service or interactive app
    When it calls "ctx.postOverlayAlert({ title: 'Speech STT', message: 'Transcription engine connected', level: 'info' })"
    Then the host-managed system overlay displays the alert banner
    And the alert carries accessibility ARIA status attributes
    And the alert automatically dismisses after its timeout or upon close

  Scenario: System overlay alert does not break underlying desk navigation
    Given an overlay alert is currently visible
    When the alert auto-dismisses or is closed
    Then the active page and focus are restored
    And keyboard and touch navigation continue operating without degradation

  Scenario: Alert severity uses a uniform thin outline
    Given an info, warning, or critical system alert
    When the alert appears
    Then all four border widths are one pixel
    And warning and critical alerts retain the severity color
    And the alert retains its accessible status or alert role
