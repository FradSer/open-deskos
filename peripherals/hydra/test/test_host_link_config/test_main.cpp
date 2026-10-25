#include <unity.h>

#include <map>
#include <string>
#include <vector>

#include "main_node/hal/host_link_config.h"
using namespace hydra;
struct Store {
  std::map<std::string, std::vector<uint8_t>> values;
  int writes = 0, failAt = -1;
  bool shortRead = false;
  uint8_t getUChar(const char* key, uint8_t fallback) {
    return values.count(key) && values[key].size() == 1 ? values[key][0] : fallback;
  }
  size_t getBytesLength(const char* key) { return values[key].size(); }
  size_t getBytes(const char* key, void* out, size_t count) {
    if (shortRead) return 0;
    if (values[key].size() != count) return 0;
    memcpy(out, values[key].data(), count);
    return count;
  }
  size_t putBytes(const char* key, const void* data, size_t size) {
    if (++writes == failAt) return 0;
    const auto* bytes = static_cast<const uint8_t*>(data);
    values[key] = std::vector<uint8_t>(bytes, bytes + size);
    return size;
  }
  size_t putUChar(const char* key, uint8_t byte) { return putBytes(key, &byte, 1); }
};
void setUp() {}
void tearDown() {}
void test_namespace_only_commit_and_idempotent_boot() {
  Store store;
  store.values["unrelated-fleet-data"] = {7, 8, 9};
  HostLinkConfig config;
  config.gateway[0] = 2;
  config.channel = 1;
  config.pmk[0] = 1;
  config.lmk[0] = 2;
  TEST_ASSERT_TRUE(provisionHostLinkConfig(store, config));
  TEST_ASSERT_TRUE(readHostLinkConfig(store).valid);
  const int committedWrites = store.writes;
  TEST_ASSERT_GREATER_THAN(0, committedWrites);
  TEST_ASSERT_TRUE(provisionHostLinkConfig(store, config));
  TEST_ASSERT_EQUAL(committedWrites, store.writes);
  TEST_ASSERT_EQUAL(3, store.values["unrelated-fleet-data"].size());
  store.shortRead = true;
  TEST_ASSERT_FALSE(readHostLinkConfig(store).valid);
}
void test_partial_write_never_commits_valid_config() {
  Store complete;
  HostLinkConfig sample;
  sample.gateway[0] = 2;
  TEST_ASSERT_TRUE(provisionHostLinkConfig(complete, sample));
  for (int failed = 1; failed <= complete.writes; failed++) {
    Store store;
    store.failAt = failed;
    HostLinkConfig config;
    config.gateway[0] = 2;
    TEST_ASSERT_FALSE(provisionHostLinkConfig(store, config));
    TEST_ASSERT_FALSE(readHostLinkConfig(store).valid);
  }
  Store store;
  HostLinkConfig invalid;
  invalid.gateway[0] = 255;
  TEST_ASSERT_FALSE(provisionHostLinkConfig(store, invalid));
  TEST_ASSERT_EQUAL(0, store.writes);
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_namespace_only_commit_and_idempotent_boot);
  RUN_TEST(test_partial_write_never_commits_valid_config);
  return UNITY_END();
}
