#!/usr/bin/env python3
"""Local shopping fixture. Authentication accepts disposable test strings only."""

from __future__ import annotations

import argparse
import html
import json
import random
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

PRODUCTS = (
    {"id": "cable-1m", "title": "USB-C to USB-C Cable", "length": "1m", "connector": "USB-C to USB-C", "price": 11.99},
    {"id": "cable-2m", "title": "USB-C to USB-C Cable", "length": "2m", "connector": "USB-C to USB-C", "price": 9.99},
    {"id": "premium-1m", "title": "Premium USB-C to USB-C Cable", "length": "1m", "connector": "USB-C to USB-C", "price": 18.99},
    {"id": "usb-a-1m", "title": "USB-A to USB-C Cable", "length": "1m", "connector": "USB-A to USB-C", "price": 10.99},
)
RESET_WATCH = b'''(() => {
  const expected = new URL(document.currentScript.src).searchParams.get('runId');
  async function watch() {
    try {
      const response = await fetch('/run-id', {cache: 'no-store', credentials: 'omit'});
      const state = await response.json();
      if (state.runId !== expected) { location.replace('/'); return; }
    } catch {}
    setTimeout(watch, 500);
  }
  setTimeout(watch, 500);
})();'''


class Shop:
    """Keep public fixture state without retaining submitted credentials."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.reset({})

    def reset(self, options: dict[str, Any]) -> None:
        """Reset the fixture from reviewed monitor options."""
        if set(options) - {"loginRequired", "seed"}:
            raise ValueError("Unknown reset option")
        if not isinstance(options.get("loginRequired", False), bool):
            raise ValueError("Invalid login policy")
        seed = options.get("seed", 1)
        if not isinstance(seed, (int, str)) or isinstance(seed, bool) or len(str(seed)) > 64:
            raise ValueError("Invalid seed")
        with self.lock:
            self.run_id = str(uuid.uuid4())
            self.view = "home"
            self.privacy_required = False
            self.login_required = options.get("loginRequired", False)
            self.authenticated = False
            self.search_query = ""
            self.selected: str | None = None
            self.return_view = "home"
            self.cart: list[dict[str, Any]] = []
            self.events: list[dict[str, str]] = []
            self.order = list(PRODUCTS)
            random.Random(str(seed)).shuffle(self.order)

    def event(self, name: str) -> None:
        """Record only a host-defined event type."""
        self.events.append({"type": name})
        self.events = self.events[-128:]

    def snapshot(self) -> dict[str, Any]:
        """Return the independent public observation."""
        with self.lock:
            return {"runId": self.run_id, "view": self.view, "privacyRequired": self.privacy_required, "currency": "USD",
                    "cart": [dict(item) for item in self.cart], "searchQuery": self.search_query,
                    "events": list(self.events), "authenticated": self.authenticated}

    def start_login(self) -> None:
        """Publish privacy before producing any login page."""
        if self.view != "login":
            self.return_view = self.view
        self.privacy_required = True
        self.view = "login"
        self.event("private_login_requested")

    def page(self) -> str:
        """Render a page without secrets, third-party resources, or checkout."""
        escape = html.escape
        cable = '<div class="art"><svg viewBox="0 0 220 120"><path d="M40 35 C130 -10 210 75 150 100 C70 135 45 65 100 45 C135 32 170 65 150 78" fill="none" stroke="#354655" stroke-width="11"/><path d="M40 35 L21 31 M150 78 L175 82" stroke="#8899a5" stroke-width="15"/></svg></div>'
        if self.view == "home":
            content = '<section class="welcome"><h1>Find the right cable.</h1><p>Search and compare connectors, lengths, and prices.</p><p>All products and purchases are simulated.</p></section>'
        elif self.view == "results":
            cards = []
            for product in self.order:
                cards.append(f'<article class="card">{cable}<h2>{escape(product["title"])}</h2><p>{escape(product["connector"])}</p><p>Length: <strong>{product["length"]}</strong></p><p class="price">${product["price"]:.2f}</p><a class="button" href="/product/{product["id"]}">View product</a></article>')
            content = f'<h1>Search results</h1><p>4 products for “{escape(self.search_query)}”</p><div class="cards">{"".join(cards)}</div>'
        elif self.view == "detail":
            product = next(item for item in PRODUCTS if item["id"] == self.selected)
            added = any(item["id"] == self.selected for item in self.cart)
            action = '<p class="success">Added to cart · Quantity 1</p>' if added else '<form method="post" action="/add"><button class="primary">Add to cart</button></form>'
            content = f'<a class="button back" href="/results">← Back to results</a><section class="detail">{cable}<div><h1>{escape(product["title"])}</h1><p>Connector: <strong>{escape(product["connector"])}</strong></p><p>Length: <strong>{product["length"]}</strong></p><p>Quantity to add: 1 · Single cable</p><p class="price">${product["price"]:.2f}</p><p>In stock · Simulated product</p>{action}</div></section>'
        elif self.view == "login":
            # Values are never inserted into this page, state, or event records.
            content = '<section class="login"><h1>Private test sign-in</h1><p>Use disposable test strings only. This is not a real account.</p><p>The Agent must wait while you complete this form.</p><form method="post" action="/login" autocomplete="off"><label>Test password<input name="password" type="password" autocomplete="off" autofocus required></label><label>Test one-time code<input name="otp" type="password" autocomplete="off" required></label><button class="primary">Finish private test sign-in</button></form></section>'
        else:
            rows = [f'<article class="cart-row">{cable}<div><h2>{escape(item["title"])}</h2><p>Connector: {escape(item["connector"])}</p><p>Length: <strong>{item["length"]}</strong></p><p>Quantity: <strong>{item["quantity"]}</strong></p></div><strong class="price">${item["price"]:.2f}</strong></article>' for item in self.cart]
            content = '<h1>Shopping cart</h1>' + (''.join(rows) if rows else '<p>Your cart is empty.</p>')
            if rows:
                content += f'<div class="subtotal">Subtotal ({len(rows)} item): ${sum(item["price"] * item["quantity"] for item in self.cart):.2f}</div>'
        login = '<span class="signed">Test signed in</span>' if self.authenticated else '<form method="post" action="/login-start"><button>Test sign-in</button></form>'
        return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Market Simulation</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f2f4f5;color:#172633;font:18px Arial,sans-serif}}header{{height:100px;background:#172d3e;color:white;display:flex;align-items:center;gap:18px;padding:20px 25px}}.brand{{font-size:26px;font-weight:bold}}.badge{{background:#ffdf85;color:#352e11;padding:7px}}form{{margin:0}}.search{{display:flex;flex:1}}input,button,.button{{font:inherit;border:1px solid #a2adb4;border-radius:7px;padding:12px 16px;min-height:48px}}input{{min-width:0}}.search input{{width:100%}}button,.button{{cursor:pointer;background:white;color:#172633;text-decoration:none;display:inline-block}}.search button,.primary{{background:#ffd56b}}main{{padding:24px;max-width:1280px;margin:auto}}h1{{font-size:30px;margin:0 0 16px}}h2{{font-size:22px}}p{{line-height:1.4}}.cards{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}}.card{{background:white;border:1px solid #ccd4d9;border-radius:10px;padding:18px;min-height:430px}}.card h2{{min-height:54px}}.art{{background:#f5f6f6;border-radius:7px;height:110px;display:flex;align-items:center;justify-content:center}}.art svg{{width:220px;height:120px}}.price{{font-size:28px;font-weight:bold}}.detail{{background:white;padding:30px;display:grid;grid-template-columns:420px 1fr;gap:35px}}.detail .art{{height:330px}}.detail .art svg{{width:380px;height:260px}}.back{{margin-bottom:18px}}.welcome,.login{{padding:40px;background:white;border-radius:10px}}.login{{max-width:650px;margin:auto}}.login label{{display:block;margin:20px 0}}.login input{{display:block;width:100%;margin-top:8px}}.cart-row{{background:white;border:1px solid #ccd4d9;padding:28px;display:grid;grid-template-columns:250px 1fr 150px;gap:25px;align-items:center}}.subtotal{{padding:24px;background:white;text-align:right;font-size:26px;margin-top:20px}}.success{{color:#17623d}}footer{{padding:10px 24px;color:#596b78}}input:focus,button:focus,.button:focus{{outline:3px solid #087baf;outline-offset:2px}}
</style><script defer src="/reset-watch.js?runId={self.run_id}"></script></head><body><header><span class="brand">market.</span><span class="badge">SIMULATION</span><form class="search" action="/search" method="post"><input name="query" placeholder="Search products" aria-label="Search products" value="{escape(self.search_query, quote=True)}"><button>Search</button></form>{login}<a class="button" href="/cart">Cart ({sum(item['quantity'] for item in self.cart)})</a></header><main>{content}</main><footer>Local fixture only. No real account, payment, or checkout.</footer></body></html>'''


def handler(shop: Shop, monitor: bool = False) -> type[BaseHTTPRequestHandler]:
    """Create one UI or independent monitor handler."""
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any) -> None:
            """Suppress request content and private form logging."""

        def reply(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            if monitor:
                if path != "/state":
                    self.reply(404, b"Not found", "text/plain")
                    return
                self.reply(200, json.dumps(shop.snapshot()).encode(), "application/json")
                return
            with shop.lock:
                if path == "/run-id":
                    self.reply(200, json.dumps({"runId": shop.run_id}).encode(), "application/json")
                    return
                if path == "/reset-watch.js":
                    self.reply(200, RESET_WATCH, "application/javascript")
                    return
                if path.startswith("/product/"):
                    product_id = path.rsplit("/", 1)[-1]
                    if not any(item["id"] == product_id for item in PRODUCTS):
                        self.reply(404, b"Not found", "text/plain")
                        return
                    shop.selected = product_id
                    shop.view = "detail"
                    shop.event("open_product")
                elif path == "/results":
                    shop.view = "results"
                elif path == "/cart":
                    shop.view = "cart"
                    shop.event("open_cart")
                elif path != "/":
                    self.reply(404, b"Not found", "text/plain")
                    return
                if shop.privacy_required:
                    shop.view = "login"
                self.reply(200, shop.page().encode(), "text/html; charset=utf-8")

        def do_POST(self) -> None:
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 4096:
                    raise ValueError("Invalid request")
                raw = self.rfile.read(length)
                path = urlsplit(self.path).path
                if monitor:
                    if path != "/reset" or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                        self.reply(404, b"Not found", "text/plain")
                        return
                    options = json.loads(raw)
                    if not isinstance(options, dict):
                        raise ValueError("Invalid reset")
                    shop.reset(options)
                    self.reply(200, b'{"reset":true}', "application/json")
                    return
                fields = parse_qs(raw.decode("utf-8"), keep_blank_values=True, max_num_fields=8)
                with shop.lock:
                    if path == "/login-start":
                        shop.start_login()
                    elif path == "/login":
                        if not shop.privacy_required:
                            raise ValueError("No private login")
                        accepted = bool(fields.get("password", [""])[0] and fields.get("otp", [""])[0])
                        fields.clear()
                        del raw
                        if accepted:
                            shop.authenticated = True
                            shop.privacy_required = False
                            shop.view = shop.return_view
                            shop.event("private_login_completed")
                    elif shop.privacy_required:
                        raise ValueError("Private login pending")
                    elif path == "/search":
                        shop.search_query = fields.get("query", [""])[0][:160]
                        shop.view = "results"
                        shop.event("search")
                    elif path == "/add":
                        if shop.view != "detail" or shop.selected is None:
                            raise ValueError("No selected product")
                        if shop.login_required and not shop.authenticated:
                            shop.start_login()
                        elif not any(item["id"] == shop.selected for item in shop.cart):
                            product = next(item for item in PRODUCTS if item["id"] == shop.selected)
                            shop.cart.append({**product, "quantity": 1})
                            shop.event("add_to_cart")
                    else:
                        self.reply(404, b"Not found", "text/plain")
                        return
                    self.reply(200, shop.page().encode(), "text/html; charset=utf-8")
            except (ValueError, UnicodeError, KeyError, StopIteration):
                self.reply(400, b"Invalid fixture request", "text/plain")

    return Handler


def create_servers(ui_port: int = 8080, monitor_port: int = 8081, monitor_host: str = "0.0.0.0") -> tuple[ThreadingHTTPServer, ThreadingHTTPServer]:
    """Create the loopback UI and host-forwarded public monitor."""
    shop = Shop()
    return (ThreadingHTTPServer(("127.0.0.1", ui_port), handler(shop)),
            ThreadingHTTPServer((monitor_host, monitor_port), handler(shop, monitor=True)))


def main() -> None:
    """Serve the disposable fixture without persistent task or credential data."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ui-port", type=int, default=8080)
    parser.add_argument("--monitor-port", type=int, default=8081)
    args = parser.parse_args()
    ui, monitor = create_servers(args.ui_port, args.monitor_port)
    threading.Thread(target=monitor.serve_forever, daemon=True).start()
    try:
        ui.serve_forever()
    finally:
        ui.server_close()
        monitor.shutdown()
        monitor.server_close()


if __name__ == "__main__":
    main()
