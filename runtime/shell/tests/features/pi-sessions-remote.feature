Feature: Optional authenticated Mac Pi monitoring
  Scenario: Local monitoring remains the default
    Given no SSH Pi source is configured
    When the shell requests Pi sessions
    Then the local collector is used and the source is Local

  Scenario: Mac-side process state is preserved
    Given an SSH Mac source with a trusted host key and key authentication
    When its deployed collector returns a valid snapshot
    Then the shell displays the Mac sessions and Mac-side liveness unchanged
    And the source is identified as Mac over SSH
    And no CM5 process liveness check is performed

  Scenario Outline: Remote failure never masquerades as idle or local data
    Given an SSH Mac source is configured
    When the remote scan encounters <failure>
    Then the result is unavailable with the SSH source identity
    And no local collector is used
    Examples:
      | failure |
      | SSH authentication or connection failure |
      | command timeout |
      | excessive output |
      | invalid or stale snapshot |
      | incomplete configuration |
      | Mac process inspection unavailable |

  Scenario: Historical metadata remains compatible with remote monitoring
    Given the Mac has a dead historical session marked completed
    When the remote source receives its collector snapshot
    Then the snapshot is accepted and the historical status is normalized to exited

  Scenario: Live processes match their session metadata across resumes
    Given a live Pi process runs a session that was created before the process started
    And the session metadata has been written while the current process was alive
    When the collector scans sessions
    Then the process and its metadata are merged into one live session
    And the session keeps its goal instead of an unavailable-metadata placeholder.

  Scenario: Session files without a recorded start time still match their live process
    Given a live Pi process whose metadata file records no startedAt
    And the metadata file has been updated after the process started
    When the collector scans sessions
    Then the process and its metadata are merged into one live session

  Scenario: Stale metadata is still refused for a reused live PID
    Given a live Pi process whose PID matches metadata last written before the process started
    When the collector scans sessions
    Then the historical metadata is reported exited
    And the live process without metadata is excluded from the session list

  Scenario: All Pi surfaces identify a disconnected Mac
    Given the Mac source was previously active
    When its next snapshot is unavailable
    Then the widget and status bar show unavailable instead of zero or idle
    And the focused app clears its metrics and retains the Mac source label

  Scenario: Concurrent UI polling shares one remote scan
    Given a remote scan is in progress
    When multiple Pi surfaces request sessions
    Then only one bounded SSH process is launched
