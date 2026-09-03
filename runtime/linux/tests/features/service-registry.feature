Feature: Dynamic Background Service Registry & Audio Transcription Seam

  Scenario: Background service plugin registers with full lifecycle
    Given a background service plugin with kind "service" and identity "odk.service.audio-transcription"
    When the plugin is registered with the Open DeskOS plugin registry
    Then it completes installation and activation into the running state
    And it exposes its exported interface through the dynamic service registry

  Scenario: Plugins discover and subscribe to background services dynamically
    Given an active background service publishing speech transcription events
    When a widget or application queries "ctx.services.get('odk.service.audio-transcription')"
    Then it receives the exported service instance
    And it can subscribe to live transcription updates
    And scoped cleanups automatically unsubscribe listeners when the consumer unmounts

  Scenario: Disabling or stopping a background service cleans up resources
    Given an active background service with active subscribers
    When the service is stopped or disabled
    Then its background resources and streams are terminated
    And subscribers no longer receive events
