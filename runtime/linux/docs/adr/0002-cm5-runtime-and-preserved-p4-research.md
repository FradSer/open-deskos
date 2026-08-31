# CM5 runtime and preserved P4 research boundary

## Status

Accepted

## Context

Open DeskOS is now organized around the CM5/Linux desk runtime. The repository also contains two distinct ESP32-P4 uses that must not be conflated: the prior P4+C6 DeskOS device OS and the P4 SC2336 camera sub-device for the CM5 architecture. The Apple client is coupled to the prior P4+C6 device through USB serial subscription and time commands.

## Decision

- CM5/Linux is the active Open DeskOS runtime.
- The ESP32-S3 Remote Control and ESP32-P4 SC2336 Camera Sub-device are intended architecture peripherals, each gated by independent hardware acceptance. Base CM5 installation and direct touch/keyboard use remain available without either.
- The prior P4+C6 DeskOS device OS is preserved research, not an active product authority.
- Apple platform code belongs to the preserved P4+C6 research line; the active CM5 runtime has no Apple dependency.
- A physical repository migration will separate active runtime, required-peripheral integrations, opt-in experiments, and preserved P4+C6 research without deleting any experimental assets.

## Consequences

Root product documentation must describe CM5/Linux first. P4+C6 specifications, simulators, firmware, and Apple USB companion contracts must move with the preserved research line and may not define CM5 release gates. The P4 camera remains with CM5 integrations, not with the prior P4+C6 DeskOS research tree.
