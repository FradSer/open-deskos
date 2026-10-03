# CM5 runtime and preserved P4 research boundary

## Status

Accepted

Host scope amended by [ADR-0035](0035-the-shared-shell-has-a-host-neutral-source-root.md): Linux, Windows x64, and macOS share the active Shell; CM5 remains the reference host.

## Context

Open DeskOS is now organized around the CM5/Linux desk runtime. The repository also contains two distinct ESP32-P4 uses that must not be conflated: the prior P4+C6 DeskOS device OS and the P4 SC2336 camera sub-device for the CM5 architecture. The Apple client is coupled to the prior P4+C6 device through USB serial subscription and time commands.

## Decision

- CM5/Linux is the reference host for the active shared Open DeskOS Shell.
- The ESP32-S3 Remote Control and ESP32-P4 SC2336 Camera Sub-device are intended architecture peripherals, each gated by independent hardware acceptance. Base CM5 installation and direct touch/keyboard use remain available without either.
- The prior P4+C6 DeskOS device OS is preserved research, not an active product authority.
- The Apple USB companion belongs to the preserved P4+C6 research line; the shared Shell can run on macOS without depending on that companion.
- A physical repository migration will separate active runtime, required-peripheral integrations, opt-in experiments, and preserved P4+C6 research without deleting any experimental assets.

## Consequences

Root product documentation must distinguish the shared Shell from its CM5/Linux reference host. P4+C6 specifications, simulators, firmware, and Apple USB companion contracts must move with the preserved research line and may not define CM5 release gates. The P4 camera remains with CM5 integrations, not with the prior P4+C6 DeskOS research tree.
