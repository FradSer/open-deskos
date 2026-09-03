;(function (root) {
  'use strict'

  let active = false
  const subscribers = new Set()

  root.odkPlugins.register({
    id: 'odk.service.audio-transcription',
    manifest: {
      schemaVersion: 1,
      provides: [{ interface: 'odk.interface.stt/v1', description: 'Local speech-to-text audio stream' }],
      permissions: ['audio:capture'],
    },
    kind: 'service',
    start() {
      active = true
    },
    stop() {
      active = false
      subscribers.clear()
    },
    export() {
      return {
        isTranscribing() {
          return active
        },
        subscribe(callback) {
          subscribers.add(callback)
          return () => subscribers.delete(callback)
        },
        pushTranscript(text) {
          if (!active) return
          const payload = { text, timestamp: Date.now() }
          for (const callback of subscribers) callback(payload)
        },
      }
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
