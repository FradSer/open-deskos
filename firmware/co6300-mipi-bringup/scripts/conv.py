import re, glob, os
DIR="/Users/FradSer/Downloads/3.19寸CO6300-MIPI资料"
src=glob.glob(os.path.join(DIR,"*.txt"))[0]
lines=open(src,encoding="utf-8",errors="replace").read().splitlines()
out=[]; pending=None; skipped=[]; unparsed=[]
def flush(delay=0):
    global pending
    if pending is None: return
    cmd,params=pending
    if params:
        arr=", ".join(f"0x{p:02X}" for p in params)
        out.append(f"    {{0x{cmd:02X}, (uint8_t[]){{{arr}}}, {len(params)}, {delay}}},")
    else:
        out.append(f"    {{0x{cmd:02X}, NULL, 0, {delay}}},")
    pending=None
for raw in lines:
    line=raw.strip()
    if not line: continue
    m=re.match(r'(?i)delay\s+(\d+)',line)
    if m: flush(int(m.group(1))); continue
    if line.startswith('//'): continue
    code=line; comment=''
    if '//' in line:
        i=line.index('//'); code=line[:i].strip(); comment=line[i+2:].strip().lower()
    if not code: continue
    if 'mipi remove' in comment or 'mipi  remove' in comment:
        flush(0); skipped.append(raw.strip()); continue
    m=re.match(r'(?i)^R([0-9A-Fa-f]{2})((?:\s+[0-9A-Fa-f]{2})*)\s*$',code)
    if not m:
        flush(0); unparsed.append(raw.strip()); out.append(f"    // UNPARSED: {raw.strip()}"); continue
    flush(0)
    cmd=int(m.group(1),16)
    params=[int(x,16) for x in m.group(2).split()] if m.group(2).strip() else []
    pending=(cmd,params)
flush(0)
body="\n".join(out)
open("/private/tmp/claude-501/-Users-FradSer-Developer-FradSer-cerberus/41b90f8b-7c78-42d8-93da-a96dcb67cef2/scratchpad/init_array.txt","w").write(body)
cmdcount=sum(1 for l in out if l.strip().startswith("{"))
print(f"### converted commands: {cmdcount}")
print(f"### skipped (mipi remove): {skipped}")
print(f"### UNPARSED lines: {unparsed}")
print("### FIRST 8:")
print("\n".join(out[:8]))
print("### LAST 12:")
print("\n".join(out[-12:]))
