# 03 — The installer treats required components as required

**What to build:** Installing a release that cannot install the Voice Agent or Hosted Pi control fails as an installation, instead of printing a warning and reporting success. The failure names the component and the device-local file involved. The base Shell unit is still written first, the previous release stays active and keeps serving both capabilities, and a host whose required service is merely unconfigured installs normally and reports that state through the Shell rather than through a crash loop.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] A required-component install failure makes the installation report failure and name the component
- [x] The failure message names the device-local configuration file involved
- [x] The base Shell unit is written before required components, and a required-component failure does not stop the Shell from being installed
- [x] A failed installation leaves the previous release active and serving voice and hosted sessions
- [x] A host without a Hosted Pi configuration still installs the required unit and does not crash-loop
- [x] The existing scenario that conflates installation with runtime configuration is replaced by one scenario per behaviour
- [x] Deployment tests cover the failure path and the forwarded installer arguments
