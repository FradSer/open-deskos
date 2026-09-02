import os
import subprocess
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
        with tempfile.TemporaryDirectory() as tmpdir:
            m_path = os.path.join(tmpdir, "manifest.json")
            h_path = os.path.join(tmpdir, "out.h")
            c_path = os.path.join(tmpdir, "out.c")

            with open(m_path, "w", encoding="utf-8") as f:
                f.write(MANIFEST_ST7789)

            res = subprocess.run(
                ["python3", "tools/codegen_plugin_descriptor.py", h_path, c_path, m_path],
                capture_output=True,
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


if __name__ == "__main__":
    unittest.main()
