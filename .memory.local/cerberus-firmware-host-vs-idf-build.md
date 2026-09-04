---
name: cerberus-firmware-host-vs-idf-build
description: Open DeskOS 固件 host 构建绿 ≠ idf.py build 绿; 三类 IDF-only 陷阱(REQUIRES/format-truncation/注释中 */+ EMBED GC) + 无屏板条目、分区表、CDPATH
type: project
---

`tests/host/CMakeLists.txt` 把所有 `cerb_*/src` glob 进一个库、放松标志。**host 8/8 绿不代表 `idf.py build` 会过**。已踩实三类只在 IDF 下暴露的陷阱:

1. **组件间 REQUIRES**: 每个 `cerb_*/CMakeLists.txt` 必须在 `REQUIRES` 里列出其 `#include` 的其他 cerb 组件。缺则报 "X.h ... is not in the requirements list"。
2. **`-Werror=format-truncation`**(IDF 默认开, host 不开): `snprintf(dst[N], N, "%s/suffix", src[N])` 当 src 声明大小 == dst 时必报。干净修法=放大叶子缓冲或检查 snprintf 返回值; 别用 `-Wno-error` 压。
3. **C 块注释里的 `*/`**: 注释中写 `cerb_*/src` 的 `*/` 会提前闭合注释 → 诡异语法错。禁在注释里出现 glob 字面量 `*/`。
4. **EMBED_FILES 符号 GC** (已修 `c6ea2ec`): 用 `#ifdef ESP_PLATFORM` 做 host/target 分流读模板(设备端读 EMBED_FILES 嵌入符号, host 走 `__FILE__` + `fopen`)。EMBED_FILES 符号若不被 C 代码 `extern` + 引用, 最终 elf 里被 GC 掉 → 设备读不到。同类问题再遇: 必须确保 C 代码实际引用嵌入符号。

**其它固件事实:**
- **无屏板条目** `boards/open-deskos/cerberus_p4_headless`: `board_devices.yaml` 不声明 display/touch, 构建/可烧但无 UI。
- **分区表**: fork 的 `flash_partition_defaults.cmake` 会按 flash 容量覆盖 board 分区表; 已改为 board 优先。改分区后需 `rm -f sdkconfig` 强制重新 configure。
- **构建前置**: 用 eim + IDF 6.0.1；`idf.py bmgr -c` 需 venv 里 `pip install esp-bmgr-assist`。P4 DSI 版本约束见 [[idf-toolchain-activate]]。
- **CDPATH**: 本机导出了 CDPATH, 跑 host `cmake`/`ctest` 及 scripts 需前缀 `env -u CDPATH`, 否则 `$(cd ... && pwd)` 双回显路径。冷 `idf.py build` 10+ 分钟, 后台跑轮询。

**Why:** host 测试用 `__FILE__` 路径通过; 设备同路径 fopen 失败 → NULL → `cerb_composition.c:302` 的 `ESP_RETURN_ON_FALSE` → `0x103` → 平台 banner 不出。host-vs-target 分歧典型。

**How to apply:** host 绿后, 逐项检查: REQUIRES 完整, 无 snprintf 截断, 无 `*/` 在注释中, EMBED 符号被引用。再跑 `idf.py build`。

**Related:** [[idf-toolchain-activate]] [[cerberus-native-sdl-sim]]