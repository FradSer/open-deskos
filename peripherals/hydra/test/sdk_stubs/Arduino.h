#pragma once
#include <cstdint>
extern uint32_t sdkNow;
inline uint32_t millis() { return sdkNow; }
inline void delay(uint32_t ms) { sdkNow += ms; }
