/*
 * odk_tick_gate.h — coalesce periodic work before it enters a queue.
 *
 * A periodic producer only needs to represent whether one invocation is
 * pending. The atomic exchange operations make the gate safe when the
 * producer and worker run on different FreeRTOS tasks; the queue itself still
 * owns the work item and its lifetime.
 */
#ifndef ODK_TICK_GATE_H
#define ODK_TICK_GATE_H

#include <stdbool.h>
#include <stdatomic.h>

typedef struct {
    atomic_bool pending;
} odk_tick_gate_t;

void odk_tick_gate_init(odk_tick_gate_t *gate);

/* Returns true only when the caller transitions the gate to pending. */
bool odk_tick_gate_mark(odk_tick_gate_t *gate);

/* Returns true when a pending invocation was consumed. */
bool odk_tick_gate_consume(odk_tick_gate_t *gate);

/* Clears a mark when the work item could not be submitted. */
void odk_tick_gate_clear(odk_tick_gate_t *gate);

#endif /* ODK_TICK_GATE_H */
