#include <unity.h>
#include <CommonCrypto/CommonHMAC.h>
#include "domain/desktop_control.h"
using namespace hydra;
void setUp() {}
void tearDown() {}
struct CryptoFixture {
  uint8_t key[32]{};
  uint8_t entropy = 1;
  bool fail = false;
  static bool hmac(void* context, const uint8_t* bytes, size_t size, uint8_t out[32]) {
    auto& fixture = *static_cast<CryptoFixture*>(context);
    if (fixture.fail) return false;
    CCHmac(kCCHmacAlgSHA256, fixture.key, 32, bytes, size, out); return true;
  }
  static bool random(void* context, uint8_t* out, size_t size) {
    auto& fixture = *static_cast<CryptoFixture*>(context);
    if (fixture.fail) return false;
    memset(out, fixture.entropy++, size); return true;
  }
};
struct Fixture {
  CryptoFixture crypto;
  DesktopControl control;
  uint8_t main[6] = {2, 1, 2, 3, 4, 5}, gateway[6] = {2, 6, 7, 8, 9, 10};
  uint8_t request[128]{}, reply[128]{};
  ControlAction action;
  Fixture() { TEST_ASSERT_TRUE(control.begin(main, gateway, 0x1234, {&crypto, crypto.hmac, crypto.random})); }
  void sign() { TEST_ASSERT_TRUE(crypto.hmac(&crypto, request, 96, request + 96)); }
  void query(uint64_t id, uint32_t now) {
    memset(request, 0, sizeof(request)); memcpy(request, "HDC1", 4); request[4] = 1;
    memcpy(request + 5, main, 6); memcpy(request + 11, gateway, 6);
    controlWrite(request + 41, id, 8); sign();
    TEST_ASSERT_TRUE(control.receive(request, 128, now, reply, action));
    TEST_ASSERT_FALSE(action.valid);
  }
  void command(ControlType type, uint8_t node, uint32_t duration = 0) {
    memcpy(request, reply, 128); memset(request + 54, 0, 42);
    request[4] = uint8_t(type); request[54] = node;
    request[53] = type == ControlType::Water ? 5 : 1;
    if (type == ControlType::Water) controlWrite(request + 55, duration, 4);
    sign();
  }
  bool receive(uint32_t now) { return control.receive(request, 128, now, reply, action); }
};
void test_fixed_wire_and_fail_closed_without_crypto() {
  DesktopControl control; uint8_t input[128]{}, output[128]{}; ControlAction action;
  TEST_ASSERT_EQUAL(128, kControlBytes);
  TEST_ASSERT_FALSE(control.receive(input, sizeof(input), 1, output, action));
}
void test_status_query_signed_high_water_and_no_authority() {
  Fixture f; f.query(0, 100);
  TEST_ASSERT_EQUAL_UINT64(0x1234, controlRead(f.reply + 17, 8));
  TEST_ASSERT_EQUAL_UINT64(0, controlRead(f.reply + 54, 8));
  TEST_ASSERT_EQUAL(0, controlRead(f.reply + 49, 4));
  f.command(ControlType::Water, 1, 2000); TEST_ASSERT_FALSE(f.receive(101));
}
void test_bad_tag_mac_padding_size_and_type_are_rejected() {
  Fixture f; f.query(1, 100); f.command(ControlType::Water, 1, 3000);
  f.request[100] ^= 1; TEST_ASSERT_FALSE(f.receive(101)); f.sign();
  f.request[5] ^= 2; f.sign(); TEST_ASSERT_FALSE(f.receive(101)); f.request[5] ^= 2;
  f.request[95] = 1; f.sign(); TEST_ASSERT_FALSE(f.receive(101)); f.request[95] = 0;
  f.request[4] = 99; f.sign(); TEST_ASSERT_FALSE(f.receive(101));
  TEST_ASSERT_FALSE(f.control.receive(f.request, 127, 101, f.reply, f.action));
  TEST_ASSERT_FALSE(f.control.forced(1, 101));
}
void test_query_retry_does_not_renew_and_high_water_never_reissues() {
  Fixture f; f.query(9, 100); uint8_t saved[128]; memcpy(saved, f.reply, 128);
  f.query(9, 4999); TEST_ASSERT_EQUAL_MEMORY(saved, f.reply, 128);
  TEST_ASSERT_FALSE(f.receive(5100));
  f.query(0, 5101); TEST_ASSERT_EQUAL_UINT64(9, controlRead(f.reply + 54, 8));
  f.query(10, 5102); f.command(ControlType::Stop, 1); TEST_ASSERT_TRUE(f.receive(5103));
  TEST_ASSERT_TRUE(f.action.valid);
  // Consumed pending ID cannot be reissued even after the cache changes.
  memset(f.request + 17, 0, 24); f.request[4] = 1; f.request[53] = 0;
  memset(f.request + 49, 0, 47); f.sign(); TEST_ASSERT_FALSE(f.receive(5104));
}
void test_one_action_duplicate_does_not_renew_or_repeat() {
  Fixture f; f.query(1, 100); f.command(ControlType::Water, 1, 30000);
  uint8_t command[128]; memcpy(command, f.request, 128);
  TEST_ASSERT_TRUE(f.receive(200)); TEST_ASSERT_TRUE(f.action.valid);
  TEST_ASSERT_EQUAL(30200, f.control.leaseEnd(1));
  TEST_ASSERT_EQUAL(5200, controlRead(f.reply + 49, 4));
  memcpy(f.request, command, 128); TEST_ASSERT_TRUE(f.receive(1100));
  TEST_ASSERT_FALSE(f.action.valid); TEST_ASSERT_EQUAL(30200, f.control.leaseEnd(1));
  TEST_ASSERT_FALSE(f.control.forced(1, 1200));
  f.request[55] ^= 1; f.sign(); TEST_ASSERT_FALSE(f.receive(1101));
}
void test_expiry_boot_invalid_duration_and_failed_crypto() {
  Fixture f; f.query(1, 100); f.command(ControlType::Water, 1, 30001);
  TEST_ASSERT_FALSE(f.receive(101)); f.command(ControlType::Water, 1, 0);
  TEST_ASSERT_FALSE(f.receive(101));
  f.query(2, 200); f.command(ControlType::Water, 1, 1);
  f.request[17] ^= 1; f.sign(); TEST_ASSERT_FALSE(f.receive(201)); f.request[17] ^= 1; f.sign();
  TEST_ASSERT_FALSE(f.receive(5200));
  f.query(3, 6000); f.command(ControlType::Water, 1, 1000); f.crypto.fail = true;
  TEST_ASSERT_FALSE(f.receive(6001)); TEST_ASSERT_FALSE(f.control.forced(1, 6001));
}
void test_heartbeat_counter_disconnect_total_limit_and_no_resurrection() {
  Fixture f; f.query(1, 100); f.command(ControlType::Water, 1, 3000);
  TEST_ASSERT_TRUE(f.receive(200));
  f.request[4] = 7; f.request[53] = 5;
  controlWrite(f.request + 49, 1400, 4); controlWrite(f.request + 55, 1, 4); f.sign();
  TEST_ASSERT_FALSE(f.receive(1000)); TEST_ASSERT_TRUE(f.control.forced(1, 1500));
  TEST_ASSERT_FALSE(f.receive(1600)); TEST_ASSERT_FALSE(f.control.forced(1, 2000));
  controlWrite(f.request + 55, 2, 4); controlWrite(f.request + 49, 2600, 4); f.sign();
  TEST_ASSERT_FALSE(f.receive(2100)); TEST_ASSERT_FALSE(f.control.forced(1, 2100));
  // Another lease is independently bounded even with fresh heartbeat traffic.
  f.query(2, 2200); f.command(ControlType::Water, 2, 1000); TEST_ASSERT_TRUE(f.receive(2201));
  f.request[4] = 7; controlWrite(f.request + 55, 1, 4);
  controlWrite(f.request + 49, 3400, 4); f.sign(); TEST_ASSERT_FALSE(f.receive(2700));
  TEST_ASSERT_FALSE(f.control.forced(2, 3201));
}
void test_millis_wrap_and_stop_only_desktop() {
  Fixture f; f.query(1, 0xfffffff0U); f.command(ControlType::Water, 1, 500);
  TEST_ASSERT_TRUE(f.receive(0xfffffff5U)); TEST_ASSERT_TRUE(f.control.forced(1, 100));
  TEST_ASSERT_FALSE(f.control.forced(1, 500));
  f.query(2, 100); f.command(ControlType::Stop, 1); TEST_ASSERT_TRUE(f.receive(101));
  TEST_ASSERT_EQUAL(ControlType::Stop, f.action.type);
  TEST_ASSERT_FALSE(f.control.forced(1, 102));
}
void makePlan(Fixture& f, uint32_t sequence, uint8_t count = 1) {
  f.command(ControlType::Plan, 1); f.request[53] = 7 + count * 4;
  controlWrite(f.request + 55, sequence, 4); f.request[59] = uint8_t(Season::Summer);
  f.request[60] = count;
  for (uint8_t i = 0; i < count; ++i) {
    controlWrite(f.request + 61 + i * 4, i * 10, 2);
    f.request[63 + i * 4] = uint8_t(Plan::Standard); f.request[64 + i * 4] = 0;
  }
  f.sign();
}
void test_plan_atomic_validation_leaf_ack_and_idempotence() {
  Fixture f; f.query(1, 0); makePlan(f, 3, 2);
  f.request[67] = 255; f.sign(); TEST_ASSERT_FALSE(f.receive(1));
  f.request[67] = uint8_t(Plan::Standard); f.sign(); TEST_ASSERT_TRUE(f.receive(2));
  TEST_ASSERT_EQUAL(2, f.action.plan.count); Timetable plan = f.action.plan;
  TEST_ASSERT_EQUAL(1, f.reply[55]);
  TEST_ASSERT_TRUE(f.control.observePlan(1, plan, true, 3, false, f.reply));
  TEST_ASSERT_EQUAL(2, f.reply[55]);
  plan.entries[0].offsetMinutes++; TEST_ASSERT_FALSE(f.control.observePlan(1, plan, true, 4, false, f.reply));
  f.query(2, 10); makePlan(f, 3); TEST_ASSERT_FALSE(f.receive(11));
  makePlan(f, 4, 0); TEST_ASSERT_TRUE(f.receive(12));
  TEST_ASSERT_EQUAL(0, f.action.plan.count);
}
void test_python_golden_wire_hmac_not_encoder_roundtrip() {
  const char* hex = "48444331030200000000010200000000020807060504030201111111111111111111111111111111111817161514131211f0ffffff0502b00400000000000000000000000000000000000000000000000000000000000000000000000000000012ee4360577a85117c01dda27e246bcfd9529ee46c9918f1f83f940a8255d534";
  uint8_t golden[128];
  auto nibble = [](char value) -> uint8_t { return value <= '9' ? value - '0' : value - 'a' + 10; };
  for (size_t i = 0; i < 128; ++i) golden[i] = (nibble(hex[i * 2]) << 4) | nibble(hex[i * 2 + 1]);
  CryptoFixture crypto; for (uint8_t i = 0; i < 32; ++i) crypto.key[i] = i;
  uint8_t tag[32]; TEST_ASSERT_TRUE(crypto.hmac(&crypto, golden, 96, tag));
  TEST_ASSERT_EQUAL_MEMORY(golden + 96, tag, 32);
  TEST_ASSERT_EQUAL_UINT64(0x0102030405060708ULL, controlRead(golden + 17, 8));
  TEST_ASSERT_EQUAL_UINT64(0x1112131415161718ULL, controlRead(golden + 41, 8));
  TEST_ASSERT_EQUAL(1200, controlRead(golden + 55, 4));
}
void test_invalid_identity_reinitialization_and_zero_entropy_fail_closed() {
  CryptoFixture crypto; DesktopControl control;
  uint8_t zero[6]{}, peer[6] = {2,0,0,0,0,1}, other[6] = {2,0,0,0,0,2};
  ControlCrypto callbacks{&crypto, crypto.hmac, crypto.random};
  TEST_ASSERT_FALSE(control.begin(zero, peer, 1, callbacks));
  TEST_ASSERT_FALSE(control.begin(peer, peer, 1, callbacks));
  TEST_ASSERT_TRUE(control.begin(peer, other, 1, callbacks));
  TEST_ASSERT_FALSE(control.begin(peer, other, 2, callbacks));
  Fixture f; f.query(0, 1); f.crypto.entropy = 0;
  controlWrite(f.request + 41, 1, 8); f.sign();
  TEST_ASSERT_FALSE(f.receive(2)); TEST_ASSERT_FALSE(f.control.forced(1, 2));
  TEST_ASSERT_EQUAL_UINT64(1, f.control.lastIssued());
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_invalid_identity_reinitialization_and_zero_entropy_fail_closed);
  RUN_TEST(test_python_golden_wire_hmac_not_encoder_roundtrip);
  RUN_TEST(test_fixed_wire_and_fail_closed_without_crypto);
  RUN_TEST(test_status_query_signed_high_water_and_no_authority);
  RUN_TEST(test_bad_tag_mac_padding_size_and_type_are_rejected);
  RUN_TEST(test_query_retry_does_not_renew_and_high_water_never_reissues);
  RUN_TEST(test_one_action_duplicate_does_not_renew_or_repeat);
  RUN_TEST(test_expiry_boot_invalid_duration_and_failed_crypto);
  RUN_TEST(test_heartbeat_counter_disconnect_total_limit_and_no_resurrection);
  RUN_TEST(test_millis_wrap_and_stop_only_desktop);
  RUN_TEST(test_plan_atomic_validation_leaf_ack_and_idempotence);
  return UNITY_END();
}
