/*
 * fake_clock.h — settable yyyymmdd clock for odk_clock_port_t.
 *
 * Backs "cross-day reset" scenarios: a test dials the date forward with
 * fake_clock_set_today() instead of reading the wall clock.
 */
#ifndef FAKE_CLOCK_H
#define FAKE_CLOCK_H

#include <stdint.h>

#include "odk_svc_llm.h"

typedef struct {
    uint32_t today_yyyymmdd;
} fake_clock_t;

void fake_clock_set_today(fake_clock_t *clk, uint32_t yyyymmdd);

extern const odk_clock_port_t fake_clock_port;

#endif /* FAKE_CLOCK_H */
