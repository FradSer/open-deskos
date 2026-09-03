# 01 — Dynamic Background Service Registry & Audio Transcription Seam

**What to build:** An extensible background service registry allowing headless plugins (such as local speech-to-text / audio transcription or hardware monitors) to run continuously, manage background lifecycles, and publish reactive state streams that any active desk widget or app can subscribe to without hardcoding service keys in core files.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] `kind: 'service'` plugins can register with full 8-phase lifecycle (install, enable, start, pause, resume, stop, destroy)
- [x] Registered services publish reactive interfaces through `ctx.services.get(serviceId)`
- [x] Core services (`connection`, `remoteLink`, `subscription`, `faceAgent`) migrate to dynamic service registrations without breaking existing consumers
- [x] An audio transcription sample service (`odk.service.audio-transcription`) can register and stream mock/live speech-to-text events
- [x] Stopping or disabling a service cleanly terminates active streams and unsubscribes all listeners
