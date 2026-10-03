import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

MANIFEST_ST7789 = """{
  "schemaVersion": 1,
  "id": "odk.s3.driver.st7789",
  "name": "ST7789 Display Driver",
  "version": "1.0.0",
  "kind": "device-driver",
  "host": "esp32-s3",
  "provides": [
    { "interface": "odk.driver.display/v1" }
  ],
  "requires": [
    { "interface": "odk.port.spi/v1", "optional": false }
  ]
}"""


class TestCodegenPluginDescriptor(unittest.TestCase):
    def test_c_descriptor_generation(self):
        compiler = shutil.which("cc")
        if compiler is None:
            self.skipTest("Host C compiler required for descriptor acceptance")
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            m_path = root / "manifest.json"
            h_path = root / "out.h"
            c_path = root / "out.c"
            manifest = json.loads(MANIFEST_ST7789)
            manifest["name"] = 'Panel "A" \\ ??/\n\t\x00\x1f Control'

            with open(m_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f)

            res = subprocess.run(
                [sys.executable, str(Path(__file__).resolve().parents[3] / "tools/codegen_plugin_descriptor.py"), h_path, c_path, m_path],
                capture_output=True,
                cwd=tmpdir,
                text=True,
                check=False,
            )
            self.assertEqual(res.returncode, 0, res.stderr)

            with open(h_path, "r", encoding="utf-8") as f:
                h_content = f.read()
            with open(c_path, "r", encoding="utf-8") as f:
                c_content = f.read()

            self.assertIn("odk_plugin_descriptor_t", h_content)
            self.assertIn("odk.s3.driver.st7789", c_content)
            self.assertIn("odk.driver.display/v1", c_content)
            self.assertIn("odk.port.spi/v1", c_content)
            (root / "esp_err.h").write_text("typedef int esp_err_t;\n", encoding="utf-8")
            (root / "main.c").write_text(
                '#include "out.h"\n#include <stdio.h>\n#include <string.h>\n'
                'int main(void) { return fwrite(g_odk_plugins[0].name, 1, '
                f'{len(manifest["name"].encode("utf-8"))}, stdout) == '
                f'{len(manifest["name"].encode("utf-8"))} ? 0 : 1; }}\n',
                encoding="utf-8",
            )
            built = subprocess.run(
                [compiler, "-std=c11", "-Wall", "-Wextra", "-Werror", str(c_path), str(root / "main.c"), "-I", tmpdir, "-o", str(root / "descriptor")],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            output = subprocess.run([str(root / "descriptor")], capture_output=True, check=True)
            self.assertEqual(output.stdout, manifest["name"].encode("utf-8"))


if __name__ == "__main__":
    unittest.main()
