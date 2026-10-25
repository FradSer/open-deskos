#include "shared/preferences_store.h"

namespace hydra {

PreferencesStore::PreferencesStore(const char* nameSpace, bool readOnly) {
  if (!preferences_.begin(nameSpace, readOnly)) return;
  opened_ = true;
}

PreferencesStore::~PreferencesStore() {
  if (opened_) preferences_.end();
}

bool PreferencesStore::opened() const { return opened_; }

uint8_t PreferencesStore::getU8(const char* key, uint8_t fallback) {
  return opened_ ? preferences_.getUChar(key, fallback) : fallback;
}

uint32_t PreferencesStore::getU32(const char* key, uint32_t fallback) {
  return opened_ ? preferences_.getULong(key, fallback) : fallback;
}

size_t PreferencesStore::getBlob(const char* key, void* out, size_t cap) {
  return opened_ ? preferences_.getBytes(key, out, cap) : 0;
}

size_t PreferencesStore::getString(const char* key, char* out, size_t cap) {
  return opened_ ? preferences_.getString(key, out, cap) : 0;
}

void PreferencesStore::putU8(const char* key, uint8_t value) {
  if (opened_) preferences_.putUChar(key, value);
}

void PreferencesStore::putU32(const char* key, uint32_t value) {
  if (opened_) preferences_.putULong(key, value);
}

void PreferencesStore::putBlob(const char* key, const void* data, size_t len) {
  if (opened_) preferences_.putBytes(key, data, len);
}

void PreferencesStore::putString(const char* key, const char* value) {
  if (opened_) preferences_.putString(key, value);
}

}  // namespace hydra
