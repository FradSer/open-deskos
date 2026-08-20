/*
 * clock_rtc.c — odk_clock_port_t backed by the RTC. When the RTC is
 * uncorrected (no SNTP sync yet, so time() returns a pre-2022 epoch) it
 * degrades to a monotonic boot-day counter: svc_llm only uses today's value
 * for day-change equality, so a counter that advances once per day still
 * rolls the daily quota over. Excluded from the host build (src/port_idf/).
 */
#include "odk_svc_llm_ports_idf.h"

#include <time.h>

#include "esp_log.h"
#include "esp_timer.h"

#define CLOCK_MIN_VALID_YEAR 2022
#define CLOCK_DEGRADED_BASE 20260101u
#define CLOCK_US_PER_DAY (86400LL * 1000000LL)

static const char *TAG = "odk_clock";

static uint32_t clock_today_yyyymmdd(void *ctx)
{
    (void)ctx;
    time_t now = time(NULL);
    struct tm tm_now;
    localtime_r(&now, &tm_now);
    int year = tm_now.tm_year + 1900;
    if (year >= CLOCK_MIN_VALID_YEAR) {
        return (uint32_t)(year * 10000 + (tm_now.tm_mon + 1) * 100 + tm_now.tm_mday);
    }

    static bool warned = false;
    if (!warned) {
        ESP_LOGW(TAG, "RTC uncorrected (SNTP not synced); using boot-day count for the quota day");
        warned = true;
    }
    uint64_t boot_days = (uint64_t)(esp_timer_get_time() / CLOCK_US_PER_DAY);
    return CLOCK_DEGRADED_BASE + (uint32_t)boot_days;
}

const odk_clock_port_t odk_clock_port_idf = {
    .today_yyyymmdd = clock_today_yyyymmdd,
};
