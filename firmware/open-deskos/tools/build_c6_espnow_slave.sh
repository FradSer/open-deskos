#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
slave="$root/application/edge_agent/managed_components/espressif__esp_hosted/slave"
tracked="$root/application/c6_espnow_bridge"

if [[ ! -d "$slave" ]]; then
  echo "ESP-Hosted slave checkout missing: $slave" >&2
  exit 1
fi

cp "$tracked/odk_c6_espnow_bridge.c" "$slave/main/odk_c6_espnow_bridge.c"
cp "$tracked/odk_c6_espnow_bridge.h" "$slave/main/odk_c6_espnow_bridge.h"
cp "$slave/main/CMakeLists.txt" "$slave/main/CMakeLists.txt.cerb-backup"
cp "$slave/main/esp_hosted_coprocessor.c" "$slave/main/esp_hosted_coprocessor.c.cerb-backup"
trap 'rm -f "$slave/main/odk_c6_espnow_bridge.c" "$slave/main/odk_c6_espnow_bridge.h"; mv -f "$slave/main/CMakeLists.txt.cerb-backup" "$slave/main/CMakeLists.txt"; mv -f "$slave/main/esp_hosted_coprocessor.c.cerb-backup" "$slave/main/esp_hosted_coprocessor.c"' EXIT

python3 - "$slave/main/CMakeLists.txt" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
needle = 'set(COMPONENT_SRCS\n'
if 'odk_c6_espnow_bridge.c' not in s:
    s = s.replace(needle, needle + '\t"odk_c6_espnow_bridge.c"\n', 1)
p.write_text(s)
PY

printf '\nCONFIG_ODK_C6_ESPNOW_BRIDGE=y\n' >> "$slave/sdkconfig.defaults.esp32c6"
python3 - "$slave/main/esp_hosted_coprocessor.c" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('#ifdef CONFIG_EXAMPLE_PEER_DATA_TRANSFER\n#include "example_peer_data_transfer.h"\n#endif', '#include "odk_c6_espnow_bridge.h"', 1)
s = s.replace('#ifdef CONFIG_EXAMPLE_PEER_DATA_TRANSFER\n\texample_peer_data_transfer_init();\n#endif', '\todk_c6_espnow_bridge_init();', 1)
p.write_text(s)
PY

cd "$slave"
idf.py set-target esp32c6
idf.py build
cp build/network_adapter.bin "$root/application/edge_agent/main/network_adapter.bin"
echo "Built C6 ESP-NOW bridge and embedded network_adapter.bin"
