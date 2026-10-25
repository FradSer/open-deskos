#pragma once
#include "domain/timetable.h"
namespace hydra {
// Retains only the last installed window. An exact retry never rearms its clock.
// This state is volatile; it makes no cross-reboot replay guarantee.
class PlanInstallReceipt {
 public:
  template<class Installer>
  bool install(const Timetable& table, Installer installer) {
    if (!table.windowSeq || validateTimetable(table) != TimetableFault::Ok) return false;
    if (valid_ && table.windowSeq <= table_.windowSeq)
      return table.windowSeq == table_.windowSeq && sameTimetable(table, table_);
    if (!installer(table)) return false;
    table_ = table; valid_ = true; return true;
  }
 private:
  bool valid_ = false;
  Timetable table_{};
};
}  // namespace hydra
