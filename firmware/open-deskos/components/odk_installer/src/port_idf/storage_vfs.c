/*
 * storage_vfs.c — odk_storage_port_t backed by the ESP-IDF VFS/FAT layer.
 * On-target counterpart of tests/host/fakes/fake_storage.c. Excluded from the
 * host build (lives under src/port_idf/, outside each odk_* component's src
 * directory glob).
 */
#include "odk_installer_ports_idf.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "esp_vfs_fat.h"

#define STORAGE_IO_BUF 512
#define STORAGE_PATH_BUF 300

void odk_storage_idf_ctx_init(odk_storage_idf_ctx_t *ctx, const char *mount_base)
{
    memset(ctx, 0, sizeof(*ctx));
    snprintf(ctx->base, sizeof(ctx->base), "%s", mount_base);
}

static odk_err_t vfs_mkdir_p(void *ctx, const char *path)
{
    (void)ctx;
    char tmp[STORAGE_PATH_BUF];
    if (snprintf(tmp, sizeof(tmp), "%s", path) >= (int)sizeof(tmp)) {
        return ODK_ERR_STORAGE;
    }
    for (char *p = tmp + 1; *p != '\0'; p++) {
        if (*p == '/') {
            *p = '\0';
            if (mkdir(tmp, 0777) != 0 && errno != EEXIST) {
                return ODK_ERR_STORAGE;
            }
            *p = '/';
        }
    }
    if (mkdir(tmp, 0777) != 0 && errno != EEXIST) {
        return ODK_ERR_STORAGE;
    }
    return ODK_OK;
}

static odk_err_t vfs_write_file(void *ctx, const char *path, const void *buf, size_t len)
{
    (void)ctx;
    FILE *f = fopen(path, "wb");
    if (f == NULL) {
        return ODK_ERR_STORAGE;
    }
    size_t written = (len > 0) ? fwrite(buf, 1, len, f) : 0;
    fclose(f);
    return (written == len) ? ODK_OK : ODK_ERR_STORAGE;
}

static odk_err_t vfs_read_file(void *ctx, const char *path, void *buf, size_t buflen, size_t *outlen)
{
    (void)ctx;
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    size_t n = fread(buf, 1, buflen, f);
    fclose(f);
    if (outlen != NULL) {
        *outlen = n;
    }
    return ODK_OK;
}

static odk_err_t vfs_rename(void *ctx, const char *from, const char *to)
{
    (void)ctx;
    return (rename(from, to) == 0) ? ODK_OK : ODK_ERR_STORAGE;
}

static odk_err_t vfs_remove_tree(void *ctx, const char *path)
{
    (void)ctx;
    struct stat st;
    if (stat(path, &st) != 0) {
        return ODK_OK; /* already gone */
    }
    if (!S_ISDIR(st.st_mode)) {
        return (unlink(path) == 0) ? ODK_OK : ODK_ERR_STORAGE;
    }

    DIR *dir = opendir(path);
    if (dir == NULL) {
        return ODK_ERR_STORAGE;
    }
    struct dirent *entry;
    odk_err_t result = ODK_OK;
    while ((entry = readdir(dir)) != NULL) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }
        char child[STORAGE_PATH_BUF];
        if (snprintf(child, sizeof(child), "%s/%s", path, entry->d_name) >= (int)sizeof(child)) {
            result = ODK_ERR_STORAGE;
            continue;
        }
        odk_err_t sub = vfs_remove_tree(NULL, child);
        if (sub != ODK_OK) {
            result = sub;
        }
    }
    closedir(dir);
    if (rmdir(path) != 0) {
        result = ODK_ERR_STORAGE;
    }
    return result;
}

static odk_err_t vfs_free_bytes(void *ctx, uint64_t *out)
{
    odk_storage_idf_ctx_t *c = ctx;
    uint64_t total = 0;
    uint64_t free_bytes = 0;
    if (esp_vfs_fat_info(c->base, &total, &free_bytes) != ESP_OK) {
        return ODK_ERR_STORAGE;
    }
    if (out != NULL) {
        *out = free_bytes;
    }
    return ODK_OK;
}

static odk_err_t vfs_size_bytes(void *ctx, const char *path, uint64_t *out)
{
    (void)ctx;
    struct stat st;
    if (stat(path, &st) != 0) {
        return ODK_ERR_NOT_FOUND;
    }
    if (out != NULL) {
        *out = (uint64_t)st.st_size;
    }
    return ODK_OK;
}

static bool vfs_exists(void *ctx, const char *path)
{
    (void)ctx;
    struct stat st;
    return stat(path, &st) == 0;
}

const odk_storage_port_t odk_storage_port_idf = {
    .mkdir_p = vfs_mkdir_p,
    .write_file = vfs_write_file,
    .read_file = vfs_read_file,
    .rename = vfs_rename,
    .remove_tree = vfs_remove_tree,
    .free_bytes = vfs_free_bytes,
    .size_bytes = vfs_size_bytes,
    .exists = vfs_exists,
};
