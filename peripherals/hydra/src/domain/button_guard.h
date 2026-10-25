#pragma once
#include <cstdint>

namespace hydra {

// A reconfiguration gesture is valid only when the button was already pressed
// on the first boot sample and remains held for the full threshold. A later
// runtime press cannot reopen this boot-only path.
struct ButtonArmState {
  bool initialized = false;
  bool bootHeld = false;
  bool reconfigure = false;
  uint32_t pressedAtMs = 0;
};

inline bool observeBootButton(ButtonArmState& state, bool pressed, uint32_t now,
                              uint32_t holdMs) {
  if (!state.initialized) {
    state.initialized = true;
    if (pressed) {
      state.bootHeld = true;
      state.pressedAtMs = now;
    }
    return false;
  }
  if (!state.bootHeld || state.reconfigure) return state.reconfigure;
  if (!pressed) {
    state.bootHeld = false;
    return false;
  }
  if (now - state.pressedAtMs >= holdMs) state.reconfigure = true;
  return state.reconfigure;
}

}  // namespace hydra
