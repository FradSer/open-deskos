Feature: Voice feedback status transport
  Scenario: Transcription and streaming response remain separate
    Given the resident Voice Agent has transcribed a spoken request
    When thinking snapshots arrive with transcript and growing response text
    Then the Shell preserves the transcript separately from the current response
    And non-string transcripts are normalized to empty text
    And displayed transcripts are bounded to 4096 characters
    And maximum escaped transcript and response fit a complete status frame
    When the next recording starts
    Then the previous transcript is cleared
  Scenario: A pending resident request reaches the Shell incrementally
    Given recording has been submitted to the resident service
    When transcription finishes but the Agent is still running
    Then the real socket publishes the input before any reply
    When the Agent produces public text before completing
    Then the Shell receives that partial reply while still thinking
    When the Agent completes
    Then the Shell retains the same input with the final reply

  Scenario: Microphone levels remain bounded and truthful
    Given the resident Voice Agent is connected
    When a recording status includes a finite input level between zero and one
    Then the Shell forwards the measured level
    When a level is missing, invalid, outside that range, or not recording
    Then the Shell resets the level to zero

  Scenario: Markdown replies cross the socket without the old short-text truncation
    Given a voice request has completed
    When a response contains up to 16384 characters including escaped control characters and CJK
    Then the Shell retains the bounded full reply for Markdown rendering
    And an oversized status frame disconnects the client without displaying its content
