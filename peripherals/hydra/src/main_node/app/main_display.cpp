#include "main_node/app/main_display.h"

#include <M5Unified.h>

#include "main_node/app/main_display_model.h"
#include "main_node/app/status_style.h"
#include "domain/fleet_view.h"

namespace hydra {

namespace {

// Screen geometry (M5StickC Plus, rotation 0: portrait 135x240).
constexpr int SCREEN_W = 135;
constexpr int SCREEN_H = 240;
constexpr int BIG_W = 24;    // char width at size 4 (6x8 font)
constexpr int MED_W = 18;    // char width at size 3
constexpr int SMALL_W = 12;  // char width at size 2

// Off-screen buffer: the hub redraws every ~1 s, so compose into a sprite and
// push it in one shot to avoid the black-flash of a per-frame fillScreen.
// Function-local static dodges static-init ordering vs the global M5 display.
M5Canvas& canvas() {
  static M5Canvas c(&M5.Display);
  return c;
}

// Primary readouts: temperature warm, humidity cool. Pressure stays neutral.
constexpr uint16_t COLOR_TEMP = 0xFD20;  // amber
constexpr uint16_t COLOR_HUMID = TFT_CYAN;
constexpr uint16_t COLOR_LABEL = TFT_DARKGREY;
constexpr uint16_t COLOR_DIVIDER = 0x4208;  // dim grey

uint16_t lightStatusColor(LightDisplayStatus status) {
  switch (status) {
    case LightDisplayStatus::Low: return 0xFDA0;
    case LightDisplayStatus::Ok: return TFT_GREEN;
    case LightDisplayStatus::Bright: return TFT_RED;
    case LightDisplayStatus::Unavailable: return COLOR_LABEL;
  }
  return COLOR_LABEL;
}

uint16_t vpdStatusColor(VpdDisplayStatus status) {
  switch (status) {
    case VpdDisplayStatus::Dry: return 0xFDA0;
    case VpdDisplayStatus::Humid: return TFT_CYAN;
    case VpdDisplayStatus::Ok: return TFT_GREEN;
    case VpdDisplayStatus::Unavailable: return COLOR_LABEL;
  }
  return COLOR_LABEL;
}

uint16_t soilStatusColor(SoilDisplayStatus status) {
  switch (status) {
    case SoilDisplayStatus::Dry: return TFT_RED;
    case SoilDisplayStatus::Low: return 0xFDA0;
    case SoilDisplayStatus::Ok: return TFT_WHITE;
    case SoilDisplayStatus::Good: return TFT_GREEN;
    case SoilDisplayStatus::Wet: return TFT_CYAN;
    case SoilDisplayStatus::Nc: return COLOR_LABEL;
  }
  return COLOR_LABEL;
}

// Double-strike for a faux-bold readout, matching the sub-node display.
void drawBold(M5Canvas& d, int x, int y, const char* text) {
  d.setCursor(x, y);
  d.print(text);
  d.setCursor(x + 1, y);
  d.print(text);
}

// One large (size 4) primary metric: grey label, bold value, small unit.
void drawPrimary(M5Canvas& d, int labelY, const char* label, bool valid,
                 const char* value, const char* unit, uint16_t color) {
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, labelY);
  d.print(label);

  int valueY = labelY + 18;
  d.setTextSize(4);
  d.setTextColor(valid ? color : COLOR_LABEL);
  drawBold(d, 4, valueY, value);
  if (!valid) return;
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4 + (int)strlen(value) * BIG_W + 4, valueY + 16);  // bottom-aligned
  d.print(unit);
}

}  // namespace

void MainDisplay::begin() {
  M5.Display.setRotation(0);
  M5.Display.fillScreen(TFT_BLACK);
  canvas().setColorDepth(16);
  canvas().createSprite(SCREEN_W, SCREEN_H);
}

void MainDisplay::renderEnv(const EnvMetrics& e) {
  EnvDisplayModel model = makeEnvDisplayModel(e);
  auto& d = canvas();
  d.fillScreen(TFT_BLACK);

  // -- Primary: temperature, then humidity (size 4 bold) -----------------
  drawPrimary(d, 8, "TEMP", model.valid, model.temperatureText, "C", COLOR_TEMP);
  drawPrimary(d, 68, "HUMID", model.valid, model.humidityText, "%", COLOR_HUMID);

  // -- Derived: VPD band in the humidity block's right margin ------------
  // The headline transpiration signal this node computes -- shown to the operator
  // here, not just shipped to sub-nodes. Right-aligned beside the HUMID readout.
  if (model.valid) {
    d.setTextSize(1);
    d.setTextColor(COLOR_LABEL);
    d.setCursor(SCREEN_W - 2 - 3 * 6, 68);  // "VPD", size-1 char = 6px
    d.print("VPD");
    d.setTextSize(2);
    d.setTextColor(vpdStatusColor(model.vpdStatus));
    d.setCursor(SCREEN_W - 2 - (int)strlen(model.vpdText) * SMALL_W, 84);
    d.print(model.vpdText);
    d.setCursor(SCREEN_W - 2 - (int)strlen(model.vpdStatusText) * SMALL_W, 104);
    d.print(model.vpdStatusText);
  }

  d.drawFastHLine(4, 128, SCREEN_W - 8, COLOR_DIVIDER);

  // -- Secondary: pressure (size 3) --------------------------------------
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 140);
  d.print("PRES");
  d.setTextSize(3);
  d.setTextColor(model.valid ? TFT_WHITE : COLOR_LABEL);
  d.setCursor(4, 160);
  d.print(model.pressureText);
  if (model.valid) {
    d.setTextSize(2);
    d.setTextColor(COLOR_LABEL);
    d.setCursor(4 + (int)strlen(model.pressureText) * MED_W + 4, 168);
    d.print("hPa");
  }

  // -- Secondary: light (size 3) + OK/LOW/BRIGHT status ------------------
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 192);
  d.print("LUX");
  if (model.lightValid) {
    // Status right-aligned on the label row (fits beside "LUX" even for BRIGHT).
    int sx = SCREEN_W - 2 - (int)strlen(model.lightStatusText) * SMALL_W;
    d.setTextColor(lightStatusColor(model.lightStatus));
    d.setCursor(sx, 192);
    d.print(model.lightStatusText);

    d.setTextSize(3);
    d.setTextColor(lightStatusColor(model.lightStatus));
    d.setCursor(4, 210);
    d.print(model.lightText);
    d.setTextSize(2);
    d.setTextColor(COLOR_LABEL);
    d.setCursor(4 + (int)strlen(model.lightText) * MED_W + 4, 218);
    d.print("lx");
  } else {
    d.setTextSize(3);
    d.setTextColor(COLOR_LABEL);
    d.setCursor(4, 210);
    d.print(model.lightText);
  }

  d.pushSprite(0, 0);
}

void MainDisplay::renderNode(const NodeStatus& n, int index, int total, bool forcing) {
  NodeDisplayModel model = makeNodeDisplayModel(n, index, total, forcing);
  auto& d = canvas();
  d.fillScreen(TFT_BLACK);

  // -- Header: NODE id (large) + position (n/total, right) ---------------
  d.setTextSize(3);
  d.setTextColor(model.online ? TFT_WHITE : COLOR_LABEL);
  d.setCursor(4, 6);
  drawBold(d, 4, 6, model.nodeText);

  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(SCREEN_W - 4 - (int)strlen(model.positionText) * SMALL_W, 12);
  d.print(model.positionText);

  // MAC suffix so two plants are distinguishable at a glance.
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 34);
  d.print(model.macText);

  d.drawFastHLine(4, 56, SCREEN_W - 8, COLOR_DIVIDER);

  if (!model.online) {
    d.setTextSize(3);
    d.setTextColor(TFT_RED);
    drawBold(d, 4, 110, nodeDisplayStateLabel(model.state));
    d.pushSprite(0, 0);
    return;
  }

  // -- Soil moisture (primary, size 4 bold) ------------------------------
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 70);
  d.print("SOIL");
  if (model.soilStatus != SoilDisplayStatus::Nc) {
    d.setTextSize(4);
    d.setTextColor(soilStatusColor(model.soilStatus));
    drawBold(d, 4, 90, model.soilText);
    d.setTextSize(2);
    d.setTextColor(COLOR_LABEL);
    d.setCursor(4 + (int)strlen(model.soilText) * BIG_W + 4, 106);
    d.print("%");
    d.setTextSize(2);
    d.setTextColor(soilStatusColor(model.soilStatus));
    d.setCursor(4, 124);
    d.print(model.soilStatusText);
  } else {
    d.setTextSize(4);
    d.setTextColor(COLOR_LABEL);
    drawBold(d, 4, 90, model.soilText);
  }

  d.drawFastHLine(4, 150, SCREEN_W - 8, COLOR_DIVIDER);

  // -- Pump state (size 3) -----------------------------------------------
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 162);
  d.print("PUMP");
  d.setTextSize(3);
  d.setTextColor(statusColor(model.pumpStatus));
  drawBold(d, 4, 184, model.pumpText);

  d.pushSprite(0, 0);
}

void MainDisplay::renderNoNodes() {
  auto& d = canvas();
  d.fillScreen(TFT_BLACK);

  d.setTextSize(3);
  d.setTextColor(TFT_WHITE);
  d.setCursor(4, 6);
  d.print("FLEET");
  d.drawFastHLine(4, 36, SCREEN_W - 8, COLOR_DIVIDER);

  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 96);
  d.print("no nodes");
  d.setCursor(4, 120);
  d.print("scanning");

  d.pushSprite(0, 0);
}

void MainDisplay::renderMenu(MenuItem selected) {
  auto& d = canvas();
  d.fillScreen(TFT_BLACK);

  d.setTextSize(3);
  d.setTextColor(0xFD20);  // amber, like PAIR/SETUP
  drawBold(d, 4, 6, "MENU");
  d.drawFastHLine(4, 36, SCREEN_W - 8, COLOR_DIVIDER);

  // Entries in MenuItem order; ">" marks the selection.
  int y = 56;
  for (int i = 0; i < kMenuItemCount; i++) {
    MenuItem item = static_cast<MenuItem>(i);
    bool sel = (item == selected);
    d.setTextSize(2);
    d.setTextColor(sel ? TFT_CYAN : TFT_WHITE);
    d.setCursor(4, y);
    d.print(sel ? ">" : " ");
    d.setCursor(20, y);
    d.print(menuItemLabel(item));
    y += 28;
  }

  d.drawFastHLine(4, y + 4, SCREEN_W - 8, COLOR_DIVIDER);

  // Button legend, matching the two physical buttons.
  d.setTextSize(2);
  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, y + 16);
  d.print("side:move");
  d.setCursor(4, y + 38);
  d.print("front:ok");

  d.pushSprite(0, 0);
}

void MainDisplay::renderConfig(const FleetRoster& roster, uint8_t justPaired) {
  auto& d = canvas();
  d.fillScreen(TFT_BLACK);

  d.setTextSize(3);
  d.setTextColor(0xFD20);  // amber
  drawBold(d, 4, 6, "PAIR");
  d.drawFastHLine(4, 36, SCREEN_W - 8, COLOR_DIVIDER);

  // Instruction: long-press a sub-node's button to request an id.
  d.setTextSize(2);
  d.setTextColor(TFT_WHITE);
  d.setCursor(4, 44);
  d.print("Hold sub");
  d.setCursor(4, 64);
  d.print("node btn");

  d.drawFastHLine(4, 88, SCREEN_W - 8, COLOR_DIVIDER);

  if (roster.count() == 0) {
    d.setTextSize(2);
    d.setTextColor(COLOR_LABEL);
    d.setCursor(4, 96);
    d.print("none yet");
    d.pushSprite(0, 0);
    return;
  }

  int y = 96;
  for (int i = 0; i < roster.count() && y < SCREEN_H - 16; i++) {
    const NodeStatus& n = roster.at(i);
    bool isNew = (justPaired != 0 && n.nodeId == justPaired);
    char buf[20];
    snprintf(buf, sizeof(buf), "N%d %02X:%02X", n.nodeId, n.mac[4], n.mac[5]);
    d.setTextSize(2);
    d.setTextColor(isNew ? TFT_GREEN : TFT_WHITE);
    d.setCursor(4, y);
    d.print(buf);
    y += 22;
  }

  d.pushSprite(0, 0);
}

void MainDisplay::renderSetup(const char* apName, const char* portalUrl) {
  auto& d = canvas();
  d.fillScreen(TFT_BLACK);

  d.setTextSize(3);
  d.setTextColor(0xFD20);  // amber, like PAIR
  drawBold(d, 4, 6, "SETUP");
  d.drawFastHLine(4, 36, SCREEN_W - 8, COLOR_DIVIDER);

  d.setTextSize(2);
  d.setTextColor(TFT_WHITE);
  d.setCursor(4, 48);
  d.print("Join WiFi:");
  d.setTextColor(TFT_CYAN);
  d.setCursor(4, 70);
  d.print(apName);

  d.setTextColor(TFT_WHITE);
  d.setCursor(4, 104);
  d.print("then open:");
  d.setTextColor(TFT_CYAN);
  d.setCursor(4, 126);
  d.print(portalUrl);

  d.setTextColor(COLOR_LABEL);
  d.setCursor(4, 170);
  d.print("WiFi+MQTT");
  d.setCursor(4, 192);
  d.print("broker IP");

  d.pushSprite(0, 0);
}

}  // namespace hydra
