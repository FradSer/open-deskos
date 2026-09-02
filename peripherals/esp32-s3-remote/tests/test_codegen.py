import os
import subprocess
import tempfile

manifest_st7789 = """{
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

with tempfile.TemporaryDirectory() as tmpdir:
    m_path = os.path.join(tmpdir, "manifest.json")
    h_path = os.path.join(tmpdir, "out.h")
    c_path = os.path.join(tmpdir, "out.c")

    with open(m_path, "w") as f:
        f.write(manifest_st7789)

    res = subprocess.run(
        ["python3", "tools/codegen_plugin_descriptor.py", h_path, c_path, m_path],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr

    with open(h_path) as f:
        h_content = f.read()
    with open(c_path) as f:
        c_content = f.read()

    assert "odk_plugin_descriptor_t" in h_content
    assert "odk.s3.driver.st7789" in c_content
    assert "odk.driver.display/v1" in c_content
    assert "odk.port.spi/v1" in c_content
    print("Codegen unit test passed successfully!")
