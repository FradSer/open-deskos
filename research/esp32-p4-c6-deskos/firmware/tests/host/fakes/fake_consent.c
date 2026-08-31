#include "fake_consent.h"

#include <string.h>

void fake_consent_reset(fake_consent_t *fake)
{
    memset(fake, 0, sizeof(*fake));
    fake->grant = true;
}

void fake_consent_set_response(fake_consent_t *fake, bool grant)
{
    fake->grant = grant;
}

static bool fake_confirm(void *ctx, const odk_manifest_t *m)
{
    fake_consent_t *fake = (fake_consent_t *)ctx;
    fake->call_count++;
    if (m != NULL) {
        fake->last_shown = *m;
    }
    return fake->grant;
}

const odk_consent_port_t fake_consent_port = {
    .confirm = fake_confirm,
};
