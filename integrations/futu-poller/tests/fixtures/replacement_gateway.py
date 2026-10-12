"""Independent local gateway fixture; no SDK or built-in gateway factory."""
from copy import deepcopy

SNAPSHOT = {
    "positions": [{"code": "HK.fixture", "name": "Fixture", "market": "HK", "qty": 2.0,
                   "cost": 4.0, "price": 5.0, "marketVal": 10.0, "plVal": 2.0, "plRatio": 0.25,
                   "dayPlVal": 1.0, "currency": "HKD", "dayRatio": 1.0 / 9.0}],
    "totals": {"marketVal": 10.0, "plVal": 2.0, "cash": 10.0, "dayPlVal": 1.0,
               "dayByCcy": {"HKD": 1.0}, "plRatio": 1.0 / 9.0},
}


class ReplacementGateway:
    def __init__(self, context, fail_once: bool = False) -> None:
        assert context.capability("futu.credentials")["password"] == "fixture"
        self.fail_once = fail_once
        self.closed = False

    def snapshot(self) -> dict:
        assert not self.closed
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("position_list_query failed: fixture failure")
        return deepcopy(SNAPSHOT)

    def close(self) -> None:
        self.closed = True
