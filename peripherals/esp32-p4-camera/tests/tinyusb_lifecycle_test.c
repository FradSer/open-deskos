/* Actual generated worker/start/stop functions with deterministic RTOS mocks. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <stdatomic.h>
typedef int esp_err_t;
typedef void *TaskHandle_t;
typedef unsigned EventBits_t;
typedef int tinyusb_port_t;
typedef int tinyusb_desc_config_t;
typedef struct { int role,speed; } tusb_rhport_init_t;
typedef struct { int size,priority,xCoreID; } tinyusb_task_config_t;
typedef struct { EventBits_t bits; } StaticEventGroup_t;
typedef StaticEventGroup_t *EventGroupHandle_t;
#define BIT0 1
#define BIT1 2
#define pdFALSE 0
#define pdTRUE 1
#define pdPASS 1
#define pdMS_TO_TICKS(value) (value)
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_STATE 1
#define ESP_ERR_NOT_FINISHED 2
#define ESP_ERR_NO_MEM 3
#define ESP_ERR_TIMEOUT 4
#define MALLOC_CAP_DEFAULT 0
#define TUSB_ROLE_DEVICE 1
#define TUSB_SPEED_FULL 1
#define TUSB_SPEED_HIGH 2
#define TINYUSB_PORT_FULL_SPEED_0 0
#define ESP_RETURN_ON_ERROR(value,...) do { int result=(value); if(result!=ESP_OK) return result; } while(0)
#define ESP_RETURN_ON_FALSE(value,error,...) do { if(!(value)) return error; } while(0)
#define TINYUSB_TASK_ENTER_CRITICAL() ((void)0)
#define TINYUSB_TASK_EXIT_CRITICAL() ((void)0)
#define TINYUSB_TASK_CHECK_FROM_CRIT(value,error) do { if(!(value)) return error; } while(0)
/* GENERATED_CONTEXT */
/* GENERATED_STATE */
static bool _task_is_running;
static tinyusb_task_ctx_t *p_tusb_task_ctx;
static bool descriptors_live,stack_live,run_start=true,fail_create,fail_alloc,fail_descriptors,fail_stack_init,fail_stack_stop;
static bool setter_tail_pending;
static unsigned group_creates,contexts_freed,descriptors_freed,stack_stops,self_exits,event_calls;
static void (*worker)(void *);
static void *worker_argument;
static EventGroupHandle_t xEventGroupCreateStatic(StaticEventGroup_t *storage) { assert(!setter_tail_pending); ++group_creates; return storage; }
static EventBits_t xEventGroupClearBits(EventGroupHandle_t group,EventBits_t bits) { return group->bits &= ~bits; }
static EventBits_t xEventGroupSetBits(EventGroupHandle_t group,EventBits_t bits) { return group->bits |= bits; }
static EventBits_t xEventGroupWaitBits(EventGroupHandle_t group,EventBits_t bits,int clear,int all,int wait) {
    if(bits==ODK_USB_READY && run_start) worker(worker_argument);
    return group->bits;
}
static void *heap_caps_calloc(size_t count,size_t size,int flags) { return fail_alloc ? NULL : calloc(count,size); }
static void heap_caps_free(void *context) { ++contexts_freed; free(context); }
static int xTaskCreatePinnedToCore(void (*function)(void *),const char *name,int size,void *context,int priority,TaskHandle_t *handle,int core) {
    if(fail_create) return 0;
    worker=function; worker_argument=context; *handle=(void *)1; return pdPASS;
}
static bool tud_inited(void) { return stack_live; }
static esp_err_t tinyusb_descriptors_check(int port,const tinyusb_desc_config_t *config) { return ESP_OK; }
static esp_err_t tinyusb_descriptors_set(int port,const tinyusb_desc_config_t *config) { assert(*config==7); if(fail_descriptors) return ESP_FAIL; descriptors_live=true; return ESP_OK; }
static void tinyusb_descriptors_free(void) { assert(descriptors_live && !stack_live); descriptors_live=false; ++descriptors_freed; }
static bool tusb_rhport_init(int port,const tusb_rhport_init_t *config) { assert(descriptors_live); if(fail_stack_init) return false; stack_live=true; return true; }
static bool tusb_deinit(int port) { assert(stack_live && descriptors_live); ++stack_stops; if(fail_stack_stop) return false; stack_live=false; return true; }
static void tud_task_ext(unsigned timeout,bool isr) { assert(timeout==100 && !isr && stack_live); ++event_calls; atomic_store(&s_odk_usb_stopping,true); }
static void vTaskDelete(TaskHandle_t task) { assert(task==NULL); ++self_exits; setter_tail_pending=true; }
/* GENERATED_FUNCTIONS */
int main(void) {
    tinyusb_task_config_t config={.size=4096,.priority=5,.xCoreID=0}; tinyusb_desc_config_t descriptors=7;
    for(int cycle=0;cycle<3;++cycle) {
        assert(tinyusb_task_start(1,&config,&descriptors)==ESP_OK);
        assert(p_tusb_task_ctx && p_tusb_task_ctx->rhport_init.speed==TUSB_SPEED_HIGH);
        assert(tinyusb_task_start(1,&config,&descriptors)==ESP_ERR_INVALID_STATE);
        fail_stack_stop=true; unsigned freed=contexts_freed,desc_freed=descriptors_freed;
        assert(tinyusb_task_stop()==ESP_ERR_NOT_FINISHED);
        assert(p_tusb_task_ctx && p_tusb_task_ctx->handle==NULL && _task_is_running);
        assert(contexts_freed==freed && descriptors_freed==desc_freed);
        fail_stack_stop=false; assert(tinyusb_task_stop()==ESP_OK);
        assert(p_tusb_task_ctx==NULL && !_task_is_running);
        assert(tinyusb_task_stop()==ESP_OK);
    }
    assert(group_creates==1 && self_exits==3 && event_calls==3);
    run_start=false;
    assert(tinyusb_task_start(1,&config,&descriptors)==ESP_ERR_TIMEOUT);
    tinyusb_task_ctx_t *retained=p_tusb_task_ctx; unsigned freed=contexts_freed;
    assert(tinyusb_task_stop()==ESP_ERR_TIMEOUT && p_tusb_task_ctx==retained && contexts_freed==freed);
    descriptors=99; /* The expired caller storage is not the retained descriptor config. */
    worker(worker_argument); assert(tinyusb_task_stop()==ESP_OK); descriptors=7;
    assert(event_calls==3); /* Late initialization observes cancellation before processing events. */
    run_start=true; fail_create=true;
    assert(tinyusb_task_start(1,&config,&descriptors)==ESP_ERR_NOT_FINISHED);
    assert(tinyusb_task_stop()==ESP_OK); fail_create=false;
    fail_alloc=true; assert(tinyusb_task_start(1,&config,&descriptors)==ESP_ERR_NO_MEM && !_task_is_running);
    assert(tinyusb_task_stop()==ESP_OK); fail_alloc=false;
    fail_descriptors=true;
    assert(tinyusb_task_start(1,&config,&descriptors)==ESP_FAIL);
    assert(tinyusb_task_stop()==ESP_OK); fail_descriptors=false;
    assert(tinyusb_task_start(0,&config,&descriptors)==ESP_OK);
    assert(p_tusb_task_ctx->rhport_init.speed==TUSB_SPEED_FULL);
    assert(tinyusb_task_stop()==ESP_OK);
    fail_stack_init=true;
    assert(tinyusb_task_start(1,&config,&descriptors)==ESP_ERR_NOT_FINISHED);
    retained=p_tusb_task_ctx; freed=contexts_freed;
    assert(tinyusb_task_stop()==ESP_ERR_NOT_FINISHED && p_tusb_task_ctx==retained && contexts_freed==freed);
    assert(descriptors_live && !stack_live);
    assert(tinyusb_task_start(1,&config,&descriptors)==ESP_ERR_INVALID_STATE);
    /* Opaque partial initialization remains owned; do not claim successful teardown. */
    free(retained); p_tusb_task_ctx=NULL;
    return 0;
}
