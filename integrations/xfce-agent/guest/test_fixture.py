"""Public HTTP fixture behavior and secret exclusion checks."""

from __future__ import annotations

import json
import threading
import unittest
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fixture import create_servers


class FixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ui, self.monitor = create_servers(0, 0, "127.0.0.1")
        self.threads = []
        for server in (self.ui, self.monitor):
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.threads.append(thread)

    def tearDown(self) -> None:
        for server in (self.ui, self.monitor):
            server.shutdown()
            server.server_close()
        for thread in self.threads:
            thread.join()

    def call(self, path: str, fields: dict[str, str] | None = None, monitor: bool = False, options: dict | None = None) -> bytes:
        port = (self.monitor if monitor else self.ui).server_address[1]
        data = None
        headers = {}
        if options is not None:
            data = json.dumps(options).encode()
            headers["Content-Type"] = "application/json"
        elif fields is not None:
            data = urlencode(fields).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        with urlopen(Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers), timeout=3) as response:
            return response.read()

    def state(self) -> dict:
        return json.loads(self.call("/state", monitor=True))

    def test_search_product_add_and_cart_have_independent_state(self) -> None:
        self.assertEqual(self.state()["cart"], [])
        page = self.call("/search", {"query": "USB-C cable"}).decode()
        self.assertIn("$11.99", page)
        self.assertIn("$9.99", page)
        self.assertIn("$18.99", page)
        self.assertIn("USB-A to USB-C", page)
        self.call("/product/cable-1m")
        self.call("/add", {})
        self.call("/add", {})
        self.call("/cart")
        state = self.state()
        self.assertEqual(state["view"], "cart")
        self.assertEqual(state["currency"], "USD")
        self.assertEqual(state["cart"], [{"id": "cable-1m", "title": "USB-C to USB-C Cable", "length": "1m", "connector": "USB-C to USB-C", "price": 11.99, "quantity": 1}])
        self.assertEqual(sum(event["type"] == "add_to_cart" for event in state["events"]), 1)
        self.assertTrue(all(set(event) == {"type"} for event in state["events"]))

    def test_login_gate_precedes_form_and_never_retains_test_strings(self) -> None:
        self.call("/reset", monitor=True, options={"loginRequired": True, "seed": 317})
        self.call("/search", {"query": "USB-C cable"})
        self.call("/product/cable-1m")
        page = self.call("/add", {}).decode()
        state = self.state()
        self.assertTrue(state["privacyRequired"])
        self.assertEqual(state["view"], "login")
        self.assertEqual(state["cart"], [])
        self.assertIn('type="password"', page)
        self.assertIn('autocomplete="off" autofocus required', page)
        password, otp = "DISPOSABLE-SECRET-293", "DISPOSABLE-OTP-941"
        page = self.call("/login", {"password": password, "otp": otp}).decode()
        state = self.state()
        self.assertFalse(state["privacyRequired"])
        self.assertTrue(state["authenticated"])
        self.assertEqual(state["view"], "detail")
        self.assertEqual(state["cart"], [])
        self.assertNotIn(password, page + json.dumps(state))
        self.assertNotIn(otp, page + json.dumps(state))
        self.call("/add", {})
        self.assertEqual(len(self.state()["cart"]), 1)

    def test_empty_login_stays_private_without_echoing_partial_input(self) -> None:
        self.call("/login-start", {})
        page = self.call("/login", {"password": "NOT-RETAINED", "otp": ""}).decode()
        self.assertTrue(self.state()["privacyRequired"])
        self.assertNotIn("NOT-RETAINED", page + json.dumps(self.state()))

    def test_seed_controls_product_order_and_reset_clears_state(self) -> None:
        self.call("/reset", monitor=True, options={"seed": 42})
        first_id = self.state()["runId"]
        first = self.call("/search", {"query": "cable"}).decode()
        self.call("/product/cable-1m")
        self.call("/add", {})
        self.call("/reset", monitor=True, options={"seed": 42})
        self.assertNotEqual(self.state()["runId"], first_id)
        self.assertEqual(self.state()["cart"], [])
        self.assertEqual(self.state()["events"], [])
        second = self.call("/search", {"query": "cable"}).decode()
        self.assertEqual(first.replace(first_id, "RUN"), second.replace(self.state()["runId"], "RUN"))

    def test_reset_watcher_reads_only_run_id_and_navigates_without_form_access(self) -> None:
        run_id = self.state()["runId"]
        self.assertEqual(json.loads(self.call("/run-id")), {"runId": run_id})
        script = self.call("/reset-watch.js").decode()
        self.assertIn("fetch('/run-id'", script)
        self.assertIn("location.replace('/')", script)
        for forbidden in ("password", "otp", "FormData", "querySelector", ".value", "innerText"):
            self.assertNotIn(forbidden, script)


if __name__ == "__main__":
    unittest.main()
