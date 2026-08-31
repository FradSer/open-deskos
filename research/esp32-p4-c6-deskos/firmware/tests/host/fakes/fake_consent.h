/*
 * fake_consent.h — programmable test double for odk_consent_port_t (FR-14
 * install-time capability authorization).
 *
 * Records every confirm() call — count and a copy of the manifest it was
 * shown — so a test can assert both what the user was asked to authorize
 * and that a rejection produces zero residue; fake_consent_set_response
 * programs the next decision.
 */
#ifndef FAKE_CONSENT_H
#define FAKE_CONSENT_H

#include <stdbool.h>

#include "odk_installer.h"

typedef struct {
    bool grant;
    int call_count;
    odk_manifest_t last_shown;
} fake_consent_t;

void fake_consent_reset(fake_consent_t *fake);
void fake_consent_set_response(fake_consent_t *fake, bool grant);

extern const odk_consent_port_t fake_consent_port;

#endif /* FAKE_CONSENT_H */
