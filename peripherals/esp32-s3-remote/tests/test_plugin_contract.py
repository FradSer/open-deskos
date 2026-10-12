"""Source wiring checks supplement target compilation and the native host fixture."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def test_actual_serial_and_surface_consume_selected_buffers(tmp_path: Path) -> None:
    repository = ROOT.parents[1]
    common = ROOT.parent / 'common'
    compiler = shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    (tmp_path / 'esp_err.h').write_text('''
#pragma once
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NO_MEM 0x101
''')
    manifests = [ROOT / 'main/plugins' / f'{name}.json'
                 for name in ('display', 'touch', 'buffers', 'gesture', 'serial', 'surface')]
    subprocess.run([sys.executable, str(repository / 'tools/codegen_plugin_descriptor.py'),
                    str(tmp_path / 's3_plugins.h'), str(tmp_path / 's3_plugins.c'),
                    *map(str, manifests)], check=True, capture_output=True, text=True)
    source = (ROOT / 'main/remote_control.c').read_text()
    serial = source[source.index('static esp_err_t serial_plugin_init('):source.index('static void remote_surface_run(')]
    surface = source[source.index('static esp_err_t surface_plugin_init('):source.index('const odk_plugin_lifecycle_t s3_display_lifecycle')]
    template = (ROOT / 'tests/host/plugin_consumers_test.c').read_text()
    unit = tmp_path / 'consumers.c'
    unit.write_text(template.replace('/* PRODUCTION_CONSUMERS */', serial + surface))
    binary = tmp_path / 'consumers'
    built = subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror',
                            '-I', str(tmp_path), '-I', str(common), '-I', str(ROOT / 'main'),
                            str(common / 'odk_plugin_host.c'), str(tmp_path / 's3_plugins.c'),
                            str(unit), '-o', str(binary)], capture_output=True, text=True)
    assert built.returncode == 0, built.stderr
    result = subprocess.run([str(binary)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_consumers_bind_public_buffer_resources():
    header = (ROOT / 'main/remote_plugin_ports.h').read_text()
    source = (ROOT / 'main/remote_control.c').read_text()
    assert 'remote_buffers_port_t' in header
    assert 's_surface_buffers = remote_buffers_from_context(context)' in source
    assert 's_framebuffer = s_surface_buffers->framebuffer' in source
    assert 's_state_queue = s_surface_buffers->state_queue' in source
    assert 'xQueueOverwrite(s_serial_buffers->state_queue' in source


def test_surface_drains_dma_before_buffer_teardown():
    source = (ROOT / 'main/remote_control.c').read_text()
    assert 'esp_lcd_panel_io_tx_param(s_panel_io, -1, NULL, 0)' in source
    assert '.stop=surface_plugin_stop' in source
    section = source.split('static esp_err_t buffers_plugin_destroy(void)')[1].split('static esp_err_t gesture_plugin_init')[0]
    assert section.index('s_buffers_display->drain()') < section.index('heap_caps_free(')


def test_serial_state_processing_uses_its_own_bound_buffers():
    source = (ROOT / 'main/remote_control.c').read_text()
    section = source.split('static void process_cdc_line(void)')[1].split('static void cdc_receive_byte')[0]
    assert 's_state_queue' not in section
    assert 's_serial_buffers == NULL' in section
