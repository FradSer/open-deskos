# 05 — Managed System Overlay Alert Channel

**What to build:** A controlled system alert interface (`ctx.postOverlayAlert({ title, message, level, timeoutMs })`) that renders high-priority notifications and status cards through a unified, host-managed overlay component, ensuring critical updates are immediately visible without granting plugins uncontrolled DOM overlay permissions.

**Blocked by:** 01 — Dynamic Background Service Registry & Audio Transcription Seam

**Status:** closed

- [x] Shell provides a centralized, host-owned `#system-overlay-root` container with accessible focus and ARIA live regions
- [x] Plugins receive `ctx.postOverlayAlert({ title, message, level, timeoutMs })` through their context
- [x] Overlays display with appropriate urgency levels (info, warning, critical) and support auto-dismiss or user acknowledgment
- [x] The underlying page, status bar, and keyboard/touch navigation remain uncorrupted when an overlay appears and dismisses
- [x] Prevents arbitrary full-screen hijacking by enforcing schema-validated alert payloads
