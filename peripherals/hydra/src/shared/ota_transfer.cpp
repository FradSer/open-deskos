#include "shared/ota_transfer.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>

#include "shared/config.h"
#include "shared/ota_writer.h"

namespace hydra {

bool transferOtaHttp(const char* url, uint32_t announcedSize, const uint8_t expectedSha[32],
                     OtaWriter& writer) {
  OtaHttpUrl parsed{};
  if (!parseOtaHttpUrl(url, parsed)) {
    Serial.println("[ota] bad URL (HTTP LAN URL required)");
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(10000);
  if (!http.begin(client, parsed.host, parsed.port, parsed.path)) {
    Serial.println("[ota] http.begin failed");
    return false;
  }

  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("[ota] HTTP GET failed: %d\n", code);
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  OtaTransferPlan plan = makeOtaTransferPlan(announcedSize, contentLength);
  if (!plan.valid) {
    Serial.println("[ota] size mismatch or missing transfer bound");
    http.end();
    return false;
  }
  if (!writer.begin(plan.bound)) {
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buffer[1024];
  size_t written = 0;
  uint32_t lastProgressAt = millis();
  bool ok = true;
  while (http.connected() && written < plan.bound) {
    size_t available = stream->available();
    if (available == 0) {
      if (otaTransferStalled(lastProgressAt, millis(), config::kOtaStallMs)) {
        Serial.println("[ota] download stalled -- aborting");
        ok = false;
        break;
      }
      delay(1);
      continue;
    }

    size_t wanted = available < sizeof(buffer) ? available : sizeof(buffer);
    size_t remaining = plan.bound - written;
    if (wanted > remaining) wanted = remaining;
    if (!canAcceptOtaChunk(plan, written, wanted)) {
      Serial.println("[ota] download exceeded bound -- aborting");
      ok = false;
      break;
    }
    int read = stream->readBytes(buffer, wanted);
    if (read <= 0 || !writer.write(buffer, static_cast<size_t>(read))) {
      ok = false;
      break;
    }
    written += static_cast<size_t>(read);
    lastProgressAt = millis();
  }
  http.end();

  if (!ok || written != plan.bound) {
    Serial.printf("[ota] write incomplete: %u/%u\n", static_cast<unsigned>(written),
                  static_cast<unsigned>(plan.bound));
    writer.abort();
    return false;
  }
  return writer.finish(expectedSha);
}

}  // namespace hydra
