# Repository Guidelines

## Project Structure & Module Organization
This is the ESP32-P4 SC2336 generic UVC Camera Peripheral for the active CM5 architecture; it is distinct from preserved P4+C6 DeskOS research. `main/p4_camera_main.c` owns boot and USB composite startup. Sensor logic lives in `main/p4_sc2336.{c,h}`, the capture-to-JPEG-to-UVC pipeline in `main/p4_uvc_stream.{c,h}`, the microphone in `main/p4_usb_microphone.{c,h}`, and the app-owned UVC+UAC descriptors in `main/usb_descriptors.c`. Behavior scenarios are defined in `tests/features/p4-camera.feature`.

## Build, Test & Development Commands
Use ESP-IDF 6.0.1 from this directory:
```sh
eim run 'idf.py set-target esp32p4' v6.0.1
eim run 'idf.py build' v6.0.1
```
Use @README.md for flashing and physical wiring. The CH343P debug connector can flash firmware but cannot carry UVC/UAC; use the native USB data connector for the CM5 link.

## Coding Style & Naming Conventions
- 4-space ESP-IDF C, `snake_case`, focused modules, and explicit `esp_err_t` return handling.
- Preserve SCCB GPIO 7/8, sensor reset GPIO 26, MIPI CSI capture boundary, and the standard UVC MJPEG / UAC PCM device behavior.
- No on-device face or expression analysis, no vendor metadata protocol, and no biometric storage may be reintroduced here: the CM5 consumes this peripheral as a generic webcam and microphone.
- Do not manually edit `build/`, `managed_components/`, `sdkconfig`, `sdkconfig.old`, or dependency output.

## Testing Guidelines
- An ESP32-P4 build validates compilation, not enumeration, video, or audio quality.
- For authorized live acceptance on the CM5, run `bash runtime/linux/scripts/p4-camera-acceptance.sh` and `bash runtime/linux/scripts/p4-microphone-acceptance.sh` from repository root. The camera check writes one MJPEG frame to a temporary `/tmp/p4-camera-frame.*.mjpg` file and removes it on exit; the microphone check streams PCM through a pipe. Both access real sensors.
- Keep raw camera/audio captures and biometric data out of the repository.
