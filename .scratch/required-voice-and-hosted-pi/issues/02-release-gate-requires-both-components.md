# 02 — The release gate requires both required components

**What to build:** A release candidate that cannot serve voice or cannot host a Pi session never activates. Composition validation rejects a candidate whose voice integration source entry, systemd unit template, or installed production dependencies are missing or resolve outside the release, and rejects a candidate missing the Hosted Pi control unit template, naming the missing component in the reason. A candidate carrying both components validates as before.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] A candidate containing the voice integration, its unit template, and its resolving production dependencies passes composition validation
- [x] A candidate missing the voice integration source is rejected with a reason naming voice
- [x] A candidate missing the Hosted Pi control unit template is rejected with a reason naming that component
- [x] A candidate whose voice dependencies resolve outside the release is rejected
- [x] Rejection happens before activation, so the active release is unchanged
- [x] The rejection reaches the operator through the existing preflight failure path and its recorded update state
- [x] Scenarios from the spec are stored in the runtime release feature file
- [x] Runtime suite green, including the new behavioural tests at the release-composition seam
