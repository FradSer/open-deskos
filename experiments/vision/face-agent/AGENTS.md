# Repository Guidelines

## Project Structure & Module Organization

`face_service.py` is the Python service overlay installed by `runtime/linux/scripts/cm5-install.sh` when experimental vision is explicitly enabled. `systemd/open-deskos-face-agent.service` runs it as the graphical user’s systemd service. Electron reads only `http://127.0.0.1:8790/status` through `runtime/linux/src/face-agent-status.js`; the behavior contract and executable checks live in `runtime/linux/tests/features/linux-shell.feature` and `runtime/linux/tests/face-agent-*.test.js`.

The deployed `/opt/face-agent/` supplies models, owner profiles, `face_engine.py`, and other vision source. This repository updates only the overlay service implementation and unit definition; do not add those provisioned artifacts here.

## Build, Test & Development Commands

From the repository root, verify service changes with:

```sh
(cd runtime/linux && pnpm test)
python3 -m py_compile experiments/vision/face-agent/face_service.py
```

The CM5 installer requires arm64, creates `/opt/face-agent-venv` with system OpenCV/AioHTTP/NumPy, installs ONNX Runtime, then enables the user service before kiosk autostart. Test a real camera and systemd lifecycle on the CM5 separately; host tests do not verify camera access or model inference.

## Coding Style & Testing Guidelines

Use standard Python with 4-space indentation. Keep `/status` loopback-only and preserve fail-closed lifecycle states: `starting`, `no-frame`, `camera-unavailable`, and `online`. Do not expose camera frames, owner profiles, model paths, or raw inference results to Electron beyond the normalized status contract. Retain timeouts around camera open/read work so the status server remains responsive.

Add or update the parent Given/When/Then scenario and matching Node contract test before changing behavior. Do not commit model files, profiles, camera recordings, biometric outputs, virtual environments, `__pycache__/`, or credentials.

## Commit & Pull Request Guidelines

Use focused Conventional Commits. Report the host tests and, when applicable, CM5 service/camera verification separately. Never place production models, owner data, or secrets in commits or logs.
