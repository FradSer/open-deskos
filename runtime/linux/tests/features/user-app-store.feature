Feature: Verified local user applications
  Scenario: Install, update, restart, rollback and remove a real draft
    Given a configured workspace containing a manifest and self-contained HTML draft
    When the exact draft bytes pass verification and installation persists
    Then only installed metadata and immutable verified HTML are published
    When an update is installed and the store restarts
    Then rollback verifies and restores the preceding snapshot
    When the app is removed
    Then it disappears without deleting user data

  Scenario: Failed verification or persistence preserves the active revision
    Given an installed app
    When verification rejects an update or atomic catalog persistence fails
    Then the previous revision remains active in memory and after restart
    And the failed candidate snapshot is cleaned without deleting the active revision

  Scenario: Reject unsafe or oversized packages
    Given an unconfigured workspace or an unsafe identifier, manifest, symlink or oversized draft
    When installation is requested
    Then no app is published and a clear error is returned

  Scenario: Validate persisted references and bound the catalog
    Given a catalog containing unsafe paths or altered snapshot bytes
    When the store restarts
    Then invalid entries are not published
    Given 32 installed user apps
    When another app is installed
    Then the catalog limit is enforced

  Scenario: Bound retained revisions and reject storage redirects
    Given successive verified updates of an installed application
    When a third version is installed
    Then only the active and immediately preceding revision are retained
    When the draft checkout is unavailable
    Then installed applications can still be listed and removed
    Given the snapshot storage contains a symbolic link
    When a candidate is installed
    Then installation fails without writing outside the state directory

  Scenario: Serialize concurrent mutations and isolate verifier mutation
    Given concurrent installation requests and a verifier that modifies its input
    When the requests complete
    Then committed snapshots preserve the original bytes and no catalog update is lost
