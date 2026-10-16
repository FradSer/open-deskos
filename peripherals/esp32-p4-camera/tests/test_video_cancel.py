"""Video plugin receive cancellation must preserve normal driver behavior."""
import importlib.util
from pathlib import Path
import subprocess
import shutil
import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools/extend_video_lifecycle.py'
SOURCE = ROOT / 'peripherals/esp32-p4-camera/managed_components/espressif__esp_video/src'
MAIN = ROOT / 'peripherals/esp32-p4-camera/main'


def module():
    spec = importlib.util.spec_from_file_location('extend_video_lifecycle', SCRIPT)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def generated(tmp_path):
    if not SOURCE.is_dir(): pytest.skip('Install the P4 managed dependencies first')
    extension = module()
    original = {name: (SOURCE / name).read_bytes() for name in extension.REVIEWED}
    extension.generate(SOURCE, tmp_path)
    assert original == {name: (SOURCE / name).read_bytes() for name in extension.REVIEWED}
    return (tmp_path / 'odk_esp_video.c').read_text()


def test_unreviewed_video_source_fails_before_any_output(tmp_path):
    extension = module()
    source = tmp_path / 'source'
    source.mkdir()
    for name in extension.REVIEWED: (source / name).write_text('unreviewed')
    output = tmp_path / 'output'
    with pytest.raises(ValueError, match='reviewed'): extension.generate(source, output)
    assert not output.exists()


def run_receive_fixture(tmp_path, source):
    start = source.index('struct esp_video_buffer_element *esp_video_recv_element(')
    opening = source.index('{', start)
    depth = 0
    for end in range(opening, len(source)):
        if source[end]=='{': depth+=1
        elif source[end]=='}':
            depth-=1
            if depth==0: break
    helper = (MAIN / 'p4_video_lifecycle.c').read_text()
    helper = '\n'.join(line for line in helper.splitlines() if not line.startswith('#include'))
    fixture = Path(__file__).with_name('video_cancel_test.c').read_text()
    fixture = fixture.replace('/* GENERATED_HELPER */', helper)
    fixture = fixture.replace('/* GENERATED_RECEIVE */', source[start:end+1])
    unit = tmp_path / 'video.c'
    unit.write_text(fixture)
    compiler = shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    binary = tmp_path / 'video'
    result = subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', str(unit), '-o', str(binary)], capture_output=True, text=True)
    assert result.returncode==0, result.stderr
    result = subprocess.run([str(binary)], capture_output=True, text=True)
    return result


def test_actual_receive_preserves_waits_and_cancels_stopped_plugins(tmp_path):
    source = generated(tmp_path)
    result = run_receive_fixture(tmp_path, source)
    assert result.returncode==0, result.stderr
    ioctl = (tmp_path / 'odk_esp_video_ioctl.c').read_text()
    assert 'case VIDIOC_P4_RECEIVER_FLAG:' in ioctl
    assert 'p4_video_bind_receiver(video, *(atomic_bool **)arg_ptr)' in ioctl


def test_original_driver_reproduces_uncancellable_wait(tmp_path):
    if not SOURCE.is_dir(): pytest.skip('Install the P4 managed dependencies first')
    original = (SOURCE / 'esp_video.c').read_text()
    result = run_receive_fixture(tmp_path, original)
    assert result.returncode != 0
    assert 'ticks!=portMAX_DELAY' in result.stderr


def test_second_source_mismatch_preserves_existing_outputs(tmp_path):
    if not SOURCE.is_dir(): pytest.skip('Install the P4 managed dependencies first')
    extension = module()
    source = tmp_path / 'source'
    source.mkdir()
    (source / 'esp_video.c').write_bytes((SOURCE / 'esp_video.c').read_bytes())
    (source / 'esp_video_ioctl.c').write_text('unreviewed ioctl')
    output = tmp_path / 'output'
    output.mkdir()
    for name in ('odk_esp_video.c', 'odk_esp_video_ioctl.c'):
        (output / name).write_text('previous build')
    with pytest.raises(ValueError, match='esp_video_ioctl.c'):
        extension.generate(source, output)
    assert all(path.read_text() == 'previous build' for path in output.iterdir())


def test_generated_video_teardown_retries_partial_resources(tmp_path):
    generated(tmp_path)
    source = (tmp_path/'odk_esp_video_init.c').read_text()
    start = source.index('esp_err_t esp_video_deinit(void)')
    fixture = Path(__file__).with_name('video_deinit_test.c').read_text()
    fixture = fixture.replace('/* GENERATED_STATE */', module().DEINIT_STATE)
    fixture = fixture.replace('/* GENERATED_DEINIT */', source[start:])
    create_start=source.index('            esp_video_csi_device_config_t csi_dev_config = {')
    create_end=source.index('#if CONFIG_ESP_VIDEO_ENABLE_CAMERA_MOTOR_CONTROLLER',create_start)
    fixture=fixture.replace('/* GENERATED_CREATE */',source[create_start:create_end])
    unit=tmp_path/'deinit.c'
    unit.write_text(fixture)
    compiler=shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    binary=tmp_path/'deinit'
    result=subprocess.run([compiler,'-std=c11','-Wall','-Wextra','-Werror','-Wno-unused-parameter',str(unit),'-o',str(binary)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    result=subprocess.run([str(binary)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr
