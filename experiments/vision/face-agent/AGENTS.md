# Repository Guidelines

## Project Structure & Module Organization
This is the opt-in Face Agent experiment for the active CM5 runtime. `face_service.py` is installed by deployment scripts only when experimental vision is enabled. `systemd/open-deskos-face-agent.service` is a graphical-user service. The deployed `/opt/face-agent/` supplies runtime models, owner profiles, and `face_engine.py`. This repository scope owns the service overlay and unit file.

## Build, Test & Development Commands
From repository root:
```sh
python3 -m py_compile experiments/vision/face-agent/face_service.py
```
Test camera access, OpenCV pipeline, and systemd service lifecycle directly on the CM5 hardware; host checks cannot validate local vision models or physical camera streams.

## Coding Style & Naming Conventions
- Standard Python 3 with 4-space indentation.
- Keep `/status` loopback-only and maintain fail-closed lifecycle states: `starting`, `no-frame`, `camera-unavailable`, and `online`.
- Do not expose video frames, user profiles, model paths, raw inference outputs, or identity details beyond the normalized status contract.
- Owner recognition must never gate base shell startup, touch interaction, or display rendering.

## Testing Guidelines
- Verify Python syntax with `py_compile` before submitting changes.
- Ensure integration contracts in parent test suites pass when updating status or lifecycle models.

## Commit & Pull Request Guidelines
- Use focused Conventional Commits (`feat(vision):`, `fix(vision):`, `refactor(vision):`).
- Report host syntax checks and applicable CM5 hardware validation.
- Never commit model weights, facial profiles, video recordings, biometric data, virtual environments, `__pycache__`, or credentials.
