#pragma once

// Pure UI state machine for the main node's pages. No hardware dependencies, so
// it is unit-tested on the host (pio test -e native) the same way decidePump is.
// The composition root maps button events to these transitions and renders by
// `view`.
//
// Front button (BtnA): short press toggles Env <-> Node and confirms the menu
//   selection; long press opens the settings menu (and cancels out of any
//   settings page back to Env).
// Side button (BtnB): cycles the selected node on the Node page and the
//   selection on the Menu page; no-op elsewhere.
//
// Settings menu entries, in display order: Network (rerun the captive portal),
// Pairing (assign sub-node IDs). Reaching Setup makes the composition root run
// the blocking portal and restart, so Setup never renders as a regular page.

namespace hydra {

enum class FleetView { Env, Node, Menu, Setup, Config };

enum class MenuItem { Network = 0, Pairing = 1 };
constexpr int kMenuItemCount = 2;

// Display label for a menu entry -- same idiom as pumpStatusLabel: the domain
// owns the text so the enum, the count and the labels live in one place.
inline const char* menuItemLabel(MenuItem m) {
  switch (m) {
    case MenuItem::Network: return "Network";
    case MenuItem::Pairing: return "Pair subs";
  }
  return "?";
}

struct FleetViewState {
  FleetView view = FleetView::Env;
  int selectedNode = 0;  // index into the roster, valid when nodeCount > 0
  int nodeCount = 0;
  MenuItem menuItem = MenuItem::Network;  // selection on the Menu page
};

// Short press of the front button: Env -> Node, Menu -> the selected entry,
// anything else back to Env.
inline FleetViewState onFrontShort(FleetViewState s) {
  switch (s.view) {
    case FleetView::Env:
      s.view = FleetView::Node;
      break;
    case FleetView::Menu:
      s.view = (s.menuItem == MenuItem::Network) ? FleetView::Setup : FleetView::Config;
      break;
    default:  // Node, Config, Setup
      s.view = FleetView::Env;
      break;
  }
  return s;
}

// Long press (hold) of the front button: open the settings menu from the
// regular pages (selection reset to the first entry); cancel back to Env from
// the menu or any settings page.
inline FleetViewState onFrontLong(FleetViewState s) {
  if (s.view == FleetView::Env || s.view == FleetView::Node) {
    s.view = FleetView::Menu;
    s.menuItem = MenuItem::Network;
  } else {
    s.view = FleetView::Env;
  }
  return s;
}

// Side button: advance to the next sub-node (wrapping) on the Node page, or the
// next menu entry (wrapping) on the Menu page.
inline FleetViewState onSide(FleetViewState s) {
  if (s.view == FleetView::Node && s.nodeCount > 0) {
    s.selectedNode = (s.selectedNode + 1) % s.nodeCount;
  } else if (s.view == FleetView::Menu) {
    s.menuItem = static_cast<MenuItem>((static_cast<int>(s.menuItem) + 1) % kMenuItemCount);
  }
  return s;
}

// Keep the selection in range as the roster grows or shrinks. selectedNode is
// only ever advanced via % (non-negative) or reset to 0, so the only real cases
// are an empty roster or selection past the new end of a shrunken roster.
inline FleetViewState clampSelection(FleetViewState s) {
  if (s.nodeCount <= 0) {
    s.selectedNode = 0;
  } else if (s.selectedNode >= s.nodeCount) {
    s.selectedNode = s.nodeCount - 1;
  }
  return s;
}

}  // namespace hydra
