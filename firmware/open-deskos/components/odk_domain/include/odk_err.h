/*
 * odk_err.h — domain-layer result enum, shared across all platforms.
 *
 * The domain layer never returns esp_err_t: it is pure, ESP-IDF-free, and
 * host-testable. Every domain and application-service API returns odk_err_t.
 * This header carries zero external includes so it compiles unchanged on the
 * host test harness and on the target firmware.
 */
#ifndef ODK_ERR_H
#define ODK_ERR_H

typedef enum {
    ODK_OK = 0,
    ODK_ERR_INVALID_MANIFEST, ODK_ERR_BAD_APP_ID, ODK_ERR_PATH_UNSAFE,
    ODK_ERR_BAD_SEMVER, ODK_ERR_CHECKSUM_MISMATCH, ODK_ERR_CAP_UNSUPPORTED,
    ODK_ERR_DEP_UNSATISFIED, ODK_ERR_DENIED, ODK_ERR_NO_SPACE,
    ODK_ERR_STORAGE, ODK_ERR_HTTP, ODK_ERR_QUOTA_EXCEEDED,
    ODK_ERR_SANDBOX_VIOLATION, ODK_ERR_OOM, ODK_ERR_BUDGET_EXCEEDED,
    ODK_ERR_TEMPLATE_VIOLATION, ODK_ERR_STATE_QUOTA,
    ODK_ERR_STATE, ODK_ERR_NOT_FOUND, ODK_ERR_EXISTS, ODK_ERR_NOT_IMPLEMENTED,
    ODK_ERR_INVALID_ARG,
} odk_err_t;

#endif /* ODK_ERR_H */
