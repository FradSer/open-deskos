# CO6300 (262×928 AMOLED) MIPI-DSI bring-up — working archive

Persistent snapshot of the ESP32-P4 + 3.19" AMOLED bring-up effort (was living in `/tmp`, which is wiped on reboot). Saved 2026-06-24.

## Hardware
- **Panel:** BOE `AM319M262928ZS` (silk also `ZS319M262928HFL`), 262×928 AMOLED, MIPI **1-lane**, 30-pin FFC (Kyocera OK-23GM030-04).
- **Driver IC:** Chipone **CO6300** (after-code header also calls it `ICNA3312`) — NOT Raydium RM690C0 as earlier assumed. PMIC `ZP3112`. Touch `ZT2628` (I2C, works: 0x18/0x58).
- **MCU board:** osptek ESP32-P4 module (dev board; NOT the Open DeskOS LUMINA-P4 custom PCB). Serial usually `/dev/cu.usbmodem5B79...`.
- **Schematic GPIO map (this dev board):** LCD_TE=GPIO4, LCD_RST=GPIO5, TP_RST=GPIO6, I2C_SDA=GPIO7, I2C_SCL=GPIO8, VCI_EN(=LCD_BL net)=GPIO20, TP_INT=GPIO21. DSI lanes on the P4's dedicated DSI pads.

## STATUS: NEVER LIT. Root cause narrowed to the DSI command link.
The panel has never displayed anything. Touch I2C is alive but **the DSI link does not work**:
- **DSI read** (RDDID 0x04) hangs forever — proven via `addr2line` on the watchdog dump: stuck in `mipi_dsi_host_ll_gen_is_read_fifo_empty` ← `mipi_dsi_hal_host_gen_read_short_packet` ← `panel_io_dbi_rx_param`. The panel never returns a read response.
- **DSI command writes** stall at the ~16th write — the DesignWare gen-cmd FIFO fills and `gen_is_cmd_fifo_full` spins forever (task watchdog).
- Reproduces on the **vendor's unmodified reference** firmware, on **both IDF 5.5.1 and 6.0.1**.

### Why (per ESP-IDF maintainer + issues #15137, #15358)
`esp_lcd_panel_io_dbi.c` hardcodes `mipi_dsi_host_ll_enable_cmd_ack(host, true)` → every DCS command (sent in **LP mode**) busy-waits for a panel BTA-ACK with **no timeout**. If the panel doesn't ACK (not connected / poor signal / rails not up), the FIFO fills and the firmware hangs. So the "stall at 16" is a known esp_lcd signature, not unique to us.

## What has been RULED OUT
- Init content: tried 15-cmd stub, vendor AFT-MTP, full **538-cmd** init — all same.
- IDF version: 5.5.1 and 6.0.1 stall identically.
- VCI_EN pin (GPIO20 vs 22), LCD_RST (driven vs not).
- 2 adapter boards, the panel (swapped earlier), and the 15-pin FFC (new ribbon) — all unchanged behavior.
- QSPI alternative: not viable — this BOE module's FFC is MIPI-1-lane-wired; CO6300 supports QSPI at the die but the panel doesn't break out QSPI pins.

→ The only never-swapped common element is the **P4 module's DSI PHY**. Physics: an LP command write is host-driven and should complete regardless of receiver, so "FIFO never drains" points at the P4 side.

## NEXT STEPS (in order — also in the Apple reminder due 2026-06-24 23:00)
1. **`cmd_ack = false` experiment (TOP, patch already applied to the global IDF):**
   In `~/.espressif/v6.0.1/esp-idf/components/esp_lcd/dsi/esp_lcd_panel_io_dbi.c:38`, `enable_cmd_ack(host, true)` → `false`. Makes writes fire-and-forget → the 538-cmd init drains/completes even without a panel ACK.
   - init completes **+ panel lights** ⇒ FIXED (panel received but wasn't ACKing).
   - init completes **but black** ⇒ commands aren't reaching the panel ⇒ PHY/link/hardware.
   - Original file backed up at `patches/esp_lcd_panel_io_dbi.c.ORIG` — **restore it when done** (it's a global IDF edit affecting all projects).
2. **Cheap hardware checks** (if cmd_ack=false drains but stays black):
   - Meter **VDD_MIPI_DPHY ≈ 2.5 V** (the "MIPI DSI PHY Powered on" log only means the LDO acquire returned, not that 2.5V reached the pin). LDO = VO3 / `chan_id 3` (firmware already uses 3 ✓).
   - Verify **DSI_REXT (P4 pin 34) has its 4.02 kΩ resistor to GND** — sets D-PHY bias; missing ⇒ PHY won't drive lanes even with power. Commonly-missed dead-PHY cause.
   - Scope the DSI CLK pair for HS activity during init.
3. **Swap the P4 module** — the decisive test if software + the two hardware checks don't explain it.

## Folder contents
- `project-idf6.0.1/` — the IDF 6.0.1 project: full **538-cmd CO6300 init** in `main/main.c` (262×928, VCI_EN=GPIO20, reset=GPIO5), driver `components/esp_lcd_co6300/` patched with: skip RDDID, per-command init logging, WDT-feed delay. Build with IDF 6.0.1. (`build/` + `managed_components/` were excluded — run `idf.py reconfigure` to refetch esp_lvgl_port/lvgl.)
- `project-idf5.5.1/` — same full init ported to vendor-native IDF 5.5.1 (the version that also stalled at init[17]).
- `co6300_init_538cmds.txt` — the generated C init array (538 entries) from the vendor after-code.
- `scripts/` — `conv.py` (after-code → C array, drops the 1 SPI-only `RC4 80` line), `splice.py` / `splice_pristine.py` (splice the array into main.c).
- `logs/` — diagnostic boot logs: `log_ref.txt` (vendor reference RDDID hang), `log551.txt` (5.5.1 init[17] stall), `log_newffc.txt` (new-FFC still-stalls).
- `patches/esp_lcd_panel_io_dbi.c.ORIG` — pristine IDF DBI file to restore after the cmd_ack experiment.
- `reference/` — vendor `after_code` init source, the ZS panel spec PDF, and the DPI-timing screenshot.

## Source-of-truth materials (NOT copied — large, live in Downloads, also persistent)
- `~/Downloads/3.19寸CO6300-MIPI资料/` — the full vendor pack incl. the **243-page CO6300 datasheet** (`CO_6300_Datasheet_...pdf`, ~11 MB), CST3530 touch datasheet, and the original IDF reference project.

## Rebuild / flash
```sh
source ~/.espressif/tools/activate_idf_v6.0.1.sh
idf.py -C project-idf6.0.1 reconfigure          # refetch managed_components first time
idf.py -C project-idf6.0.1 -p /dev/cu.usbmodem5B79... flash
# read boot log: any serial reader at 115200; watch init[N] progress + I2C scan
```

See also the Claude memory note `p4-amoled-bringup-recipe.md` for the full chronological investigation.
