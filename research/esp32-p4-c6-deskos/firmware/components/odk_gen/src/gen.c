/*
 * gen.c — one-prompt generation pipeline (NT-11, Open DeskOS-OS §6.2
 * compensating constraints 1/2/3).
 *
 * gen_create_app runs, strictly in order: a quota precheck against the
 * injected odk_svc_llm_t (constraint 3 — svc_llm is never called once the
 * daily quota is spent) -> one svc_llm_complete call whose system prompt is
 * built from the template's slot schema -> strict slot-JSON validation
 * against that same schema (constraint 2 — an unknown key, wrong type,
 * over-length value, or a capability outside the template's allowed set
 * rejects the whole package) -> literal {{slot}} substitution into the
 * template skeleton (no evaluation) -> a mode="t" compile check of the
 * resulting Lua via odk_sandbox_check_source -> a manifest assembled with a
 * self-computed per-file SHA-256 (no checksum port is injected into this
 * component, unlike odk_installer's mbedtls-backed one). Every one of these
 * steps runs entirely in memory; the staging directory is written to only
 * after all of them have already succeeded, so every rejection path leaves
 * zero residue under staging_root.
 */
#include "odk_gen.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"

#include "odk_path.h"
#include "odk_sandbox.h"

#define GEN_TPL_TEXT_LEN 2048
#define GEN_MAX_SLOTS 8
#define GEN_MAX_ALLOWED_CAPS 8
#define GEN_CAP_NAME_LEN 48
#define GEN_SLOT_NAME_LEN 32

#define GEN_APP_NAME_BUF 40
#define GEN_TICK_BODY_BUF 2200
#define GEN_MAX_CAPS 8

#define GEN_SYS_PROMPT_BUF 1024
#define GEN_LLM_RESPONSE_BUF 4096
#define GEN_MAIN_LUA_BUF 4096
#define GEN_MANIFEST_BUF 4096
#define GEN_PATH_BUF 300
#define GEN_APP_ID_BUF ODK_APP_ID_LEN

/* ---------------------------------------------------------------------------
 * Built-in v2 app template: manifest.json.tpl + main.lua.tpl skeleton text,
 * plus the slot schema parsed out of slots.schema.json (allowed keys, their
 * types/length limits, and the template's allowed capability set).
 * ------------------------------------------------------------------------- */

typedef enum { GEN_SLOT_STRING, GEN_SLOT_ARRAY_STRING } gen_slot_type_t;

typedef struct {
    char name[GEN_SLOT_NAME_LEN];
    gen_slot_type_t type;
    size_t max_len;   /* GEN_SLOT_STRING */
    size_t max_items; /* GEN_SLOT_ARRAY_STRING */
} gen_slot_def_t;

struct odk_template {
    bool loaded;
    char main_lua_tpl[GEN_TPL_TEXT_LEN];
    char manifest_json_tpl[GEN_TPL_TEXT_LEN];
    gen_slot_def_t slots[GEN_MAX_SLOTS];
    size_t n_slots;
    char allowed_capabilities[GEN_MAX_ALLOWED_CAPS][GEN_CAP_NAME_LEN];
    size_t n_allowed_capabilities;
};

static struct odk_template g_builtin_app_template;

static bool copy_bounded(char *dst, size_t dst_size, const char *src)
{
    size_t len = strlen(src);
    if (len >= dst_size) {
        return false;
    }
    memcpy(dst, src, len + 1);
    return true;
}

/* Loads one template asset (main.lua.tpl / manifest.json.tpl /
 * slots.schema.json) into buf as a NUL-terminated string. The device and host
 * builds source the assets differently:
 *
 *   Device (ESP_PLATFORM): the __FILE__ host source path does not exist on the
 *   flash filesystem, so read from the copies baked into the image via
 *   EMBED_FILES (see CMakeLists.txt). Referencing the _binary_* symbols here is
 *   also what keeps the embedded data from being garbage-collected.
 *
 *   Host: read straight off disk, resolved relative to this source file's own
 *   location, so template edits are picked up without any build wiring.
 */
#ifdef ESP_PLATFORM
extern const char _binary_main_lua_tpl_start[];
extern const char _binary_main_lua_tpl_end[];
extern const char _binary_manifest_json_tpl_start[];
extern const char _binary_manifest_json_tpl_end[];
extern const char _binary_slots_schema_json_start[];
extern const char _binary_slots_schema_json_end[];

static bool load_template_asset(const char *filename, char *buf, size_t buflen)
{
    const char *start = NULL, *end = NULL;
    if (strcmp(filename, "main.lua.tpl") == 0) {
        start = _binary_main_lua_tpl_start;
        end = _binary_main_lua_tpl_end;
    } else if (strcmp(filename, "manifest.json.tpl") == 0) {
        start = _binary_manifest_json_tpl_start;
        end = _binary_manifest_json_tpl_end;
    } else if (strcmp(filename, "slots.schema.json") == 0) {
        start = _binary_slots_schema_json_start;
        end = _binary_slots_schema_json_end;
    } else {
        return false;
    }

    size_t n = (size_t)(end - start);
    if (n >= buflen) {
        n = buflen - 1;
    }
    memcpy(buf, start, n);
    buf[n] = '\0';
    return n > 0;
}
#else
static void resolve_asset_path(const char *filename, char *out, size_t outlen)
{
    char source_dir[512];
    strncpy(source_dir, __FILE__, sizeof(source_dir) - 1);
    source_dir[sizeof(source_dir) - 1] = '\0';
    char *last_slash = strrchr(source_dir, '/');
    if (last_slash != NULL) {
        *last_slash = '\0';
    }
    snprintf(out, outlen, "%s/../templates/app_v2/%s", source_dir, filename);
}

static bool load_template_asset(const char *filename, char *buf, size_t buflen)
{
    char path[512];
    resolve_asset_path(filename, path, sizeof(path));
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return false;
    }
    size_t n = fread(buf, 1, buflen - 1, f);
    fclose(f);
    buf[n] = '\0';
    return n > 0;
}
#endif

static bool load_slot_schema(struct odk_template *tpl, const char *json_text)
{
    cJSON *root = cJSON_Parse(json_text);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return false;
    }

    cJSON *slots = cJSON_GetObjectItemCaseSensitive(root, "slots");
    if (!cJSON_IsObject(slots)) {
        cJSON_Delete(root);
        return false;
    }

    tpl->n_slots = 0;
    for (cJSON *item = slots->child; item != NULL && tpl->n_slots < GEN_MAX_SLOTS; item = item->next) {
        gen_slot_def_t *def = &tpl->slots[tpl->n_slots];
        if (!copy_bounded(def->name, sizeof(def->name), item->string)) {
            cJSON_Delete(root);
            return false;
        }

        cJSON *type = cJSON_GetObjectItemCaseSensitive(item, "type");
        if (!cJSON_IsString(type) || type->valuestring == NULL) {
            cJSON_Delete(root);
            return false;
        }

        if (strcmp(type->valuestring, "string") == 0) {
            def->type = GEN_SLOT_STRING;
            cJSON *max_len = cJSON_GetObjectItemCaseSensitive(item, "max_len");
            def->max_len = cJSON_IsNumber(max_len) ? (size_t)max_len->valuedouble : 0;
        } else if (strcmp(type->valuestring, "array") == 0) {
            def->type = GEN_SLOT_ARRAY_STRING;
            cJSON *max_items = cJSON_GetObjectItemCaseSensitive(item, "max_items");
            def->max_items = cJSON_IsNumber(max_items) ? (size_t)max_items->valuedouble : 0;
        } else {
            cJSON_Delete(root);
            return false;
        }

        tpl->n_slots++;
    }

    cJSON *allowed_caps = cJSON_GetObjectItemCaseSensitive(root, "allowed_capabilities");
    tpl->n_allowed_capabilities = 0;
    if (cJSON_IsArray(allowed_caps)) {
        int count = cJSON_GetArraySize(allowed_caps);
        for (int i = 0; i < count && tpl->n_allowed_capabilities < GEN_MAX_ALLOWED_CAPS; i++) {
            cJSON *cap = cJSON_GetArrayItem(allowed_caps, i);
            if (cJSON_IsString(cap) && cap->valuestring != NULL &&
                copy_bounded(tpl->allowed_capabilities[tpl->n_allowed_capabilities],
                             GEN_CAP_NAME_LEN, cap->valuestring)) {
                tpl->n_allowed_capabilities++;
            }
        }
    }

    cJSON_Delete(root);
    return true;
}

const odk_template_t *odk_template_builtin_app(void)
{
    if (g_builtin_app_template.loaded) {
        return &g_builtin_app_template;
    }

    if (!load_template_asset("main.lua.tpl", g_builtin_app_template.main_lua_tpl,
                             sizeof(g_builtin_app_template.main_lua_tpl))) {
        return NULL;
    }

    if (!load_template_asset("manifest.json.tpl", g_builtin_app_template.manifest_json_tpl,
                             sizeof(g_builtin_app_template.manifest_json_tpl))) {
        return NULL;
    }

    char schema_text[GEN_TPL_TEXT_LEN];
    if (!load_template_asset("slots.schema.json", schema_text, sizeof(schema_text)) ||
        !load_slot_schema(&g_builtin_app_template, schema_text)) {
        return NULL;
    }

    g_builtin_app_template.loaded = true;
    return &g_builtin_app_template;
}

/* ---------------------------------------------------------------------------
 * odk_gen_t handle.
 * ------------------------------------------------------------------------- */

#define STAGING_ROOT_BUF_LEN 192

/* Sized to staging_root's own worst case ("<staging_root>/<app_id>")
 * rather than the generic GEN_PATH_BUF, so that app_dir/manifest_path/
 * main_lua_path -- each built by appending a fixed suffix onto staged_dir --
 * can be proven not to truncate under -O2 / -Wformat-truncation. */
#define GEN_STAGED_DIR_BUF      (STAGING_ROOT_BUF_LEN + GEN_APP_ID_BUF)
#define GEN_APP_DIR_BUF         (GEN_STAGED_DIR_BUF + 5)   /* "/app" */
#define GEN_MANIFEST_PATH_BUF   (GEN_STAGED_DIR_BUF + 16)  /* "/manifest.json" */
#define GEN_MAIN_LUA_PATH_BUF   (GEN_STAGED_DIR_BUF + 16)  /* "/app/main.lua" */

struct odk_gen {
    odk_svc_llm_t *llm;
    const odk_storage_port_t *st;
    void *st_ctx;
    char staging_root[STAGING_ROOT_BUF_LEN];
};

odk_gen_t *gen_create(odk_svc_llm_t *llm,
                       const odk_storage_port_t *st, void *st_ctx,
                       const char *staging_root)
{
    if (llm == NULL || st == NULL || staging_root == NULL) {
        return NULL;
    }
    if (strlen(staging_root) >= STAGING_ROOT_BUF_LEN) {
        return NULL;
    }

    odk_gen_t *g = malloc(sizeof(*g));
    if (g == NULL) {
        return NULL;
    }
    g->llm = llm;
    g->st = st;
    g->st_ctx = st_ctx;
    memcpy(g->staging_root, staging_root, strlen(staging_root) + 1);
    return g;
}

/* ---------------------------------------------------------------------------
 * System prompt: slot schema + "output only JSON" instruction.
 * ------------------------------------------------------------------------- */

static char *build_system_prompt(const odk_template_t *tpl)
{
    char *buf = malloc(GEN_SYS_PROMPT_BUF);
    if (buf == NULL) {
        return NULL;
    }

    int n = snprintf(buf, GEN_SYS_PROMPT_BUF,
        "You are generating configuration for a fixed Lua application template (app_v2). "
        "Output ONLY a single JSON object with exactly these keys and nothing else -- "
        "no markdown, no prose:\n");

    for (size_t i = 0; i < tpl->n_slots && n >= 0 && (size_t)n < GEN_SYS_PROMPT_BUF; i++) {
        const gen_slot_def_t *def = &tpl->slots[i];
        if (def->type == GEN_SLOT_STRING) {
            n += snprintf(buf + n, GEN_SYS_PROMPT_BUF - (size_t)n, "- \"%s\": string, max %zu chars\n",
                          def->name, def->max_len);
        } else {
            n += snprintf(buf + n, GEN_SYS_PROMPT_BUF - (size_t)n,
                          "- \"%s\": array of up to %zu strings\n", def->name, def->max_items);
        }
    }

    if (n >= 0 && (size_t)n < GEN_SYS_PROMPT_BUF && tpl->n_allowed_capabilities > 0) {
        n += snprintf(buf + n, GEN_SYS_PROMPT_BUF - (size_t)n, "Allowed capability values:");
        for (size_t i = 0; i < tpl->n_allowed_capabilities && n >= 0 && (size_t)n < GEN_SYS_PROMPT_BUF; i++) {
            n += snprintf(buf + n, GEN_SYS_PROMPT_BUF - (size_t)n, " \"%s\"", tpl->allowed_capabilities[i]);
        }
    }

    return buf;
}

/* ---------------------------------------------------------------------------
 * Strict slot-JSON validation (§6.2 constraint 2): any key the schema does
 * not declare, a wrong type, an over-length value, or a capability outside
 * the template's allowed set rejects the whole package.
 * ------------------------------------------------------------------------- */

static const gen_slot_def_t *find_slot_def(const odk_template_t *tpl, const char *name)
{
    for (size_t i = 0; i < tpl->n_slots; i++) {
        if (strcmp(tpl->slots[i].name, name) == 0) {
            return &tpl->slots[i];
        }
    }
    return NULL;
}

static bool capability_allowed(const odk_template_t *tpl, const char *cap)
{
    for (size_t i = 0; i < tpl->n_allowed_capabilities; i++) {
        if (strcmp(tpl->allowed_capabilities[i], cap) == 0) {
            return true;
        }
    }
    return false;
}

static odk_err_t validate_and_extract_slots(const odk_template_t *tpl, const cJSON *slot_obj,
                                              char *name, size_t name_cap,
                                              char *tick_body, size_t tick_body_cap,
                                              char capabilities[][GEN_CAP_NAME_LEN], size_t caps_cap,
                                              size_t *n_capabilities)
{
    if (!cJSON_IsObject(slot_obj)) {
        return ODK_ERR_TEMPLATE_VIOLATION;
    }

    /* An unknown key is never silently dropped -- it rejects the whole
     * package. */
    for (const cJSON *item = slot_obj->child; item != NULL; item = item->next) {
        if (find_slot_def(tpl, item->string) == NULL) {
            return ODK_ERR_TEMPLATE_VIOLATION;
        }
    }

    *n_capabilities = 0;

    for (size_t i = 0; i < tpl->n_slots; i++) {
        const gen_slot_def_t *def = &tpl->slots[i];
        const cJSON *val = cJSON_GetObjectItemCaseSensitive(slot_obj, def->name);
        if (val == NULL) {
            return ODK_ERR_TEMPLATE_VIOLATION;
        }

        if (def->type == GEN_SLOT_STRING) {
            if (!cJSON_IsString(val) || val->valuestring == NULL ||
                strlen(val->valuestring) > def->max_len) {
                return ODK_ERR_TEMPLATE_VIOLATION;
            }
            if (strcmp(def->name, "name") == 0) {
                if (!copy_bounded(name, name_cap, val->valuestring)) {
                    return ODK_ERR_TEMPLATE_VIOLATION;
                }
            } else if (strcmp(def->name, "tick_body") == 0) {
                if (!copy_bounded(tick_body, tick_body_cap, val->valuestring)) {
                    return ODK_ERR_TEMPLATE_VIOLATION;
                }
            }
        } else {
            if (!cJSON_IsArray(val)) {
                return ODK_ERR_TEMPLATE_VIOLATION;
            }
            int count = cJSON_GetArraySize(val);
            if (count < 0 || (size_t)count > def->max_items) {
                return ODK_ERR_TEMPLATE_VIOLATION;
            }
            if (strcmp(def->name, "capabilities") == 0) {
                for (int k = 0; k < count; k++) {
                    const cJSON *elem = cJSON_GetArrayItem(val, k);
                    if (!cJSON_IsString(elem) || elem->valuestring == NULL ||
                        !capability_allowed(tpl, elem->valuestring)) {
                        return ODK_ERR_TEMPLATE_VIOLATION;
                    }
                    if (*n_capabilities >= caps_cap ||
                        !copy_bounded(capabilities[*n_capabilities], GEN_CAP_NAME_LEN, elem->valuestring)) {
                        return ODK_ERR_TEMPLATE_VIOLATION;
                    }
                    (*n_capabilities)++;
                }
            }
        }
    }

    return ODK_OK;
}

/* ---------------------------------------------------------------------------
 * app_id derivation from the validated display name. The slug is validated as
 * an identifier before it is used as a storage path component.
 * ------------------------------------------------------------------------- */

static bool derive_app_id(const char *name, char *out, size_t outlen)
{
    size_t j = 0;
    for (size_t i = 0; name[i] != '\0' && j + 1 < outlen && j < 32; i++) {
        char c = name[i];
        if (c >= 'A' && c <= 'Z') {
            c = (char)(c - 'A' + 'a');
        }
        bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
        out[j++] = ok ? c : '_';
    }
    out[j] = '\0';
    return j > 0;
}

/* Appends a sequence number if a package by this id is already staged, so
 * two generations in the same staging tree never collide. exists() is a
 * read-only port call, not one of the mutating ops "zero residue" is
 * measured against. */
static void resolve_app_id_conflict(odk_gen_t *g, char *app_id, size_t app_id_cap)
{
    /* Reserve room for "-<suffix>" (up to "-50", 3 chars + NUL): without this
     * snprintf(app_id, cap, "%s-%d", base, suffix) truncates once base is near
     * the cap, the -suffix is dropped, and the "resolved" id can still collide
     * (and -Werror=format-truncation rejects the unprovable write under SIZE
     * optimization). Bounding base leaves the suffix write provably in-range. */
    char base[GEN_APP_ID_BUF];
    if (app_id_cap <= 4) {
        return; /* no room for any suffix; leave the id as-is */
    }
    copy_bounded(base, sizeof(base), app_id);
    /* Leave room for "-<suffix>" (2 digits + '-' + NUL): a full-width base
     * would truncate the suffix and could still collide. Truncate base first
     * so the assembly below is provably in-range and the compiler's
     * format-truncation pass (SIZE opt) can't reject it. */
    size_t base_cap = app_id_cap - 4; /* "-NN" + NUL */
    if (strlen(base) > base_cap) {
        base[base_cap] = '\0';
    }

    for (int suffix = 2; suffix <= 50; suffix++) {
        char probe_path[GEN_PATH_BUF];
        snprintf(probe_path, sizeof(probe_path), "%s/%s", g->staging_root, app_id);
        if (!g->st->exists(g->st_ctx, probe_path)) {
            return;
        }
        /* Build "<base>-<suffix>" in two snprintf calls with explicit bounds:
         * base is <= base_cap, "-<suffix>" is <= 3 chars, so both writes fit
         * app_id_cap. The final NUL is written by the second snprintf. */
        int n = snprintf(app_id, app_id_cap, "%s", base);
        if (n < 0) {
            return;
        }
        size_t written = (size_t)n < app_id_cap - 1 ? (size_t)n : app_id_cap - 1;
        (void)snprintf(app_id + written, app_id_cap - written, "-%d", suffix);
    }
}

/* ---------------------------------------------------------------------------
 * Literal {{slot}} substitution -- no evaluation. Only the first occurrence
 * of each placeholder is replaced, matching the app_v2 templates (each
 * placeholder appears exactly once).
 * ------------------------------------------------------------------------- */

static void substitute_first(const char *src, const char *placeholder, const char *value,
                              char *out, size_t outlen)
{
    const char *match = strstr(src, placeholder);
    if (match == NULL) {
        snprintf(out, outlen, "%s", src);
        return;
    }
    snprintf(out, outlen, "%.*s%s%s", (int)(match - src), src, value, match + strlen(placeholder));
}

static void fill_main_lua(const odk_template_t *tpl, const char *name, const char *tick_body,
                           char *out, size_t outlen)
{
    char step1[GEN_MAIN_LUA_BUF];
    substitute_first(tpl->main_lua_tpl, "{{name}}", name, step1, sizeof(step1));
    substitute_first(step1, "{{tick_body}}", tick_body, out, outlen);
}

static void json_escape(const char *src, char *out, size_t outlen)
{
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0' && j + 2 < outlen; i++) {
        unsigned char c = (unsigned char)src[i];
        switch (c) {
            case '"':  out[j++] = '\\'; out[j++] = '"';  break;
            case '\\': out[j++] = '\\'; out[j++] = '\\'; break;
            case '\n': out[j++] = '\\'; out[j++] = 'n';  break;
            case '\r': out[j++] = '\\'; out[j++] = 'r';  break;
            case '\t': out[j++] = '\\'; out[j++] = 't';  break;
            default:   out[j++] = (char)c;
        }
    }
    out[j] = '\0';
}

static char *build_capabilities_json(char capabilities[][GEN_CAP_NAME_LEN], size_t n_capabilities)
{
    cJSON *arr = cJSON_CreateArray();
    if (arr == NULL) {
        return NULL;
    }
    for (size_t i = 0; i < n_capabilities; i++) {
        cJSON_AddItemToArray(arr, cJSON_CreateString(capabilities[i]));
    }
    char *out = cJSON_PrintUnformatted(arr);
    cJSON_Delete(arr);
    return out;
}

static odk_err_t fill_manifest(const odk_template_t *tpl, const char *app_id,
                                 const char *name, char capabilities[][GEN_CAP_NAME_LEN],
                                 size_t n_capabilities, const char *main_lua_sha256,
                                 char *out, size_t outlen)
{
    char name_escaped[GEN_APP_NAME_BUF * 2];
    json_escape(name, name_escaped, sizeof(name_escaped));

    char *capabilities_json = build_capabilities_json(capabilities, n_capabilities);
    if (capabilities_json == NULL) {
        return ODK_ERR_OOM;
    }

    char *buf1 = malloc(outlen);
    char *buf2 = malloc(outlen);
    if (buf1 == NULL || buf2 == NULL) {
        free(buf1);
        free(buf2);
        free(capabilities_json);
        return ODK_ERR_OOM;
    }

    substitute_first(tpl->manifest_json_tpl, "{{app_id}}", app_id, buf1, outlen);
    substitute_first(buf1, "{{name}}", name_escaped, buf2, outlen);
    substitute_first(buf2, "{{capabilities_json}}", capabilities_json, buf1, outlen);
    substitute_first(buf1, "{{main_lua_sha256}}", main_lua_sha256, out, outlen);

    free(buf1);
    free(buf2);
    free(capabilities_json);
    return ODK_OK;
}

/* ---------------------------------------------------------------------------
 * Reference SHA-256 (FIPS 180-4). No checksum port is injected into this
 * component -- unlike odk_installer's mbedtls-backed one -- so gen supplies
 * its own host/target-portable digest to record in the manifest it writes.
 * ------------------------------------------------------------------------- */

typedef struct {
    uint32_t state[8];
    uint64_t bitlen;
    uint8_t data[64];
    size_t datalen;
} gen_sha256_ctx_t;

static const uint32_t GEN_SHA256_K[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

#define GEN_ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void gen_sha256_transform(gen_sha256_ctx_t *ctx, const uint8_t data[64])
{
    uint32_t a, b, c, d, e, f, g, h, t1, t2, m[64];

    for (int i = 0, j = 0; i < 16; i++, j += 4) {
        m[i] = ((uint32_t)data[j] << 24) | ((uint32_t)data[j + 1] << 16) |
               ((uint32_t)data[j + 2] << 8) | ((uint32_t)data[j + 3]);
    }
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = GEN_ROTR(m[i - 15], 7) ^ GEN_ROTR(m[i - 15], 18) ^ (m[i - 15] >> 3);
        uint32_t s1 = GEN_ROTR(m[i - 2], 17) ^ GEN_ROTR(m[i - 2], 19) ^ (m[i - 2] >> 10);
        m[i] = m[i - 16] + s0 + m[i - 7] + s1;
    }

    a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
    e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];

    for (int i = 0; i < 64; i++) {
        uint32_t S1 = GEN_ROTR(e, 6) ^ GEN_ROTR(e, 11) ^ GEN_ROTR(e, 25);
        uint32_t ch = (e & f) ^ (~e & g);
        t1 = h + S1 + ch + GEN_SHA256_K[i] + m[i];
        uint32_t S0 = GEN_ROTR(a, 2) ^ GEN_ROTR(a, 13) ^ GEN_ROTR(a, 22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = S0 + maj;
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
    ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void gen_sha256_init(gen_sha256_ctx_t *ctx)
{
    ctx->datalen = 0;
    ctx->bitlen = 0;
    ctx->state[0] = 0x6a09e667; ctx->state[1] = 0xbb67ae85;
    ctx->state[2] = 0x3c6ef372; ctx->state[3] = 0xa54ff53a;
    ctx->state[4] = 0x510e527f; ctx->state[5] = 0x9b05688c;
    ctx->state[6] = 0x1f83d9ab; ctx->state[7] = 0x5be0cd19;
}

static void gen_sha256_update(gen_sha256_ctx_t *ctx, const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        ctx->data[ctx->datalen++] = data[i];
        if (ctx->datalen == 64) {
            gen_sha256_transform(ctx, ctx->data);
            ctx->bitlen += 512;
            ctx->datalen = 0;
        }
    }
}

static void gen_sha256_final(gen_sha256_ctx_t *ctx, uint8_t hash[32])
{
    size_t i = ctx->datalen;

    if (ctx->datalen < 56) {
        ctx->data[i++] = 0x80;
        while (i < 56) {
            ctx->data[i++] = 0x00;
        }
    } else {
        ctx->data[i++] = 0x80;
        while (i < 64) {
            ctx->data[i++] = 0x00;
        }
        gen_sha256_transform(ctx, ctx->data);
        memset(ctx->data, 0, 56);
    }

    ctx->bitlen += (uint64_t)ctx->datalen * 8;
    ctx->data[63] = (uint8_t)(ctx->bitlen);
    ctx->data[62] = (uint8_t)(ctx->bitlen >> 8);
    ctx->data[61] = (uint8_t)(ctx->bitlen >> 16);
    ctx->data[60] = (uint8_t)(ctx->bitlen >> 24);
    ctx->data[59] = (uint8_t)(ctx->bitlen >> 32);
    ctx->data[58] = (uint8_t)(ctx->bitlen >> 40);
    ctx->data[57] = (uint8_t)(ctx->bitlen >> 48);
    ctx->data[56] = (uint8_t)(ctx->bitlen >> 56);
    gen_sha256_transform(ctx, ctx->data);

    for (i = 0; i < 4; i++) {
        for (int j = 0; j < 8; j++) {
            hash[j * 4 + i] = (uint8_t)((ctx->state[j] >> (24 - i * 8)) & 0xff);
        }
    }
}

static void gen_sha256_hex(const char *data, size_t len, char out_hex[65])
{
    static const char hexchars[] = "0123456789abcdef";
    gen_sha256_ctx_t ctx;
    uint8_t hash[32];

    gen_sha256_init(&ctx);
    gen_sha256_update(&ctx, (const uint8_t *)data, len);
    gen_sha256_final(&ctx, hash);

    for (int i = 0; i < 32; i++) {
        out_hex[i * 2] = hexchars[(hash[i] >> 4) & 0xf];
        out_hex[i * 2 + 1] = hexchars[hash[i] & 0xf];
    }
    out_hex[64] = '\0';
}

/* ---------------------------------------------------------------------------
 * gen_create_app.
 * ------------------------------------------------------------------------- */

odk_err_t gen_create_app(odk_gen_t *g, const odk_template_t *tpl,
                          const char *prompt,
                          char *out_staged_dir, size_t outlen)
{
    if (g == NULL || tpl == NULL || prompt == NULL || out_staged_dir == NULL || outlen == 0) {
        return ODK_ERR_INVALID_MANIFEST;
    }
    out_staged_dir[0] = '\0';

    /* Constraint 3: quota before the LLM -- svc_llm is never reached once
     * the daily quota is spent. */
    if (svc_llm_quota_remaining(g->llm) == 0) {
        return ODK_ERR_QUOTA_EXCEEDED;
    }

    odk_err_t result = ODK_OK;
    char *system_prompt = NULL;
    char *llm_response = NULL;
    cJSON *slot_json = NULL;
    char *manifest_text = NULL;
    char main_lua[GEN_MAIN_LUA_BUF];

    system_prompt = build_system_prompt(tpl);
    if (system_prompt == NULL) {
        result = ODK_ERR_OOM;
        goto done;
    }

    llm_response = malloc(GEN_LLM_RESPONSE_BUF);
    if (llm_response == NULL) {
        result = ODK_ERR_OOM;
        goto done;
    }

    odk_llm_usage_t usage = { 0 };
    result = svc_llm_complete(g->llm, system_prompt, prompt, llm_response, GEN_LLM_RESPONSE_BUF, &usage);
    if (result != ODK_OK) {
        goto done;
    }

    slot_json = cJSON_Parse(llm_response);
    if (slot_json == NULL) {
        result = ODK_ERR_TEMPLATE_VIOLATION;
        goto done;
    }

    char name[GEN_APP_NAME_BUF];
    char tick_body[GEN_TICK_BODY_BUF];
    char capabilities[GEN_MAX_CAPS][GEN_CAP_NAME_LEN];
    size_t n_capabilities = 0;

    result = validate_and_extract_slots(tpl, slot_json,
                                         name, sizeof(name),
                                         tick_body, sizeof(tick_body),
                                         capabilities, GEN_MAX_CAPS, &n_capabilities);
    if (result != ODK_OK) {
        goto done;
    }

    char app_id[GEN_APP_ID_BUF];
    if (!derive_app_id(name, app_id, sizeof(app_id)) ||
        !odk_app_id_valid(app_id)) {
        result = ODK_ERR_BAD_APP_ID;
        goto done;
    }
    resolve_app_id_conflict(g, app_id, sizeof(app_id));

    fill_main_lua(tpl, name, tick_body, main_lua, sizeof(main_lua));

    char sandbox_errbuf[128];
    result = odk_sandbox_check_source(main_lua, strlen(main_lua), sandbox_errbuf, sizeof(sandbox_errbuf));
    if (result != ODK_OK) {
        goto done;
    }

    char main_lua_sha256[65];
    gen_sha256_hex(main_lua, strlen(main_lua), main_lua_sha256);

    manifest_text = malloc(GEN_MANIFEST_BUF);
    if (manifest_text == NULL) {
        result = ODK_ERR_OOM;
        goto done;
    }
    result = fill_manifest(tpl, app_id, name, capabilities, n_capabilities,
                            main_lua_sha256, manifest_text, GEN_MANIFEST_BUF);
    if (result != ODK_OK) {
        goto done;
    }

    /* Every validation step above ran entirely in memory. Only now -- with a
     * fully-verified package -- does this function touch the storage port. */
    char staged_dir[GEN_STAGED_DIR_BUF];
    char app_dir[GEN_APP_DIR_BUF];
    char manifest_path[GEN_MANIFEST_PATH_BUF];
    char main_lua_path[GEN_MAIN_LUA_PATH_BUF];
    snprintf(staged_dir, sizeof(staged_dir), "%s/%s", g->staging_root, app_id);
    snprintf(app_dir, sizeof(app_dir), "%s/app", staged_dir);
    snprintf(manifest_path, sizeof(manifest_path), "%s/manifest.json", staged_dir);
    snprintf(main_lua_path, sizeof(main_lua_path), "%s/app/main.lua", staged_dir);

    result = g->st->mkdir_p(g->st_ctx, staged_dir);
    if (result != ODK_OK) {
        goto done;
    }
    result = g->st->mkdir_p(g->st_ctx, app_dir);
    if (result != ODK_OK) {
        g->st->remove_tree(g->st_ctx, staged_dir);
        goto done;
    }
    result = g->st->write_file(g->st_ctx, manifest_path, manifest_text, strlen(manifest_text));
    if (result != ODK_OK) {
        g->st->remove_tree(g->st_ctx, staged_dir);
        goto done;
    }
    result = g->st->write_file(g->st_ctx, main_lua_path, main_lua, strlen(main_lua));
    if (result != ODK_OK) {
        g->st->remove_tree(g->st_ctx, staged_dir);
        goto done;
    }

    snprintf(out_staged_dir, outlen, "%s", staged_dir);
    result = ODK_OK;

done:
    free(system_prompt);
    free(llm_response);
    cJSON_Delete(slot_json);
    free(manifest_text);
    return result;
}
