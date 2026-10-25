#pragma once
constexpr int WIFI_STA = 1;
struct FakeSta { bool started() { return true; } };
struct FakeWiFi { FakeSta STA; void mode(int) {} void setSleep(bool) {} void setAutoReconnect(bool) {} void disconnect(bool, bool) {} };
inline FakeWiFi WiFi;
