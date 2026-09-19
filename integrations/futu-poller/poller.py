#!/usr/bin/env python3
"""Futu holdings poller: a Service Plugin instance for Open DeskOS.

Reads real positions from the pre-existing FutuOpenD gateway over the LAN and
publishes bounded snapshots to the DeskOS shell over a Unix socket (protocol v1,
see runtime/linux/docs/adr/0009-service-plugin-contract.md).

Secrets arrive only from the environment (later: the system vault). They are
never printed, logged, or placed in the package.

  FUTU_HOST          gateway address (default 10.10.0.195)
  FUTU_PORT          gateway API port (default 11111)
  FUTU_RSA_FILE      client copy of the gateway RSA private key
  FUTU_TRADE_PWD     trade unlock password (positions require unlock)
  FUTU_INTERVAL      poll interval seconds (default 60)
  ODESK_SOCKET       shell socket path
  SERVICE_ID         service identity (default futu-poller)
  SERVICE_REVISION   package revision (default dev)
"""

import json
import os
import socket
import sys
import time
import traceback

PROTO_VERSION = 1
MAX_POSITIONS = 64


def frame(record):
    return (json.dumps(record) + "\n").encode("utf-8")


class ShellLink:
    def __init__(self, sock_path, service, revision):
        self.sock_path = sock_path
        self.service = service
        self.revision = revision
        self.conn = None

    def ensure(self):
        if self.conn is not None:
            return True
        try:
            conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.settimeout(10)
            conn.connect(self.sock_path)
            conn.sendall(frame({
                "v": 1, "type": "hello", "service": self.service,
                "revision": self.revision, "proto": PROTO_VERSION,
            }))
            self.conn = conn
            return True
        except OSError:
            self.conn = None
            return False

    def send(self, record):
        try:
            if not self.ensure():
                return False
            self.conn.sendall(frame(record))
            return True
        except OSError:
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None
            return False

    def close(self):
        try:
            if self.conn is not None:
                self.conn.close()
        except Exception:
            pass
        self.conn = None


def snapshot_from_frames(position_frames, fund_frames):
    positions = []
    seen = set()
    for entry in position_frames:
        code = str(entry.get("code", ""))
        if not code or code in seen:
            continue
        seen.add(code)
        positions.append({
            "code": code,
            "name": str(entry.get("stock_name", "")),
            "market": str(entry.get("market", "")),
            "qty": float(entry.get("qty", 0) or 0),
            "cost": float(entry.get("cost_price", 0) or 0),
            "price": float(entry.get("nominal_price", 0) or 0),
            "marketVal": float(entry.get("market_val", 0) or 0),
            "plVal": float(entry.get("pl_val", 0) or 0),
            "plRatio": float(entry.get("pl_ratio", 0) or 0),
            "dayPlVal": float(entry.get("today_pl_val", 0) or 0),
            "currency": str(entry.get("currency", "") or "").upper(),
        })
    positions.sort(key=lambda p: abs(p["marketVal"]), reverse=True)
    positions = positions[:MAX_POSITIONS]
    for p in positions:
        base = p["marketVal"] - p["dayPlVal"]
        p["dayRatio"] = (p["dayPlVal"] / base) if base else 0.0
    # Today ratio: the day's profit over yesterday's base. It freezes at close,
    # so a closed market honestly reports the finished session.
    day_pl = sum(p["dayPlVal"] for p in positions)
    day_base = sum(p["marketVal"] - p["dayPlVal"] for p in positions)
    day_by_ccy = {}
    for p in positions:
        day_by_ccy[p["currency"] or "?"] = day_by_ccy.get(p["currency"] or "?", 0.0) + p["dayPlVal"]
    totals = {
        "marketVal": sum(p["marketVal"] for p in positions),
        "plVal": sum(p["plVal"] for p in positions),
        "cash": sum(float(f.get("cash", 0) or 0) for f in fund_frames),
        "dayPlVal": day_pl,
        "dayByCcy": day_by_ccy,
        "plRatio": (day_pl / day_base) if day_base else 0.0,
    }
    return {"positions": positions, "totals": totals}


def poll_once(trade_contexts):
    position_frames, fund_frames = [], []
    for ctx in trade_contexts:
        ret, data = ctx.position_list_query()
        if ret != 0:
            raise RuntimeError("position_list_query failed: %s" % data)
        position_frames.extend(data.to_dict(orient="records"))
        ret, funds = ctx.accinfo_query()
        if ret != 0:
            raise RuntimeError("accinfo_query failed: %s" % funds)
        fund_frames.extend(funds.to_dict(orient="records"))
    return snapshot_from_frames(position_frames, fund_frames)


def main():
    host = os.environ.get("FUTU_HOST", "10.10.0.195")
    port = int(os.environ.get("FUTU_PORT", "11111"))
    rsa_file = os.environ.get("FUTU_RSA_FILE", "")
    trade_pwd = os.environ.get("FUTU_TRADE_PWD", "")
    interval = int(os.environ.get("FUTU_INTERVAL", "60"))
    sock_path = os.environ.get("ODESK_SOCKET", "")
    service = os.environ.get("SERVICE_ID", "futu-poller")
    revision = os.environ.get("SERVICE_REVISION", "dev")

    link = ShellLink(sock_path, service, revision) if sock_path else None
    contexts = []

    def report(record):
        record.update({"v": 1, "service": service})
        if link is not None:
            link.send(record)
        else:
            sys.stdout.write(json.dumps(record) + "\n")
            sys.stdout.flush()

    if not trade_pwd:
        try:
            while True:
                report({"type": "auth-required",
                        "secrets": ["futu-trade-password"]})
                time.sleep(interval)
        except KeyboardInterrupt:
            pass
        finally:
            if link is not None:
                link.close()
        return

    from futu import (OpenSecTradeContext, RET_OK, SecurityFirm,
                      SysConfig, TrdMarket)

    if rsa_file:
        SysConfig.enable_proto_encrypt(True)
        SysConfig.set_init_rsa_file(rsa_file)

    def open_contexts():
        for market in (TrdMarket.HK, TrdMarket.US):
            ctx = OpenSecTradeContext(filter_trdmarket=market, host=host,
                                      port=port, security_firm=SecurityFirm.FUTUSECURITIES)
            contexts.append(ctx)

    try:
        open_contexts()
        while True:
            try:
                for ctx in contexts:
                    ret, _ = ctx.unlock_trade(trade_pwd)
                    if ret != RET_OK:
                        raise RuntimeError("unlock_trade rejected")
                snapshot = poll_once(contexts)
                snapshot["updatedAt"] = int(time.time() * 1000)
                report({"type": "data", "snapshot": snapshot})
            except Exception as exc:  # noqa: BLE001 - poller must never die
                report({"type": "error", "code": "poll-failed",
                        "message": "%s: %s" % (type(exc).__name__, exc)})
            time.sleep(interval)
    except KeyboardInterrupt:
        pass
    finally:
        for ctx in contexts:
            try:
                ctx.close()
            except Exception:
                pass
        if link is not None:
            link.close()


if __name__ == "__main__":
    main()
