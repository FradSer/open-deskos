# Repository Guidelines
## Project Structure & Module Organization
This is the opt-in Face Agent experiment for the active CM5 runtime. `face_service.py` is installed by `runtime/linux/scripts/cm5-install.sh` only when experimental vision is enabled. `systemd/open-deskos-face-agent.service` is a graphical-user service. Electron may consume only the normalized loopback status through `runtime/linux/src/face-agent-status.js`; behavior and checks live in `runtime/linux/tests/features/linux-shell.feature` and `runtime/linux/tests/face-agent-*.test.js`.
The deployed `/opt/face-agent/` supplies models, owner profiles, `face_engine.py`, and other provisioned source. This repository owns only the service overlay and unit file.
## Build, Test & Development Commands
From repository root:
```sh
(cd runtime/linux && pnpm test)
python3 -m py_compile experiments/vision/face-agent/face_service.py
```
Test camera access and systemd behavior on CM5 separately; host checks cannot validate models or a real camera.
## Coding Style & Testing Guidelines
Use standard Python with 4-space indentation. Keep `/status` loopback-only and preserve fail-closed lifecycle states: `starting`, `no-frame`, `camera-unavailable`, and `online`. Do not expose frames, profiles, model paths, raw inference data, or identity decisions beyond the normalized status contract. Owner recognition cannot gate base-shell installation, boot, touch, keyboard, or visibility. Add/update the parent Gherkin scenario and matching Node test before behavior changes.
## Commit & Pull Request Guidelines
Use focused Conventional Commits and report host plus applicable CM5 validation. Never commit models, profiles, recordings, biometric output, virtual environments, `__pycache__`, credentials, or secrets.
