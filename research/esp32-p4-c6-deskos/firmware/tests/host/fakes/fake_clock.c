#include "fake_clock.h"

void fake_clock_set_today(fake_clock_t *clk, uint32_t yyyymmdd)
{
    clk->today_yyyymmdd = yyyymmdd;
}

static uint32_t fake_clock_today_yyyymmdd(void *ctx)
{
    return ((fake_clock_t *)ctx)->today_yyyymmdd;
}

const odk_clock_port_t fake_clock_port = {
    .today_yyyymmdd = fake_clock_today_yyyymmdd,
};
