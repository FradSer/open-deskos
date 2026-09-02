Feature: Python Face Agent Functional Pipeline Decoupling

  Scenario: Face Agent normalizes valid ESP32-P4 inference frames
    Given a raw P4 camera metadata JSON string from serial
    When the normalizer processes the frame
    Then it produces normalized face bounding boxes, landmarks, identity, and emotion
    And invalid scores or inconsistent face counts fail closed to None

  Scenario: Face Agent state machine transitions through truthful lifecycle states
    Given a Face Agent state store initialized to starting
    When serial connects but receives no frames
    Then status is no-frame with no fabricated camera result
    When a valid inference frame arrives
    Then status transitions to online with latest result
    When frames become stale past 3 seconds
    Then status transitions to camera-unavailable
