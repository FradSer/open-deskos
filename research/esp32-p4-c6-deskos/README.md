# Preserved ESP32-P4+C6 DeskOS research

This directory preserves a prior parallel Open DeskOS exploration. In that architecture, ESP32-P4 was the UI/HID/voice host and ESP32-C6 was the Wi-Fi/ESP-NOW coprocessor. It includes the original ESP-IDF firmware, Lua/LVGL/AIODI shell, native simulator, host contracts, specifications, historical reviews, board references, and Apple USB serial companion.

It remains in the repository so the work can be built, studied, and reused deliberately. It is not the active Open DeskOS runtime and must not define the CM5/Linux product’s requirements, boot path, peripheral acceptance, UI parity, or release gates.

## Contents

- `firmware/` — ESP-IDF firmware, boards, simulator, host tests, and tools.
- `apple/` — P4 USB serial subscription/time bridge and management client.
- `docs/` — prior product definition, P4+C6 specifications, architecture, and historical reviews.
- `reference/` — P4/Guition hardware and LVGL performance notes.

The active product lives at [../../runtime/linux/](../../runtime/linux/).