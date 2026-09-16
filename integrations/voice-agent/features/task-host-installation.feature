Feature: Managed Pi host installation
  Scenario: A configured Linux host owns tasks independently of voice recording
    Given a non-root account with Pi credentials and an explicit task configuration
    When the managed task user service starts
    Then it launches the task daemon independently of the voice service
    And private task data uses restrictive permissions
    And active runtime releases remain read-only

  Scenario: A configured Mac host owns tasks independently of SSH requests
    Given a logged-in Mac account with Pi credentials and an explicit task configuration
    When its launch agent starts
    Then it launches the same task daemon independently of SSH client lifetime
    And task configuration and executable locations are explicit operator substitutions
