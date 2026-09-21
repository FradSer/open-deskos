# 06 — Device acceptance for the required components

**What to build:** On the CM5, one staged release proves the classification end to end: installation succeeds with both required components, each feature reports its true state on the desk, an installation that cannot install a required component leaves the previous release active and serving, and a release update carries the Voice Agent with it instead of a versioned side directory.

**Blocked by:** 02 — The release gate requires both required components. 03 — The installer treats required components as required. 04 — The Shell reports required-feature state truthfully. 05 — Deployment documentation matches the required-component rules.

**Status:** ready-for-agent

- [ ] A staged release installs and activates with both required components present
- [ ] The desk reports the real state of both features, including needs configuration when a setting is missing
- [ ] An induced required-component installation failure leaves the previous release active and serving voice and hosted sessions
- [ ] The activated release is traceable to a commit, and the voice service runs from the active release path
- [ ] No unit on the host references a dated release directory
- [ ] Findings and any operator-facing follow-up are reported on the feature tickets
