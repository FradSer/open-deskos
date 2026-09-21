# 04 — The Shell reports required-feature state truthfully

**What to build:** The desk presents the Voice Agent and Hosted Pi control as the runtime's required features, each with real state: ready, needs configuration, or unavailable, with the device-local file to create or fix named in the message. An unconfigured or unplugged feature never reports ready or idle, the microphone control stays inert while the agent cannot capture, and neither feature's state blocks direct touch or keyboard use or takes the other feature down.

**Blocked by:** 01 — Product authority and vocabulary name the required components.

**Status:** ready-for-agent

- [ ] Missing voice configuration reports needs configuration naming the device-local file and the missing setting
- [ ] An absent capture device reports unavailable naming capture, and the microphone control is inert
- [ ] Missing Hosted Pi configuration reports needs configuration naming the device-local file, and no target is claimed reachable
- [ ] Both features unconfigured still leaves the base Shell fully usable through direct touch and keyboard
- [ ] A voice fault does not stop Hosted Pi hosting, and a hosting fault does not stop voice
- [ ] Control attribution keeps naming the driving Console while a required component restarts or fails
- [ ] The existing status contracts carry these states; no new transport or surface is added
