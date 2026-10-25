#pragma once

#include <cstddef>
#include <cstdint>

#include <Preferences.h>

namespace hydra {

// Small RAII transaction around Arduino Preferences. Semantic stores keep their
// own namespace/key constants and defaults; this adapter only guarantees close.
class PreferencesStore {
 public:
  PreferencesStore(const char* nameSpace, bool readOnly);
  ~PreferencesStore();

  PreferencesStore(const PreferencesStore&) = delete;
  PreferencesStore& operator=(const PreferencesStore&) = delete;

  bool opened() const;
  uint8_t getU8(const char* key, uint8_t fallback);
  uint32_t getU32(const char* key, uint32_t fallback);
  size_t getBlob(const char* key, void* out, size_t cap);
  size_t getString(const char* key, char* out, size_t cap);
  void putU8(const char* key, uint8_t value);
  void putU32(const char* key, uint32_t value);
  void putBlob(const char* key, const void* data, size_t len);
  void putString(const char* key, const char* value);

 private:
  Preferences preferences_;
  bool opened_ = false;
};

}  // namespace hydra
