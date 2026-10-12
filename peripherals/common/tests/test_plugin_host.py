"""Compile and execute the heap-free native host without an ESP SDK."""
from pathlib import Path
import shutil
import subprocess
import pytest


@pytest.mark.parametrize("fixture", ["plugin_host_test.c", "plugin_diagnosis_test.c"])
def test_native_plugin_host(tmp_path, fixture):
    root = Path(__file__).resolve().parents[1]
    compiler = shutil.which("cc")
    assert compiler is not None, "Host C compiler required"
    (tmp_path / "esp_err.h").write_text("""
#pragma once
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NO_MEM 0x101
""", encoding="utf-8")
    built = subprocess.run([compiler, "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", str(tmp_path), "-I", str(root), "-I", str(root.parent / "esp32-s3-remote/main"), str(root / "odk_plugin_host.c"), str(root / "tests" / fixture), "-o", str(tmp_path / "host")], capture_output=True, text=True, check=False)
    assert built.returncode == 0, built.stderr
    result = subprocess.run([str(tmp_path / "host")], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
