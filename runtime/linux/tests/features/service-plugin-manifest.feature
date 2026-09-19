Feature: Service Plugin manifest declaration and verification gate
  A Widget or App may declare at most one Service Plugin for its own data needs.
  The system-owned verification gate is the only door: a failing candidate
  never replaces the installed revision.

  Scenario: Accept a valid service declaration
    Given a Widget whose manifest declares a service with a package-confined exec entry, a version, secret names, and a non-empty egress allowlist
    When the candidate is installed
    Then installation succeeds
    And the installed revision carries the service declaration

  Scenario: Reject an exec entry outside the package
    Given a manifest whose service exec entry is absolute or escapes the package
    When the candidate is installed
    Then installation fails with invalid-manifest

  Scenario: Reject a service without a version or with an empty egress allowlist
    Given a manifest whose service lacks a version or names no egress destination
    When the candidate is installed
    Then installation fails with invalid-manifest

  Scenario: Reject a secret value smuggled into the package
    Given a manifest whose service declaration carries a secret value rather than a name
    When the candidate is installed
    Then installation fails with invalid-manifest

  Scenario: A failed candidate leaves the installed revision untouched
    Given an installed revision with a running service declaration
    When a candidate with an invalid service declaration is offered
    Then the update fails
    And the installed revision and its service declaration are unchanged
