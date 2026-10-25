#pragma once
#include <cstdint>

// Pure channel-acquisition state machine for a sub-node. No hardware here, so it
// is unit-tested on the host (pio test -e native) the same way decidePump and the
// view FSM are; the composition root supplies timestamps and applies the side
// effects (re-pinning the radio when `channel` changes, broadcasting a pairing
// request while `scanning`).
//
// Why this exists: the main node, once it joins Wi-Fi, is locked to the router's
// channel (esp_wifi_set_channel is blocked while associated), so the fleet channel
// is whatever the router picked -- not something we choose. A sub-node has no AP,
// so its radio is free to set. It remembers the channel it last paired on and, if
// it stops hearing the main node, sweeps the 2.4 GHz band re-broadcasting its
// pairing request until the main node answers, then locks onto that channel. The
// same sweep serves first-time pairing and recovery after the router moves.

namespace hydra {

// 2.4 GHz channels to sweep. 1-13 covers every region; channels above 11 are
// simply never used where regulations forbid them (the main node will never be
// found there, so the sweep just passes through).
constexpr uint8_t kChannelMin = 1;
constexpr uint8_t kChannelMax = 13;
// Where an unpaired node sits until it sweeps: also the main node's channel before
// it associates with Wi-Fi, so a fresh pair finds it here without sweeping at all.
constexpr uint8_t kDefaultScanChannel = 1;

struct ChannelScanConfig {
  uint32_t silenceTimeoutMs;  // a paired node starts sweeping after this much silence
  uint32_t dwellMs;           // how long to listen on each channel while sweeping
};

struct ChannelScanState {
  bool scanning = false;             // mid-sweep (vs. locked on `channel`)
  uint8_t channel = kDefaultScanChannel;
  uint32_t lastHeardMs = 0;          // last main-node frame; seed to "now" at boot
  uint32_t dwellStartMs = 0;         // when the current sweep dwell began
};

inline uint8_t nextScanChannel(uint8_t ch) {
  return ch >= kChannelMax ? kChannelMin : static_cast<uint8_t>(ch + 1);
}

// A main-node frame arrived on the current channel: lock here and refresh the
// silence watchdog. Used both to end a sweep (we found it) and to keep a locked
// node from ever starting one.
inline ChannelScanState onMainHeard(ChannelScanState s, uint32_t now) {
  s.scanning = false;
  s.lastHeardMs = now;
  return s;
}

// One service pass.
//   recover   -- enable auto-sweep on silence (true only for paired nodes; an
//                unpaired idle node must not sweep on its own).
//   forceScan -- sweep unconditionally (user holding the button to pair).
// On entering a sweep it dwells on the current channel first (the main node is
// most often right where we last heard it); subsequent passes hop once per dwell,
// wrapping across the band. The caller re-pins the radio whenever `channel`
// changes and broadcasts a pairing request while `scanning`.
inline ChannelScanState serviceScan(ChannelScanState s, const ChannelScanConfig& cfg,
                                     bool recover, bool forceScan, uint32_t now) {
  bool wantScan = forceScan || (recover && now - s.lastHeardMs >= cfg.silenceTimeoutMs);
  if (!wantScan) {
    s.scanning = false;
    return s;
  }
  if (!s.scanning) {
    s.scanning = true;
    s.dwellStartMs = now;  // dwell on the current channel before hopping
    return s;
  }
  if (now - s.dwellStartMs >= cfg.dwellMs) {
    s.channel = nextScanChannel(s.channel);
    s.dwellStartMs = now;
  }
  return s;
}

}  // namespace hydra
