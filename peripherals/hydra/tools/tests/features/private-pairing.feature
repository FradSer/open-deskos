Feature: Prepare private Hydra pairing files for operator review
  Scenario: Preserve the existing S3 pairing
    Given a private gateway configuration with the existing encrypted S3 peer
    When the operator supplies distinct gateway and Hydra station MAC addresses
    Then preparation preserves the PMK, S3 peer, and existing configuration fields
    And preparation adds a new encrypted Hydra peer with a fresh LMK
    And only two private JSON files exist in a new private output directory
    And preparation does not install files, access hardware, or change services

  Scenario: Refuse unsafe or conflicting preparation
    Given an unknown configuration, conflicting identity, full peer list, or unsafe path
    When the operator requests preparation
    Then preparation fails without exposing private values
    And existing files remain unchanged

  Scenario: Remove incomplete preparation
    Given a valid private configuration and a new output directory
    When an output write fails
    Then preparation removes its incomplete output
    And the input configuration remains unchanged

  Scenario: Preserve files created by a concurrent writer
    Given a valid configuration and a new output directory
    When another writer creates or replaces an output file
    Then preparation fails without deleting the other writer's file

  Scenario: Preserve a separately paired Remote
    Given an explicit paired Remote identity or a single legacy peer
    When preparation adds a Hydra peer
    Then preparation preserves that Remote identity without a fixed device MAC

  Scenario: Prepare an explicit private firmware input
    Given a private Hydra desktop configuration and an ignored local directory
    When the operator explicitly prepares a private firmware header
    Then the header uses the agreed byte-array configuration schema
    And a hash receipt identifies the private build and verifies file readback
    And the ordinary main profile does not consume this header
    And no firmware build, NVS write, or device operation occurs

  Scenario: Confine a private build before compilation
    Given the private firmware profile contains pairing keys
    When its explicit build directory is outside the private local directory
    Or a build cache, link, public permission, or foreign owner is present
    Then the pre-build guard refuses compilation
    When the operator uses the protected build directory with no build cache
    Then the guard validates the private header and build directories
    And generated files inherit private permissions
