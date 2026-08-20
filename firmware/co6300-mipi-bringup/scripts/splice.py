import re
SP="/private/tmp/claude-501/-Users-FradSer-Developer-FradSer-cerberus/41b90f8b-7c78-42d8-93da-a96dcb67cef2/scratchpad"
mainc="/tmp/osptek-amoled/examples/P4-IDF_CO6300-MIPI_ESP-LVGL-PORT_V9/main/main.c"
body=open(f"{SP}/init_array.txt").read()
src=open(mainc).read()
# backup
open(f"{SP}/main_c.bak","w").write(src)
new_array = (
"// === ICNA3312 (CO6300) 厂家完整 init — 来自 AM319M262928ZS after-code (V0.4 20250403), MIPI 变体 ===\n"
"// 562 行 RFE 分页寄存器序列; QSPI/SPI 专属行已剔除 (RC4 80)。CASET=6..267 (262宽, 偏移6)。\n"
"static const co6300_lcd_init_cmd_t lcd_init_cmds[] = {\n"
+ body + "\n};\n"
)
# replace the existing lcd_init_cmds[] = { ... }; block (and any preceding comment line we added)
pat = re.compile(r'(?:^//[^\n]*\n)*static const co6300_lcd_init_cmd_t lcd_init_cmds\[\] = \{.*?\n\};\n', re.DOTALL|re.MULTILINE)
src2, n = pat.subn(new_array, src, count=1)
assert n==1, f"expected 1 replacement, got {n}"
open(mainc,"w").write(src2)
# report
import subprocess
cnt = src2.count("(uint8_t[])") + src2.count("NULL, 0,")
print("replacements:", n)
print("H_RES line:", [l for l in src2.splitlines() if "MIPI_DSI_LCD_H_RES" in l])
print("init array entries (approx):", src2[src2.index("lcd_init_cmds[]"):].count("},", 0, src2[src2.index("lcd_init_cmds[]"):].index("\n};")) if "lcd_init_cmds[]" in src2 else "?")
# precise count of init entries
seg = src2[src2.index("lcd_init_cmds[] = {"):]
seg = seg[:seg.index("\n};")]
print("init entries:", seg.count("},"))
print("VCI_EN line:", [l for l in src2.splitlines() if "LCD_VCI_EN_GPIO GPIO" in l])
print("reset_gpio line:", [l for l in src2.splitlines() if "reset_gpio_num =" in l])
