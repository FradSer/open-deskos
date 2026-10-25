#include <unity.h>
#include "main_node/hal/desktop_control_crypto.h"
using namespace hydra;
void setUp() {}
void tearDown() {}
struct Store {
  uint8_t schema = 1, value = 7;
  size_t length = 32, read = 32;
  uint8_t getUChar(const char*, uint8_t) { return schema; }
  size_t getBytesLength(const char*) { return length; }
  size_t getBytes(const char*, void* out, size_t size) { memset(out, value, read < size ? read : size); return read; }
};
void test_readonly_key_schema_exact_read_and_nonzero() {
  Store store; uint8_t key[32]{};
  TEST_ASSERT_TRUE(readDesktopControlKey(store, key)); TEST_ASSERT_EQUAL(7, key[31]);
  store.schema = 0; TEST_ASSERT_FALSE(readDesktopControlKey(store, key));
  for (auto byte : key) TEST_ASSERT_EQUAL(0, byte);
  store.schema = 1; store.length = 16; TEST_ASSERT_FALSE(readDesktopControlKey(store, key));
  store.length = 32; store.read = 16; TEST_ASSERT_FALSE(readDesktopControlKey(store, key));
  for (auto byte : key) TEST_ASSERT_EQUAL(0, byte);
  store.read = 32; store.value = 0; TEST_ASSERT_FALSE(readDesktopControlKey(store, key));
}
int main(int, char**) {
  UNITY_BEGIN(); RUN_TEST(test_readonly_key_schema_exact_read_and_nonzero); return UNITY_END();
}
