"""P4 plugins must own the real boot path and consume replaceable ports."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
MAIN = ROOT / 'peripherals/esp32-p4-camera/main'

def test_real_boot_uses_native_plugin_host():
    source = (MAIN / 'p4_camera_main.c').read_text()
    assert 'odk_plugin_host_start' in source
    assert (MAIN / 'plugins/stream.json').is_file()


def test_actual_composition_consumes_replacements_and_retains_providers(tmp_path):
    import subprocess
    import shutil
    compiler = shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    common = ROOT / 'peripherals/common'
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
    manifests = [str(MAIN / 'plugins' / (name + '.json')) for name in ('storage','i2c','camera','usb','microphone','stream')]
    generated = subprocess.run(['python3',str(ROOT/'tools/codegen_plugin_descriptor.py'),str(tmp_path/'p4_plugins.h'),str(tmp_path/'p4_plugins.c'),*manifests],capture_output=True,text=True)
    assert generated.returncode==0,generated.stderr
    source = (MAIN/'p4_camera_main.c').read_text()
    source = '\n'.join(line for line in source.splitlines() if not line.startswith('#include'))
    ports = (MAIN/'p4_plugin_ports.h').read_text()
    ports = '\n'.join(line for line in ports.splitlines() if not line.startswith(('#include','#pragma')))
    fixture = Path(__file__).with_name('plugin_composition_test.c').read_text()
    fixture = fixture.replace('/* GENERATED_PORTS */',ports).replace('/* GENERATED_COMPOSITION */',source)
    (tmp_path/'fixture.c').write_text(fixture)
    binary = tmp_path/'composition'
    built = subprocess.run([compiler,'-std=c11','-Wall','-Wextra','-Werror','-Wno-unused-parameter','-Wno-unused-variable','-I',str(tmp_path),'-I',str(common),str(common/'odk_plugin_host.c'),str(tmp_path/'p4_plugins.c'),str(tmp_path/'fixture.c'),'-o',str(binary)],capture_output=True,text=True)
    assert built.returncode==0,built.stderr
    result = subprocess.run([str(binary)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr


def test_actual_usb_transport_blocks_failed_init_until_framework_cleanup(tmp_path):
    import subprocess
    import shutil
    source=(MAIN/'p4_usb_transport.c').read_text()
    source='\n'.join(line for line in source.splitlines() if not line.startswith('#include'))
    ports=(MAIN/'p4_plugin_ports.h').read_text()
    ports='\n'.join(line for line in ports.splitlines() if not line.startswith(('#include','#pragma')))
    fixture=Path(__file__).with_name('usb_transport_test.c').read_text()
    fixture=fixture.replace('/* GENERATED_PORTS */',ports).replace('/* GENERATED_TRANSPORT */',source)
    unit=tmp_path/'transport.c'
    unit.write_text(fixture)
    compiler=shutil.which('cc')
    assert compiler is not None, 'Host C compiler required'
    binary=tmp_path/'transport'
    built=subprocess.run([compiler,'-std=c11','-Wall','-Wextra','-Werror','-Wno-unused-parameter',str(unit),'-o',str(binary)],capture_output=True,text=True)
    assert built.returncode==0,built.stderr
    result=subprocess.run([str(binary)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr


def test_actual_microphone_consumes_transport_and_retains_cleanup_state(tmp_path):
    import subprocess
    import shutil
    source=(MAIN/'p4_usb_microphone.c').read_text()
    def function(name):
        marker = ('static esp_err_t ' if name=='microphone_input' else 'const p4_audio_source_t *' if name=='p4_microphone_source' else 'esp_err_t ') + name + '('
        start=source.index(marker)
        if source.index(';',start) < source.index('{',start): start=source.index(marker,start+len(marker))
        opening=source.index('{',start); depth=0
        for end in range(opening,len(source)):
            if source[end]=='{': depth+=1
            elif source[end]=='}':
                depth-=1
                if depth==0: return source[start:end+1]
        raise AssertionError(name)
    globals_start=source.index('static esp_codec_dev_handle_t')
    globals_end=source.index('static esp_err_t microphone_input(uint8_t *buffer')
    names=('microphone_input','p4_usb_microphone_init_with_transport','p4_usb_microphone_stop','p4_usb_microphone_deinit','p4_microphone_source')
    functions='\n'.join(function(name) for name in names)
    ports=(MAIN/'p4_plugin_ports.h').read_text()
    ports='\n'.join(line for line in ports.splitlines() if not line.startswith(('#include','#pragma')))
    fixture=Path(__file__).with_name('microphone_lifecycle_test.c').read_text()
    fixture=fixture.replace('/* GENERATED_PORTS */',ports).replace('/* GENERATED_GLOBALS */',source[globals_start:globals_end]).replace('/* GENERATED_FUNCTIONS */',functions)
    unit=tmp_path/'microphone.c'; unit.write_text(fixture)
    compiler=shutil.which('cc'); assert compiler is not None, 'Host C compiler required'
    binary=tmp_path/'microphone'
    built=subprocess.run([compiler,'-std=c11','-Wall','-Wextra','-Werror','-Wno-unused-parameter',str(unit),'-o',str(binary)],capture_output=True,text=True)
    assert built.returncode==0,built.stderr
    result=subprocess.run([str(binary)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr
