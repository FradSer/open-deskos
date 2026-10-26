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
    assert 'remote_radio_init(s_serial_buffers->state_queue)' in source


def test_surface_drains_dma_before_buffer_teardown():
    source = (ROOT / 'main/remote_control.c').read_text()
    assert 'esp_lcd_panel_io_tx_param(s_panel_io, -1, NULL, 0)' in source
    assert '.stop=surface_plugin_stop' in source
    section = source.split('static esp_err_t buffers_plugin_destroy(void)')[1].split('static esp_err_t gesture_plugin_init')[0]
    assert section.index('s_buffers_display->drain()') < section.index('heap_caps_free(')


def test_radio_state_processing_uses_its_own_bound_buffers():
    source = (ROOT / 'main/remote_radio.c').read_text()
    assert 'xQueueOverwrite(s_state,&state)' in source
    assert 's_state=state_queue' in source
    entry = (ROOT / 'main/remote_control.c').read_text()
    section = entry.split('static esp_err_t serial_plugin_init(')[1].split('static esp_err_t serial_plugin_destroy')[0]
    assert 's_state_queue' not in section
    assert 's_serial_buffers != NULL' in section
    assert 'remote_radio_init(s_serial_buffers->state_queue)' in section


def test_remote_firmware_has_no_usb_control_path():
    source = (ROOT / 'main/remote_control.c').read_text()
    assert 'usb_serial_jtag_read_bytes' not in source
    assert 'usb_serial_jtag_write_bytes' not in source
    assert 'remote_radio_input(' in source


def test_actual_send_consumes_offline_gestures_and_escapes_action_ids(tmp_path: Path):
    source = (ROOT / 'main/remote_control.c').read_text()
    send = source[source.index('static bool send_touchpad_input('):source.index('static void receive_state_records(')]
    poll = source[source.index('static void receive_state_records('):source.index('static void display_port_render(')]
    cjson = ROOT.parents[1] / 'research/esp32-p4-c6-deskos/firmware/tests/host/vendor/cjson'
    unit = tmp_path / 'offline.c'
    unit.write_text('''
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include "touchpad_gesture.h"
#include "cJSON.h"
static bool online;
static int received;
static char last[97];
static touchpad_gesture_t *s_serial_gesture;
static void remote_radio_poll(void) {}
static bool __attribute__((unused)) remote_radio_ready(void) { return online; }
static void remote_radio_input(const char *json, size_t size) {
    assert(size<=96);
    if (online) { memcpy(last,json,size+1); ++received; }
}
''' + send + poll + '''
int main(void) {
    touchpad_gesture_t gesture;
    touchpad_gesture_init(&gesture);
    touchpad_gesture_touch(&gesture,20,SYSTEM_ROW_TOP+2,10,send_touchpad_input,NULL);
    assert(!received && gesture.waiting_for_release);
    online=true;
    touchpad_gesture_touch(&gesture,20,SYSTEM_ROW_TOP+2,20,send_touchpad_input,NULL);
    assert(!received);
    for (int i=0;i<TOUCH_RELEASE_SAMPLES+1;i++) touchpad_gesture_release(&gesture,30+i,send_touchpad_input,NULL);
    touchpad_gesture_touch(&gesture,20,SYSTEM_ROW_TOP+2,100,send_touchpad_input,NULL);
    assert(received==1);
    assert(send_touchpad_input(NULL,REMOTE_INPUT_ACTION,"a\\\"b"));
    cJSON *json=cJSON_Parse(last);
    assert(json && !strcmp(cJSON_GetObjectItemCaseSensitive(json,"action")->valuestring,"a\\\"b"));
    cJSON_Delete(json);
    touchpad_gesture_init(&gesture);
    s_serial_gesture=&gesture;
    online=false;
    receive_state_records();
    touchpad_gesture_touch(&gesture,TOUCHPAD_CENTER_X,TOUCHPAD_CENTER_Y,200,send_touchpad_input,NULL);
    online=true;
    receive_state_records();
    touchpad_gesture_release(&gesture,250,send_touchpad_input,NULL);
    assert(received==2); // A contact that began offline cannot become a new online tap.
    return 0;
}
''')
    binary = tmp_path / 'offline'
    subprocess.run([shutil.which('cc'), '-std=c11', '-Wall', '-Wextra', '-Werror',
                    '-I', str(cjson), '-I', str(ROOT / 'main'), str(unit),
                    str(ROOT / 'main/touchpad_gesture.c'), str(cjson / 'cJSON.c'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)


def test_actual_radio_lifecycle_requires_pairing_and_state_then_expires(tmp_path: Path):
    cjson = ROOT.parents[1] / 'research/esp32-p4-c6-deskos/firmware/tests/host/vendor/cjson'
    (tmp_path / 'freertos').mkdir()
    fixture = (ROOT / 'tests/host/remote_radio_sdk_fixture.h').resolve()
    (tmp_path / 'fixture.h').write_text(f'#include "{fixture.as_posix()}"\n')
    for name in ('esp_err.h', 'esp_event.h', 'esp_netif.h', 'esp_now.h', 'esp_random.h',
                 'esp_timer.h', 'esp_wifi.h', 'nvs.h', 'nvs_flash.h', 'freertos/FreeRTOS.h', 'freertos/queue.h'):
        (tmp_path / name).write_text('#include "fixture.h"\n')
    binary = tmp_path / 'radio'
    vendor = tmp_path / 'cjson.o'
    # Keep third-party SDK deprecations outside project warning policy.
    subprocess.run([shutil.which('cc'), '-std=c11', '-fsanitize=address,undefined',
                    '-Wno-deprecated-declarations', '-I', str(cjson), '-c', str(cjson / 'cJSON.c'), '-o', str(vendor)], check=True)
    subprocess.run([shutil.which('cc'), '-std=c11', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-I', str(tmp_path), '-I', str(ROOT / 'main'), '-I', str(cjson),
                    str(ROOT / 'tests/host/remote_radio_lifecycle_test.c'), str(ROOT / 'main/remote_radio.c'),
                    str(ROOT / 'main/remote_radio_frame.c'), str(ROOT / 'main/remote_state_frame.c'),
                    str(vendor), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
