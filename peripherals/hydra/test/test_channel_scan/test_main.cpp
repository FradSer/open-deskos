#include <unity.h>

#include <domain/channel_scan.h>

using namespace hydra;

// Mirrors features/fleet_channel.feature. The channel-acquisition timing is pure,
// so it runs on the host: pio test -e native. The composition root supplies
// timestamps, re-pins the radio when `channel` changes, and broadcasts a pairing
// request while `scanning`.

namespace {
constexpr ChannelScanConfig kCfg{/*silenceTimeoutMs=*/15000, /*dwellMs=*/700};
}

void setUp() {}
void tearDown() {}

// A locked node that keeps hearing the main node never starts a sweep.
void test_locked_node_stays_put_while_heard() {
  ChannelScanState s{/*scanning=*/false, /*channel=*/6, /*lastHeardMs=*/10000,
                     /*dwellStartMs=*/0};
  s = serviceScan(s, kCfg, /*recover=*/true, /*forceScan=*/false, /*now=*/12000);
  TEST_ASSERT_FALSE(s.scanning);
  TEST_ASSERT_EQUAL_UINT8(6, s.channel);
}

// Going silent past the timeout makes a paired (recovering) node begin to sweep,
// dwelling on its current channel first rather than hopping immediately.
void test_silence_starts_sweep_on_current_channel() {
  ChannelScanState s{false, 6, /*lastHeardMs=*/0, 0};
  s = serviceScan(s, kCfg, /*recover=*/true, /*forceScan=*/false, /*now=*/15000);
  TEST_ASSERT_TRUE(s.scanning);
  TEST_ASSERT_EQUAL_UINT8(6, s.channel);  // dwell here first
  TEST_ASSERT_EQUAL_UINT32(15000, s.dwellStartMs);
}

// An unpaired idle node (recover=false, not force-scanning) never sweeps, even
// though it has never heard the main node.
void test_idle_unpaired_node_never_sweeps() {
  ChannelScanState s{false, kDefaultScanChannel, /*lastHeardMs=*/0, 0};
  s = serviceScan(s, kCfg, /*recover=*/false, /*forceScan=*/false, /*now=*/999999);
  TEST_ASSERT_FALSE(s.scanning);
}

// Holding the button to pair forces a sweep regardless of silence/recovery.
void test_force_scan_overrides_recent_contact() {
  ChannelScanState s{false, 1, /*lastHeardMs=*/10000, 0};
  s = serviceScan(s, kCfg, /*recover=*/false, /*forceScan=*/true, /*now=*/10100);
  TEST_ASSERT_TRUE(s.scanning);
}

// Once the dwell elapses, the sweep hops to the next channel and restarts the dwell.
void test_dwell_advances_to_next_channel() {
  ChannelScanState s{/*scanning=*/true, 1, 0, /*dwellStartMs=*/0};
  s = serviceScan(s, kCfg, true, true, /*now=*/700);
  TEST_ASSERT_EQUAL_UINT8(2, s.channel);
  TEST_ASSERT_EQUAL_UINT32(700, s.dwellStartMs);
}

// Before the dwell elapses the channel holds steady.
void test_dwell_holds_before_timeout() {
  ChannelScanState s{true, 5, 0, /*dwellStartMs=*/1000};
  s = serviceScan(s, kCfg, true, true, /*now=*/1500);
  TEST_ASSERT_EQUAL_UINT8(5, s.channel);
}

// The sweep wraps from the top of the 2.4 GHz band back to the bottom.
void test_dwell_wraps_at_top_of_band() {
  ChannelScanState s{true, kChannelMax, 0, /*dwellStartMs=*/0};
  s = serviceScan(s, kCfg, true, true, /*now=*/700);
  TEST_ASSERT_EQUAL_UINT8(kChannelMin, s.channel);
}

// Hearing any main-node frame locks the node here and refreshes the watchdog.
void test_on_main_heard_locks_and_refreshes() {
  ChannelScanState s{/*scanning=*/true, 11, /*lastHeardMs=*/0, 5000};
  s = onMainHeard(s, /*now=*/20000);
  TEST_ASSERT_FALSE(s.scanning);
  TEST_ASSERT_EQUAL_UINT32(20000, s.lastHeardMs);
  TEST_ASSERT_EQUAL_UINT8(11, s.channel);  // lock on the channel we heard it on
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_locked_node_stays_put_while_heard);
  RUN_TEST(test_silence_starts_sweep_on_current_channel);
  RUN_TEST(test_idle_unpaired_node_never_sweeps);
  RUN_TEST(test_force_scan_overrides_recent_contact);
  RUN_TEST(test_dwell_advances_to_next_channel);
  RUN_TEST(test_dwell_holds_before_timeout);
  RUN_TEST(test_dwell_wraps_at_top_of_band);
  RUN_TEST(test_on_main_heard_locks_and_refreshes);
  return UNITY_END();
}
