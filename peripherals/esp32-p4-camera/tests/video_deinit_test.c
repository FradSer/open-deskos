/* Generated SDK teardown is exercised with retained-resource failures. */
#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_LOGE(...) ((void)0)
#define ESP_ERR_NOT_FOUND 1
#define ESP_RETURN_ON_ERROR(value, ...) do { int result=(value); if(result!=ESP_OK) return result; } while(0)
#define ESP_RETURN_ON_FALSE(value,error,...) do { if(!(value)) return error; } while(0)
#define CONFIG_ESP_VIDEO_ENABLE_MIPI_CSI_VIDEO_DEVICE 1
#define CONFIG_ESP_VIDEO_ENABLE_HW_JPEG_VIDEO_DEVICE 1
#define CONFIG_ESP_VIDEO_ENABLE_ISP_VIDEO_DEVICE 1
#define ESP_VIDEO_ENABLE_SCCB_DEVICE 1
#define SCCB_NUM_MAX 1
#define ESP_VIDEO_INIT_DEV_NUMS 1
#define ESP_CAM_SENSOR_MIPI_CSI 1
typedef struct { int id; } esp_cam_sensor_device_t;
typedef struct { int port; } esp_cam_sensor_detect_fn_t;
static esp_cam_sensor_detect_fn_t detectors[2]={{1},{0}};
#define __esp_cam_sensor_detect_fn_array_start detectors[0]
#define __esp_cam_sensor_detect_fn_array_end detectors[1]
typedef struct { void *handle; void *sccb_io[1]; } sensor_sccb_mask_t;
static sensor_sccb_mask_t s_sensor_sccb_mask[1];
static esp_cam_sensor_device_t sensor={7};
static bool jpeg_live,csi_live,isp_live,sensor_live;
static int fail_csi,fail_sensor,fail_sccb,fail_i2c,fail_isp;
static unsigned jpeg_calls,csi_calls,sensor_calls,sccb_calls,i2c_calls,isp_calls;
static esp_err_t esp_video_destroy_jpeg_video_device(void) { ++jpeg_calls; if(!jpeg_live) return ESP_ERR_NOT_FOUND; jpeg_live=false; return ESP_OK; }
static esp_cam_sensor_device_t *esp_video_get_csi_video_device_sensor(void) { return csi_live ? &sensor : NULL; }
static bool sensor_is_detected(esp_cam_sensor_detect_fn_t *detect,esp_cam_sensor_device_t *value) { assert(value==&sensor); return true; }
static esp_err_t esp_video_destroy_csi_video_device(void) { ++csi_calls; if(fail_csi) return ESP_FAIL; assert(csi_live); csi_live=false; return ESP_OK; }
static esp_err_t esp_cam_sensor_del_dev(esp_cam_sensor_device_t *value) { ++sensor_calls; assert(sensor_live && value==&sensor); if(fail_sensor) return ESP_FAIL; sensor_live=false; return ESP_OK; }
static esp_err_t esp_sccb_del_i2c_io(void *value) { ++sccb_calls; assert(value==(void *)1 && !sensor_live); return fail_sccb ? ESP_FAIL : ESP_OK; }
static esp_err_t i2c_del_master_bus(void *value) { ++i2c_calls; assert(value==(void *)2); return fail_i2c ? ESP_FAIL : ESP_OK; }
static esp_err_t esp_video_destroy_isp_video_device(void) { ++isp_calls; if(!isp_live) return ESP_ERR_NOT_FOUND; if(fail_isp) return ESP_FAIL; isp_live=false; return ESP_OK; }
/* GENERATED_STATE */
typedef struct { bool dont_init_ldo; } esp_video_csi_device_config_t;
typedef struct { bool dont_init_ldo; } fixture_csi_config_t;
static fixture_csi_config_t csi_config;
static int fail_create;
static esp_err_t esp_video_create_csi_video_device(esp_cam_sensor_device_t *value,const esp_video_csi_device_config_t *config) {
    assert(value==&sensor); if(fail_create) return ESP_FAIL; csi_live=true; return ESP_OK;
}
static esp_err_t create_sensor(void) {
    struct fixture_configuration { fixture_csi_config_t *csi; } configuration={.csi=&csi_config};
    const struct fixture_configuration *config=&configuration;
    esp_cam_sensor_device_t *cam_dev=&sensor;
    esp_err_t ret;
    /* GENERATED_CREATE */
    return ESP_OK;
}
/* GENERATED_DEINIT */
static void initialize(bool jpeg) {
    assert(s_odk_pending_csi_sensor==NULL);
    jpeg_live=jpeg; csi_live=isp_live=sensor_live=true;
    s_sensor_sccb_mask[0].sccb_io[0]=(void *)1; s_sensor_sccb_mask[0].handle=(void *)2;
    fail_csi=fail_sensor=fail_sccb=fail_i2c=fail_isp=0;
}
static void released(void) {
    assert(!jpeg_live && !csi_live && !isp_live && !sensor_live);
    assert(s_sensor_sccb_mask[0].sccb_io[0]==NULL && s_sensor_sccb_mask[0].handle==NULL);
    assert(esp_video_deinit()==ESP_OK);
}
int main(void) {
    initialize(false); assert(esp_video_deinit()==ESP_OK); released();
    initialize(false); csi_live=false; fail_create=1;
    assert(create_sensor()==ESP_FAIL && s_odk_pending_csi_sensor==&sensor);
    /* Detection succeeded but CSI registration failed before it owned the sensor. */
    fail_sensor=1; assert(esp_video_deinit()==ESP_FAIL && s_odk_pending_csi_sensor==&sensor);
    fail_sensor=0; assert(esp_video_deinit()==ESP_OK); released();
    initialize(true); csi_live=false; fail_create=0;
    assert(create_sensor()==ESP_OK && s_odk_pending_csi_sensor==NULL);
    fail_csi=1; assert(esp_video_deinit()==ESP_FAIL);
    assert(!jpeg_live && csi_live && sensor_live);
    fail_csi=0; assert(esp_video_deinit()==ESP_OK); released();
    initialize(true); fail_sensor=1; assert(esp_video_deinit()==ESP_FAIL);
    assert(!csi_live && sensor_live && s_odk_pending_csi_sensor==&sensor);
    unsigned csi_done=csi_calls;
    fail_sensor=0; assert(esp_video_deinit()==ESP_OK); assert(csi_calls==csi_done); released();
    initialize(true); fail_sccb=1; assert(esp_video_deinit()==ESP_FAIL);
    assert(!sensor_live && s_sensor_sccb_mask[0].sccb_io[0]==(void *)1);
    unsigned sensor_done=sensor_calls;
    fail_sccb=0; assert(esp_video_deinit()==ESP_OK); assert(sensor_calls==sensor_done); released();
    initialize(true); fail_i2c=1; assert(esp_video_deinit()==ESP_FAIL);
    assert(s_sensor_sccb_mask[0].sccb_io[0]==NULL && s_sensor_sccb_mask[0].handle==(void *)2);
    unsigned sccb_done=sccb_calls;
    fail_i2c=0; assert(esp_video_deinit()==ESP_OK); assert(sccb_calls==sccb_done); released();
    initialize(true); fail_isp=1; assert(esp_video_deinit()==ESP_FAIL);
    fail_isp=0; assert(esp_video_deinit()==ESP_OK); released();
    return 0;
}
