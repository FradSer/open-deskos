"""The local build extension leaves reviewed upstream initialization intact."""
import hashlib
import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools/extend_uac_lifecycle.py'
SOURCE = ROOT / 'peripherals/esp32-p4-camera/managed_components/espressif__usb_device_uac/usb_device_uac.c'


def module():
    spec = importlib.util.spec_from_file_location('extend_uac_lifecycle', SCRIPT)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_extension_binds_only_the_reviewed_source(tmp_path):
    extension = module()
    if not SOURCE.is_file(): pytest.skip('Install the P4 managed dependencies first')
    source = SOURCE.read_text()
    assert hashlib.sha256(source.encode()).hexdigest() == extension.REVIEWED_SHA256
    output = tmp_path / 'uac.c'
    extension.generate(SOURCE, output)
    text = output.read_text()
    assert 'uac_device_deinit_after_usb_stop' in text
    assert 'vTaskDelete(s_uac_device->' not in text
    assert 'atomic_load(&s_odk_uac_stopping)' in text
    assert 'xEventGroupWaitBits' in text
    assert 'ESP_ERR_TIMEOUT' in text
    assert 'if (!config->skip_tinyusb_init)' in text
    assert SOURCE.read_text() == source


def test_unreviewed_source_is_refused_before_output(tmp_path):
    extension = module()
    source = tmp_path / 'upstream.c'
    source.write_text('unreviewed source')
    output = tmp_path / 'uac.c'
    with pytest.raises(ValueError, match='reviewed'): extension.generate(source, output)
    assert not output.exists()


def test_generated_tasks_exit_before_shared_state_is_freed(tmp_path):
    import shutil
    import subprocess
    extension = module()
    generated = tmp_path / 'generated.c'
    if not SOURCE.is_file(): pytest.skip('Install the P4 managed dependencies first')
    extension.generate(SOURCE, generated)
    source = generated.read_text()
    functions = []
    for name in ('usb_mic_task', 'usb_spk_task'):
        start = source.index('static void ' + name + '(')
        end = extension.function_end(source, start)
        functions.append(source[start:end + 1])
    fixture = Path(__file__).with_name('uac_lifecycle_test.c').read_text()
    fixture = fixture.replace('/* GENERATED_WORKERS */', '\n'.join(functions)).replace('/* GENERATED_API */', extension.API)
    unit = tmp_path / 'fixture.c'
    unit.write_text(fixture)
    compiler = shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    result = subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', str(unit), '-o', str(tmp_path / 'fixture')], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    result = subprocess.run([str(tmp_path / 'fixture')], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
