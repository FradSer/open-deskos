#pragma once
#include "domain/desktop_control.h"
namespace hydra {
// Opens only hydra-control in read-only mode. Missing keys disable control.
ControlCrypto loadDesktopControlCrypto();
template<class Store>
bool readDesktopControlKey(Store& store, uint8_t key[32]) {
  memset(key, 0, 32);
  if (store.getUChar("schema", 0) != 1 || store.getBytesLength("key") != 32 ||
      store.getBytes("key", key, 32) != 32) {
    memset(key, 0, 32); return false;
  }
  uint8_t any = 0;
  for (size_t i = 0; i < 32; ++i) any |= key[i];
  return any != 0;
}
}  // namespace hydra
