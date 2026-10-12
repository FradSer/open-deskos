/* Actual driver and task lifecycle functions with isolated SDK resource mocks. */
#define main task_fixture_main
#include "task_fixture.c"
#undef main
#define CONFIG_IDF_TARGET_ESP32P4 1
#define SOC_USB_OTG_PERIPH_NUM 2
#define TINYUSB_PORT_HIGH_SPEED_0 1
#define USB_PHY_CTRL_OTG 1
#define USB_PHY_TARGET_INT 1
#define USB_PHY_TARGET_UTMI 2
#define USB_OTG_MODE_DEVICE 1
#define USB_PHY_SPEED_FULL 1
#define USB_PHY_SPEED_HIGH 2
#define USB_PHY_SELF_POWERED_DEVICE(pin) { .gpio = (pin) }
#define ESP_LOGI(...) ((void)0)
#define ESP_GOTO_ON_ERROR(value,label,...) do { ret=(value); if(ret!=ESP_OK) goto label; } while(0)
typedef void *usb_phy_handle_t;
typedef void (*tinyusb_event_cb_t)(void *,void *);
typedef struct { int gpio; } usb_phy_otg_io_conf_t;
typedef struct {
    int controller,target,otg_mode,otg_speed;
    const usb_phy_otg_io_conf_t *otg_io_conf;
} usb_phy_config_t;
typedef struct { int gpio_num,port; } tinyusb_vbus_monitor_config_t;
typedef struct {
    struct { bool skip_setup,self_powered; int vbus_monitor_io; } phy;
    tinyusb_task_config_t task;
    tinyusb_desc_config_t descriptor;
    tinyusb_port_t port;
    tinyusb_event_cb_t event_cb;
    void *event_arg;
} tinyusb_config_t;
/* GENERATED_DRIVER_CONTEXT */
static tinyusb_ctx_t s_ctx;
static bool s_odk_driver_owned;
static bool phy_live,fail_phy_start,fail_phy_stop,fail_monitor;
static unsigned phy_starts,phy_stops,monitor_stops;
static esp_err_t tinyusb_check_config(const tinyusb_config_t *config) { return ESP_OK; }
static esp_err_t tinyusb_task_check_config(const tinyusb_task_config_t *config) { return ESP_OK; }
static esp_err_t usb_new_phy(const usb_phy_config_t *config,usb_phy_handle_t *handle) {
    ++phy_starts;
    assert(!phy_live && config->otg_speed==USB_PHY_SPEED_HIGH);
    if(fail_phy_start) return ESP_FAIL;
    phy_live=true; *handle=(void *)2; return ESP_OK;
}
static esp_err_t usb_del_phy(usb_phy_handle_t handle) {
    assert(phy_live && handle==(void *)2 && p_tusb_task_ctx==NULL);
    ++phy_stops;
    if(fail_phy_stop) return ESP_FAIL;
    phy_live=false; return ESP_OK;
}
static esp_err_t tinyusb_vbus_monitor_init(const tinyusb_vbus_monitor_config_t *config) { return fail_monitor ? ESP_FAIL : ESP_OK; }
static void tinyusb_vbus_monitor_deinit(void) { ++monitor_stops; }
esp_err_t tinyusb_driver_uninstall(void);
/* GENERATED_DRIVER_FUNCTIONS */
int main(void) {
    tinyusb_config_t config={.task={.size=4096,.priority=5},.descriptor=7,.port=1};
    assert(tinyusb_driver_uninstall()==ESP_OK);
    for(int cycle=0;cycle<3;++cycle) {
        assert(tinyusb_driver_install(&config)==ESP_OK && phy_live && s_odk_driver_owned);
        unsigned starts=phy_starts,stops=phy_stops,freed=contexts_freed;
        assert(tinyusb_driver_install(&config)==ESP_ERR_INVALID_STATE && phy_starts==starts);
        fail_stack_stop=true;
        assert(tinyusb_driver_uninstall()==ESP_ERR_NOT_FINISHED);
        assert(phy_stops==stops && contexts_freed==freed && p_tusb_task_ctx);
        fail_stack_stop=false; fail_phy_stop=true;
        assert(tinyusb_driver_uninstall()==ESP_FAIL);
        assert(!p_tusb_task_ctx && phy_live && s_odk_driver_owned);
        assert(contexts_freed==freed+1);
        fail_phy_stop=false;
        assert(tinyusb_driver_uninstall()==ESP_OK && !phy_live && !s_odk_driver_owned);
        assert(contexts_freed==freed+1 && tinyusb_driver_uninstall()==ESP_OK);
    }
    run_start=false; unsigned stops=phy_stops;
    assert(tinyusb_driver_install(&config)==ESP_ERR_TIMEOUT);
    assert(phy_live && s_odk_driver_owned && p_tusb_task_ctx && phy_stops==stops);
    assert(tinyusb_driver_install(&config)==ESP_ERR_INVALID_STATE);
    config.descriptor=99;
    worker(worker_argument);
    assert(tinyusb_driver_uninstall()==ESP_OK && !phy_live);
    config.descriptor=7; run_start=true;
    fail_create=true;
    assert(tinyusb_driver_install(&config)==ESP_ERR_NOT_FINISHED);
    assert(!phy_live && !p_tusb_task_ctx && !s_odk_driver_owned); fail_create=false;
    fail_descriptors=true;
    assert(tinyusb_driver_install(&config)==ESP_FAIL && !phy_live && !s_odk_driver_owned);
    fail_descriptors=false;
    fail_alloc=true;
    assert(tinyusb_driver_install(&config)==ESP_ERR_NO_MEM && !phy_live && !s_odk_driver_owned);
    fail_alloc=false;
    fail_phy_start=true;
    assert(tinyusb_driver_install(&config)==ESP_FAIL && !s_odk_driver_owned);
    assert(tinyusb_driver_uninstall()==ESP_OK); fail_phy_start=false;
    config.phy.skip_setup=true;
    assert(tinyusb_driver_install(&config)==ESP_OK && !phy_live);
    assert(tinyusb_driver_uninstall()==ESP_OK); config.phy.skip_setup=false;
    fail_monitor=true; config.phy.self_powered=true;
    assert(tinyusb_driver_install(&config)==ESP_FAIL && !phy_live && !s_odk_driver_owned);
    assert(monitor_stops>0);
    return 0;
}
