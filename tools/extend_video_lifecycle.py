#!/usr/bin/env python3
"""Extend reviewed video sources in the build directory for plugin cancellation."""
from hashlib import sha256
from pathlib import Path
import sys

REVIEWED = {
    'esp_video.c': '2743555489b49d1629833d2611422b8a71690f643ecc8f7bed2f385a2cf0f678',
    'esp_video_ioctl.c': 'd908ab709841dd72f2a72a96dc0f6b7be77ac5a969b87b1406d56c7659e5c3d7',
    'esp_video_init.c': '1c560bc83aab3f5becc979a0b527e8c2a4865da396ea4c7fbea729ad4b737bae',
}


DEINIT_STATE = """
#if CONFIG_ESP_VIDEO_ENABLE_MIPI_CSI_VIDEO_DEVICE
static esp_cam_sensor_device_t *s_odk_pending_csi_sensor;
#endif
"""

def generate(source_dir: Path, output_dir: Path) -> None:
    sources: dict[str, str] = {}
    for name, expected in REVIEWED.items():
        original = (source_dir / name).read_bytes()
        if sha256(original).hexdigest() != expected:
            raise ValueError('Video source does not match the reviewed lifecycle revision: ' + name)
        sources[name] = original.decode('utf-8')
    video = sources['esp_video.c'].replace('#include <stdio.h>', '#include <stdio.h>\n#include "p4_video_lifecycle.h"', 1)
    video = video.replace('    uint32_t val = type;\n\n    stream = esp_video_get_stream(video, type);', '    uint32_t val = type;\n    atomic_bool *running = p4_video_receiver_flag(video);\n    if (running != NULL && !atomic_load(running)) return NULL;\n\n    stream = esp_video_get_stream(video, type);', 1)
    video = video.replace('    ret = xSemaphoreTake(stream->ready_sem, (TickType_t)ticks);', '    ret = p4_video_receive_wait(stream->ready_sem, (TickType_t)ticks, running);', 1)
    ioctl = sources['esp_video_ioctl.c'].replace('#include <stdio.h>', '#include <stdio.h>\n#include "p4_video_lifecycle.h"', 1)
    ioctl = ioctl.replace('    switch (cmd) {', '    switch (cmd) {\n    case VIDIOC_P4_RECEIVER_FLAG:\n        ret = p4_video_bind_receiver(video, *(atomic_bool **)arg_ptr);\n        break;', 1)
    init = sources['esp_video_init.c']
    init = init.replace('esp_err_t esp_video_init(const esp_video_init_config_t *config)', DEINIT_STATE + '\nesp_err_t esp_video_init(const esp_video_init_config_t *config)', 1)
    init = init.replace('            ret = esp_video_create_csi_video_device(cam_dev, &csi_dev_config);', '            s_odk_pending_csi_sensor = cam_dev;\n            ret = esp_video_create_csi_video_device(cam_dev, &csi_dev_config);', 1)
    init = init.replace('                ESP_LOGE(TAG, "failed to create MIPI-CSI video device");\n                return ret;\n            }', '                ESP_LOGE(TAG, "failed to create MIPI-CSI video device");\n                return ret;\n            }\n            s_odk_pending_csi_sensor = NULL;', 1)
    for name in ('csi',):
        init = init.replace(f'    bool {name}_deinited = false;', f'''    bool {name}_deinited = false;
    if (s_odk_pending_{name}_sensor != NULL) {{
        ESP_RETURN_ON_ERROR(esp_cam_sensor_del_dev(s_odk_pending_{name}_sensor), TAG, "Retry sensor cleanup");
        s_odk_pending_{name}_sensor = NULL;
        {name}_deinited = true;
    }}''', 1)
        token = f'            ESP_RETURN_ON_ERROR(esp_video_destroy_{name}_video_device(), TAG, "Failed to destroy {name.upper()} video device");'
        init = init.replace(token, token + f'\n            s_odk_pending_{name}_sensor = cam_dev;', 1)
        token = f'            ESP_RETURN_ON_ERROR(esp_cam_sensor_del_dev(cam_dev), TAG, "Failed to delete {name.upper()} sensor");'
        init = init.replace(token, token + f'\n            s_odk_pending_{name}_sensor = NULL;', 1)
    for name, message in (('jpeg', 'JPEG'), ('isp', 'ISP')):
        token = f'    ESP_RETURN_ON_ERROR(esp_video_destroy_{name}_video_device(), TAG, "Failed to destroy {message} video device");'
        init = init.replace(token, f'''    const esp_err_t {name}_status = esp_video_destroy_{name}_video_device();
    ESP_RETURN_ON_FALSE({name}_status == ESP_OK || {name}_status == ESP_ERR_NOT_FOUND,
                        {name}_status, TAG, "Failed to destroy {message} video device");''', 1)
    init = init.replace('                esp_sccb_del_i2c_io(m->sccb_io[j]);', '                ESP_RETURN_ON_ERROR(esp_sccb_del_i2c_io(m->sccb_io[j]), TAG, "Release sensor SCCB");\n                m->sccb_io[j] = NULL;', 1)
    init = init.replace('            i2c_del_master_bus(m->handle);', '            ESP_RETURN_ON_ERROR(i2c_del_master_bus(m->handle), TAG, "Release sensor I2C");\n            m->handle = NULL;', 1)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'odk_esp_video.c').write_text(video, encoding='utf-8')
    (output_dir / 'odk_esp_video_ioctl.c').write_text(ioctl, encoding='utf-8')
    (output_dir / 'odk_esp_video_init.c').write_text(init, encoding='utf-8')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: extend_video_lifecycle.py <upstream-source-dir> <output-dir>')
    generate(Path(sys.argv[1]), Path(sys.argv[2]))
