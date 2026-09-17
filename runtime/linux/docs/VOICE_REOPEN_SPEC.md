# Reopen background voice feedback

Confirmed: Back only hides feedback. If a current interaction is hidden, the next MIC restores its latest input, reply and status without sending a recording toggle. This includes running, recording, completed and failed interactions. Only a subsequent MIC on a visible completed/failed interaction starts another recording; on a visible recording it submits; while starting/submitting/transcribing/thinking it does nothing. With no interaction, MIC starts normally. Background updates and completion never reopen dismissed feedback by themselves.

The renderer owns visibility and whether an interaction has been activated. Remote MIC therefore requests a renderer decision through preload, rather than toggling the service in main unconditionally. The existing narrow recording toggle IPC remains main-owned and rejects busy state and duplicate pending toggles; optimistic feedback must never claim Preparing for a running task. No additional control, provider work, deployment or task cancellation is introduced.

Tests: feature-first public main routing + preload + actual Electron voice DOM; verify hidden restore does not call toggle, latest output retained, second visible MIC follows state policy, Back/focus restored, no old background result opens on first use, busy/rapid MIC does not queue another capture.
