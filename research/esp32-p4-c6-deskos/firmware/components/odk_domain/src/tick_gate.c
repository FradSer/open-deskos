#include "odk_tick_gate.h"

#include <stddef.h>

void odk_tick_gate_init(odk_tick_gate_t *gate)
{
    if (gate != NULL) {
        atomic_init(&gate->pending, false);
    }
}

bool odk_tick_gate_mark(odk_tick_gate_t *gate)
{
    if (gate == NULL) {
        return false;
    }
    return !atomic_exchange_explicit(&gate->pending, true, memory_order_acq_rel);
}

bool odk_tick_gate_consume(odk_tick_gate_t *gate)
{
    if (gate == NULL) {
        return false;
    }
    return atomic_exchange_explicit(&gate->pending, false, memory_order_acq_rel);
}

void odk_tick_gate_clear(odk_tick_gate_t *gate)
{
    if (gate != NULL) {
        atomic_store_explicit(&gate->pending, false, memory_order_release);
    }
}
