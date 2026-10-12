Feature: Replace connection and gamepad status without changing their meaning

  Scenario: Independent status preserves its public reading
    Given default and independent status implementations use the same controlled inputs
    When connection reachability or gamepad presence changes
    Then glyph visibility, state attributes, titles, and accessible names agree
    And the status remains an indicator without navigation controls

  Scenario: Released status callbacks cannot change a replacement
    Given a status consumer has registered its input callback
    When an independent implementation replaces it in the same container
    Then the previous input resource is released before the new resource is acquired
    And a captured previous callback cannot change released or replacement state
    And disabling and enabling retains one selected input resource
    And shutdown releases all owned input resources

  Scenario: Browser loading retains status meaning and ownership
    Given a private Shell uses actual preload with controlled browser connection and gamepad inputs
    And resource observations start before the initial status mounts
    When development links or signed revisions replace both indicators through the public controller
    Then actual and comparison indicators retain state, glyphs, styles, and geometry
    And built-in recovery retains their containers and an independent Year peer
    And disable and enable release and reacquire selected input resources
    And shutdown releases discovery and asset authority before actual child closure

  Scenario: An unchanged connected gamepad survives status lifecycle changes
    Given the shared input source already reports a connected gamepad
    When the gamepad status is replaced, restored, or enabled again
    Then its fresh subscription immediately receives the retained gamepad state
    And the connected indicator appears without another connection event
    And one consumer cannot change the retained state observed by another consumer

  Scenario: Hidden input comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture selects each existing comparison size
    Then its renderer viewport matches that size at unit scale before measurement
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And state, resource, replay, recovery, and deadline assertions remain required
