"""UVC resources must outlive their capture worker during plugin shutdown."""
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'main/p4_uvc_stream.c'

def test_uvc_exposes_retained_resource_cleanup():
    source = SOURCE.read_text()
    assert 'esp_err_t p4_uvc_stream_deinit(void)' in source
    assert 'vTaskDelete(s_ctx.task_handle)' not in source
    assert 'ESP_ERR_TIMEOUT' in source


def test_actual_lifecycle_retains_resources_and_reuses_exit_group(tmp_path):
    import shutil
    import subprocess
    source = SOURCE.read_text()
    def function(name):
        start = source.index(name + '(')
        start = source.rfind('\n', 0, start) + 1
        opening = source.index('{', start)
        depth = 0
        for end in range(opening, len(source)):
            if source[end] == '{': depth += 1
            elif source[end] == '}':
                depth -= 1
                if depth == 0: return source[start:end+1]
        raise AssertionError(name)
    names = ('deliver_frame', 'queue_stream_buffers', 'set_streams', 'release_buffers', 'owns_resources', 'release_resources',
             'stream_task', 'p4_uvc_stream_init_with_ports', 'p4_uvc_stream_init', 'p4_uvc_stream_start',
             'p4_uvc_stream_stop', 'p4_uvc_stream_deinit', 'p4_uvc_stream_running')
    start = source.index('typedef struct {')
    end = source.index('} p4_uvc_ctx_t;', start) + len('} p4_uvc_ctx_t;')
    fixture = Path(__file__).with_name('uvc_lifecycle_test.c').read_text()
    ports = SOURCE.with_name('p4_plugin_ports.h').read_text()
    ports = '\n'.join(line for line in ports.splitlines() if not line.startswith(('#include', '#pragma')))
    fixture = fixture.replace('/* GENERATED_PORTS */', ports)
    fixture = fixture.replace('/* GENERATED_CONTEXT */', source[start:end])
    fixture = fixture.replace('/* GENERATED_FUNCTIONS */', '\n'.join(function(name) for name in names))
    unit = tmp_path / 'uvc.c'
    unit.write_text(fixture)
    compiler = shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    binary = tmp_path / 'uvc'
    result = subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', str(unit), '-o', str(binary)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    result = subprocess.run([str(binary)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
