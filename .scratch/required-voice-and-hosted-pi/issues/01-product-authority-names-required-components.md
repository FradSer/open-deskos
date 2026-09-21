# 01 — Product authority and vocabulary name the required components

**What to build:** Product authority and the domain glossary agree that the Display Shell, the Voice Agent, and Hosted Pi control are the required components of the CM5 runtime, so later gates and docs inherit one classification instead of re-deciding it. `PRODUCT.md` names both components in its active architecture and states the rule this classification establishes: required components are gated at release and installation, while missing device configuration or hardware is reported truthfully and never blocks the base Shell. The Hosted Pi vocabulary in `CONTEXT.md` carries the same required-ness the Voice Agent entry already states. An ADR records the decision and its boundary (install-time required, runtime degradation visible).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `PRODUCT.md` active architecture names the Display Shell, the Voice Agent, and Hosted Pi control, and no longer omits voice
- [ ] `PRODUCT.md` principles state that required components are gated at release and install time, that missing configuration or hardware is visible rather than faked, and that the base Shell stays usable
- [ ] `CONTEXT.md` Hosted Pi entries state required-ness in the same terms as the Voice Agent entry, using no retired or avoided vocabulary
- [ ] An ADR records the classification, the install-versus-runtime boundary, and the device-local configuration rule
- [ ] A test asserts the authority text names the required components, so the classification cannot silently disappear from product authority
- [ ] Existing repository-layout and documentation checks still pass
