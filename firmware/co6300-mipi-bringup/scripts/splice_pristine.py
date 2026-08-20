import re
SP="/private/tmp/claude-501/-Users-FradSer-Developer-FradSer-cerberus/41b90f8b-7c78-42d8-93da-a96dcb67cef2/scratchpad"
mainc="/tmp/osptek-pristine/examples/P4-IDF_CO6300-MIPI_ESP-LVGL-PORT_V9/main/main.c"
body=open(f"{SP}/init_array.txt").read()
src=open(mainc).read()
open(f"{SP}/pristine_main_c.bak","w").write(src)
new_array=("// === ICNA3312/CO6300 full after-code init (538 cmds) — IDF 5.5.1 native test ===\n"
"static const co6300_lcd_init_cmd_t lcd_init_cmds[] = {\n"+body+"\n};\n")
pat=re.compile(r'(?:^//[^\n]*\n)*static const co6300_lcd_init_cmd_t lcd_init_cmds\[\] = \{.*?\n\};\n', re.DOTALL|re.MULTILINE)
src2,n=pat.subn(new_array,src,count=1); assert n==1,f"got {n}"
src2=src2.replace("#define MIPI_DSI_LCD_H_RES 272","#define MIPI_DSI_LCD_H_RES 262  // CO6300 真实 262")
open(mainc,"w").write(src2)
seg=src2[src2.index("lcd_init_cmds[] = {"):]; seg=seg[:seg.index("\n};")]
print("replacements:",n,"| init entries:",seg.count("},"),"| H_RES:",[l for l in src2.splitlines() if "#define MIPI_DSI_LCD_H_RES" in l])
