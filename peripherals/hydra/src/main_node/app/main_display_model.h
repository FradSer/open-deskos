#pragma once

#include <cstdio>

#include "domain/env_metrics.h"
#include "domain/irrigation_policy.h"
#include "domain/node_status.h"
#include "main_node/config.h"

namespace hydra {

// Presentation semantics used by the M5Canvas display adapter. This stays free
// of M5GFX so labels, validity, and number formatting are host-testable.
enum class LightDisplayStatus { Unavailable, Low, Ok, Bright };
enum class VpdDisplayStatus { Unavailable, Dry, Humid, Ok };
enum class SoilDisplayStatus { Nc, Dry, Low, Ok, Good, Wet };
enum class NodeDisplayState { Online, Offline };

inline const char* lightDisplayStatusLabel(LightDisplayStatus status) {
  switch (status) {
    case LightDisplayStatus::Low: return "LOW";
    case LightDisplayStatus::Ok: return "OK";
    case LightDisplayStatus::Bright: return "BRIGHT";
    case LightDisplayStatus::Unavailable: return "";
  }
  return "";
}

inline const char* vpdDisplayStatusLabel(VpdDisplayStatus status) {
  switch (status) {
    case VpdDisplayStatus::Dry: return "DRY";
    case VpdDisplayStatus::Humid: return "HUMID";
    case VpdDisplayStatus::Ok: return "OK";
    case VpdDisplayStatus::Unavailable: return "";
  }
  return "";
}

inline const char* soilDisplayStatusLabel(SoilDisplayStatus status) {
  switch (status) {
    case SoilDisplayStatus::Nc: return "NC";
    case SoilDisplayStatus::Dry: return "DRY";
    case SoilDisplayStatus::Low: return "LOW";
    case SoilDisplayStatus::Ok: return "OK";
    case SoilDisplayStatus::Good: return "GOOD";
    case SoilDisplayStatus::Wet: return "WET";
  }
  return "NC";
}

inline const char* nodeDisplayStateLabel(NodeDisplayState state) {
  return state == NodeDisplayState::Offline ? "OFFLINE" : "ONLINE";
}

inline LightDisplayStatus classifyLight(float lux) {
  if (lux < config::kLuxLowThreshold) return LightDisplayStatus::Low;
  if (lux > config::kLuxHighThreshold) return LightDisplayStatus::Bright;
  return LightDisplayStatus::Ok;
}

inline VpdDisplayStatus classifyVpd(float vpdKpa) {
  if (vpdKpa > env_mod::kVpdHigh) return VpdDisplayStatus::Dry;
  if (vpdKpa < env_mod::kVpdLow) return VpdDisplayStatus::Humid;
  return VpdDisplayStatus::Ok;
}

inline SoilDisplayStatus classifySoil(float percent) {
  if (percent < 20.0f) return SoilDisplayStatus::Dry;
  if (percent < 35.0f) return SoilDisplayStatus::Low;
  if (percent < 60.0f) return SoilDisplayStatus::Ok;
  if (percent < 80.0f) return SoilDisplayStatus::Good;
  return SoilDisplayStatus::Wet;
}

struct EnvDisplayModel {
  bool valid;
  bool lightValid;
  char temperatureText[12];
  char humidityText[12];
  char pressureText[12];
  char vpdText[12];
  char lightText[12];
  VpdDisplayStatus vpdStatus;
  LightDisplayStatus lightStatus;
  const char* vpdStatusText;
  const char* lightStatusText;
};

inline EnvDisplayModel makeEnvDisplayModel(const EnvMetrics& metrics) {
  EnvDisplayModel model{};
  model.valid = metrics.valid;
  model.lightValid = metrics.luxValid;
  model.vpdStatus = VpdDisplayStatus::Unavailable;
  model.lightStatus = LightDisplayStatus::Unavailable;
  model.vpdStatusText = vpdDisplayStatusLabel(model.vpdStatus);
  model.lightStatusText = lightDisplayStatusLabel(model.lightStatus);

  if (metrics.valid) {
    std::snprintf(model.temperatureText, sizeof(model.temperatureText), "%.1f", metrics.tempC);
    std::snprintf(model.humidityText, sizeof(model.humidityText), "%.0f", metrics.humidity);
    std::snprintf(model.pressureText, sizeof(model.pressureText), "%.0f",
                  metrics.pressurePa / 100.0f);
    std::snprintf(model.vpdText, sizeof(model.vpdText), "%.2f", metrics.vpdKpa);
    model.vpdStatus = classifyVpd(metrics.vpdKpa);
    model.vpdStatusText = vpdDisplayStatusLabel(model.vpdStatus);
  } else {
    std::snprintf(model.temperatureText, sizeof(model.temperatureText), "--");
    std::snprintf(model.humidityText, sizeof(model.humidityText), "--");
    std::snprintf(model.pressureText, sizeof(model.pressureText), "--");
  }

  if (metrics.luxValid) {
    std::snprintf(model.lightText, sizeof(model.lightText), "%.0f", metrics.lux);
    model.lightStatus = classifyLight(metrics.lux);
    model.lightStatusText = lightDisplayStatusLabel(model.lightStatus);
  } else {
    std::snprintf(model.lightText, sizeof(model.lightText), "-- lx");
  }
  return model;
}

struct NodeDisplayModel {
  bool online;
  NodeDisplayState state;
  char nodeText[12];
  char positionText[12];
  char macText[12];
  char soilText[12];
  char pumpText[12];
  SoilDisplayStatus soilStatus;
  const char* soilStatusText;
  PumpStatus pumpStatus;
};

inline NodeDisplayModel makeNodeDisplayModel(const NodeStatus& node, int index, int total,
                                             bool forcing) {
  NodeDisplayModel model{};
  model.online = node.online;
  model.state = node.online ? NodeDisplayState::Online : NodeDisplayState::Offline;
  std::snprintf(model.nodeText, sizeof(model.nodeText), "N%d", node.nodeId);
  std::snprintf(model.positionText, sizeof(model.positionText), "%d/%d", index + 1, total);
  std::snprintf(model.macText, sizeof(model.macText), "%02X:%02X", node.mac[4], node.mac[5]);
  model.pumpStatus = forcing ? PumpStatus::Watering : node.status;
  std::snprintf(model.pumpText, sizeof(model.pumpText), "%s", pumpStatusLabel(model.pumpStatus));

  if (node.soil.valid) {
    std::snprintf(model.soilText, sizeof(model.soilText), "%.0f", node.soil.percent);
    model.soilStatus = classifySoil(node.soil.percent);
  } else {
    std::snprintf(model.soilText, sizeof(model.soilText), "--");
    model.soilStatus = SoilDisplayStatus::Nc;
  }
  model.soilStatusText = soilDisplayStatusLabel(model.soilStatus);
  return model;
}

}  // namespace hydra
