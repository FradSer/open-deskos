# 05 — Deployment documentation matches the required-component rules

**What to build:** The deployment documentation states what the OS now requires: the Voice Agent and Hosted Pi control are required components of a release, the installer stages both with the stable release path, their services start once the host has its device-local configuration, and an installation that cannot install a required component fails instead of reporting success. Documentation no longer implies either component is an optional extra.

**Blocked by:** 01 — Product authority and vocabulary name the required components. 02 — The release gate requires both required components. 03 — The installer treats required components as required.

**Status:** ready-for-agent

- [ ] Voice deployment documentation states the component is required and gated at release and install time, while its service starts once the host is configured
- [ ] Hosted Pi documentation states the component is required, staged by the installer with the stable path, and enabled once the host is configured
- [ ] Both documents name the device-local configuration files an operator creates or fixes
- [ ] No document describes either component as an optional add-on or a warning-only failure
- [ ] Documentation checks that read these files still pass
