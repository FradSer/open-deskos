# Container deployment cost

## Question

Evaluate the cost to deploy all of Open DeskOS with Docker, or with Apple
Container 1.5.

This evaluation states engineering effort, runtime resources, and operational
risk. It does not state money.

## Scope and interpretation

"All of Open DeskOS" means the seven runtime components: the Display Shell, the
Personal Agent, Hosted Pi control, Open DeskOS Link, the Remote Bridge, the STT
bridge, and the Futu poller. It does not include the ESP32 firmware. Firmware
cannot run in a container.

Two targets are compared, because the answer differs on each:

- **Target A** — Docker on the CM5 Shell Host (Linux arm64).
- **Target B** — Apple Container 1.5 on macOS (Apple silicon).

The macOS Shell Host runs the Shell natively today. Target B asks whether a
container can replace that arrangement.

## Evidence

| Fact | Source |
| --- | --- |
| Installer actions and system changes | [cm5-install.sh](../../runtime/shell/scripts/cm5-install.sh), 319 lines |
| GPU blob and firmware custody | [cm5-gpu-userspace.sh](../../runtime/shell/scripts/cm5-gpu-userspace.sh), [ADR-0016](../../runtime/shell/docs/ARCHITECTURE.md#adr-0016) |
| Release transaction and rollback | [update-runtime.js](../../runtime/shell/scripts/update-runtime.js), [ADR-0018](../../runtime/shell/docs/ARCHITECTURE.md#adr-0018) |
| Service units | `runtime/shell/systemd/`, `integrations/*/systemd/`, `integrations/futu-poller/*.service` — seven user units |
| Channel authentication | [ADR-0025](../../runtime/shell/docs/ARCHITECTURE.md#adr-0025) |
| `container` 1.5.0 run options | `container run --help` on this machine, CLI version 1.5.0 |
| `container` platform and limits | [apple/container README](https://raw.githubusercontent.com/apple/container/main/README.md), [technical overview](https://raw.githubusercontent.com/apple/container/main/docs/technical-overview.md) |
| `docker` 29.4.0 run options | `docker run --help` on this machine |

Show the run-option difference with these commands:

```sh
container run --help | grep -iE 'device|gpu|audio|display'
docker run --help | grep -E '^ *--device|^ *--gpus|^ *--group-add'
```

Apple Container 1.5.0 lists a volume, a published port, a published socket, the
SSH agent, nested virtualization, CPU, and memory. It lists no device, GPU,
audio, USB, or display option. Docker 29.4.0 lists `--device`, `--gpus`,
`--group-add`, `--network`, and `--privileged`.

## Current deployment surface

Each row states one layer, its owner, and whether a container can own it.

| # | Layer | Container can own it | Why |
| --- | --- | --- | --- |
| 1 | Electron system libraries (apt) | Yes | Becomes an image layer |
| 2 | Mali blob, CSF firmware, soname divert | No | The host Xorg server needs the blob. The host kernel loads the firmware |
| 3 | udev rules for the P4 camera and debug port | No | udev runs on the host |
| 4 | CJK font in `/usr/local/share/fonts` | No | Host applications outside the Shell read it |
| 5 | Openbox kiosk window manager and theme | No | The window manager is a host session component |
| 6 | Group membership (video, render, audio, dialout) | Partly | The host X session still needs video and render |
| 7 | Immutable release and update transaction | Yes | An image tag replaces `/opt/odk/releases` |
| 8 | Seven user units | Yes | A container unit replaces each user unit |

Layers 2 to 6 are the container boundary. They are host session and host
hardware concerns, not application concerns.

## Target A: Docker on the CM5

### What works

- Layers 1 and 7 move into the image with a clear gain. An image tag gives the
  same immutability that `update-runtime.js` builds today.
- Input arrives through the X server, not through raw devices. The Shell needs
  the X socket, not `/dev/input`.
- Devices pass with `--device`: `/dev/mali0`, `/dev/video*` for the P4 camera,
  `/dev/snd` for the microphone, and the `/dev/serial/by-id` Remote entry for
  the Remote Bridge.

### What does not work without added work

1. **X session stays on the host.** The container mounts `/tmp/.X11-unix` and an
   X authority file. That changes X access control for a kiosk session. The
   security review is new work.
2. **GPU custody splits.** The container needs the blob and the soname links.
   The host keeps `dpkg-divert`, the firmware, and Xorg glamor. ADR-0016 pins
   the firmware and the blob as one pair. A split pair adds a version check
   between the image and the host.
3. **Ownership-authenticated sockets restrict the split.** ADR-0025 authenticates
   a Unix channel by file ownership. Two containers that share a channel need
   one UID and one shared volume, or the token path. One container for all
   co-resident services avoids this work.
4. **User units lose their session coupling.** `After=graphical-session.target`,
   `PartOf=`, and `systemctl --user import-environment` have no container
   equivalent. The autostart entry must restart a container instead.
5. **State becomes volumes.** `/opt/odk/state`, migrations, `ODK_WORKSPACE`,
   `~/.config/odk/*.env`, and the Pi auth storage move to mounts. Each mount is
   a new place for a mode or an ownership fault.
6. **The acceptance scripts lose their evidence.** `cm5-acceptance.sh` reads the
   active and rollback releases. An image tag has no `release.json`. The script
   needs a rewrite before it can state a result.
7. **Fixed runtime cost.** The Docker daemon needs memory on an SBC. An image
   with Electron 43.4.1 (296 MB) and the production bot dependencies adds
   about 1.0 GB to 1.5 GB of storage. Two retained releases already need about
   1.0 GB.

### Estimate

First working container set: 8 to 15 person-days. The estimate counts the work
to replace the installer, seven units, the release transaction, and the
acceptance scripts. It is an inspection estimate, not a measured one. No
prototype was built.

Hardware re-acceptance is separate and mandatory. Every gate in the
[Shell runbook](../../runtime/shell/README.md) must run again on the CM5:
kiosk startup, EGL and glamor, P4 camera, P4 microphone, S3 Remote input, and
Tailscale. A container changes the GPU path and the device path, so a host test
cannot carry the earlier result.

## Target B: Apple Container 1.5 on macOS

Apple Container 1.5.0 requires Apple silicon and macOS 26. It runs one
lightweight Linux VM per container. It does not return freed memory to macOS.

The run options decide this target. There is no display output, no GPU, and no
host device. Therefore:

| Component | Can run | Blocker |
| --- | --- | --- |
| Display Shell | No | No display path from a Linux VM to the macOS desktop, and no GPU |
| Personal Agent | No | The microphone is a host device |
| Hosted Pi control | Yes | Needs SSH and auth volumes |
| Open DeskOS Link | Yes | `--publish-socket` publishes the listener to the host |
| Remote Bridge | No | The S3 Remote is a USB device on the host |
| STT bridge | Yes | HTTP on loopback, no device |
| Futu poller | Yes | Network only |

Three of seven components can move. This is not a whole-product deployment.

The gain is also small on a single-user Mac. The Shell runs natively today and
keeps its macOS integration. A container adds an isolation boundary and removes
that integration.

Docker Desktop on macOS runs containers in one Linux VM. Its device and display
limits are in the same class as Target B. This evaluation did not verify the
Docker Desktop details. Verify them before you rely on that path.

## Comparison

| Measure | Target A: Docker on CM5 | Target B: Apple Container 1.5 |
| --- | --- | --- |
| Components that can run in a container | 7 of 7, with a host-resident session layer | 3 of 7 |
| Shell runs | Yes, through the host X server | No |
| GPU | Yes, with a split blob pair | No |
| Camera, microphone, USB input | Yes, with `--device` | No |
| Effort, first working deployment | 8 to 15 person-days (estimate) | Not applicable to the whole product |
| Gain over today | Reproducible host image | None for the Shell |

## What containers do fit

These changes carry low risk and do not change the product boundary:

1. **A build and test image.** Run the Electron headless tests under Xvfb, the
   ESP-IDF builds, and `pnpm preflight` in one image on the Mac and in CI. This
   removes host toolchain setup and needs no hardware.
2. **Headless services later.** The STT bridge and the Futu poller have no
   device requirement and no display requirement. Define them as images when a
   second desk host appears.
3. **Firmware builds.** The IDF toolchain is the largest host setup step. An
   image can hold it without touching the Shell.

## Limits of this evaluation

- No container was built or run. The effort numbers come from file inspection.
- The Docker Desktop on macOS path is not verified.
- The Mali blob inside a container is not proven. Chromium ANGLE with the blob
  and a container X client is an untested combination.
- The Apple Container facts come from the 1.5.0 CLI and the current branch
  documentation. A later version can add device support.
- A container result cannot replace any hardware gate.

## Verdict

Do not containerize the reference Shell.

On macOS, Apple Container 1.5 cannot run the Shell, the microphone, the camera,
or the USB input. It can host three headless services at most.

On the CM5, the container boundary stops at the X server, the Mali blob
custody, udev, and the host fonts. A container replaces the installer and the
release transaction, and it leaves the hard parts on the host. The gain is one
reproducible image. The cost is a rewrite of the unit and release layer, plus
re-acceptance of every hardware gate.

Containerize the build and test toolchain first. It has a clear gain, no product
change, and no hardware gate. Reconsider a service image when a second desk host
needs the same deployment.