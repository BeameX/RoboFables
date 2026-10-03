#!/usr/bin/env python3
"""RoboFables local bridge — serves the UI and a small HTTP API for the USB dongle.

Own RoboFables code. Does not ship a vendor SDK, firmware, or binaries.
USB transmit is allowed for: list ports, dongle ping, discover, module ping, joint position.
LED and wheel motion remain hard-gated (HTTP 403).
"""

from __future__ import annotations

import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from robofables_link.hub import (  # noqa: E402
    DEFAULT_JOINT_ID,
    MODULE_JOINT,
    discover_modules,
    list_serial_ports,
    ping_hub,
    ping_module,
    prefer_joint_target,
    write_joint_set_pos,
)

HOST = "127.0.0.1"
PORT = 8765

_lock = threading.Lock()
_state: dict = {
    "port": None,
    "module_id": DEFAULT_JOINT_ID,
    "module_type": MODULE_JOINT,
}


def _json(handler: SimpleHTTPRequestHandler, code: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: SimpleHTTPRequestHandler) -> dict:
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0:
        return {}
    raw = handler.rfile.read(n)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[robofables-bridge] " + (fmt % args) + "\n")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            with _lock:
                st = dict(_state)
            return _json(
                self,
                200,
                {
                    "ok": True,
                    "service": "RoboFables bridge",
                    "via": "robofables_link.hub",
                    "gates": {"LED": False, "SPIN": False, "USB_TX_JOINT": True},
                    "port": st["port"],
                    "module_id": st["module_id"],
                    "module_type": st["module_type"],
                },
            )
        if path == "/api/ports":
            ports = [
                {
                    "device": p.device,
                    "description": p.description,
                    "likely_hub": p.likely_dongle,
                    "vid": p.vid,
                    "pid": p.pid,
                }
                for p in list_serial_ports()
            ]
            return _json(self, 200, {"ok": True, "ports": ports})
        if path == "/api/status":
            with _lock:
                st = dict(_state)
            return _json(self, 200, {"ok": True, **st})
        return super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        data = _read_json(self)

        if path == "/api/select-port":
            port = str(data.get("port") or "").strip()
            if not port:
                return _json(self, 400, {"ok": False, "error": "port required"})
            with _lock:
                _state["port"] = port
            return _json(self, 200, {"ok": True, "port": port})

        if path == "/api/select-module":
            mid = data.get("module_id", DEFAULT_JOINT_ID)
            try:
                mid = int(mid, 0) if isinstance(mid, str) else int(mid)
            except (TypeError, ValueError):
                return _json(self, 400, {"ok": False, "error": "bad module_id"})
            with _lock:
                _state["module_id"] = mid & 0xFF
                _state["module_type"] = MODULE_JOINT
            return _json(self, 200, {"ok": True, "module_id": _state["module_id"]})

        if path in ("/api/led", "/api/spin", "/api/wheels"):
            return _json(
                self,
                403,
                {
                    "ok": False,
                    "error": "Not enabled — lights and wheels stay off",
                    "gate": path.rsplit("/", 1)[-1].upper(),
                },
            )

        with _lock:
            port = _state["port"]
            module_id = _state["module_id"]

        if path == "/api/ping-hub":
            if not port:
                return _json(self, 400, {"ok": False, "error": "select port first"})
            r = ping_hub(port)
            return _json(
                self,
                200,
                {
                    "ok": r.ok,
                    "tx_hex": r.tx_hex,
                    "rx_hex": r.rx_hex,
                    "message": r.message_en,
                },
            )

        if path == "/api/discover":
            if not port:
                return _json(self, 400, {"ok": False, "error": "select port first"})
            r = discover_modules(port)
            mods = [
                {
                    "type_id": m.type_id,
                    "module_id": m.module_id,
                    "status": m.status,
                    "type_name": m.type_name,
                    "acked": m.acked,
                    "serial": (getattr(m, "serial", None) or "").strip(),
                }
                for m in r.modules
            ]
            module_serial = ""
            if r.modules:
                jid = prefer_joint_target(r.modules)
                with _lock:
                    _state["module_id"] = jid
                    module_id = jid
                for m in r.modules:
                    if m.module_id == module_id and (getattr(m, "serial", None) or "").strip():
                        module_serial = m.serial.strip()
                        break
            return _json(
                self,
                200,
                {
                    "ok": r.ok,
                    "modules": mods,
                    "module_id": module_id,
                    "serial": module_serial,
                    "message": r.message_en,
                    "tx_hex": getattr(r, "tx_hex", ""),
                    "rx_hex": getattr(r, "rx_hex", ""),
                },
            )

        if path == "/api/ping-module":
            if not port:
                return _json(self, 400, {"ok": False, "error": "select port first"})
            mid = data.get("module_id", module_id)
            try:
                mid = int(mid, 0) if isinstance(mid, str) else int(mid)
            except (TypeError, ValueError):
                mid = module_id
            r = ping_module(port, mid & 0xFF, MODULE_JOINT)
            return _json(
                self,
                200,
                {
                    "ok": r.ok,
                    "module_id": mid & 0xFF,
                    "message": r.message_en,
                    "tx_hex": r.tx_hex,
                    "rx_hex": r.rx_hex,
                },
            )

        if path == "/api/joint-set-pos":
            if not port:
                return _json(self, 400, {"ok": False, "error": "select port first"})
            mid = data.get("module_id", module_id)
            try:
                mid = int(mid, 0) if isinstance(mid, str) else int(mid)
            except (TypeError, ValueError):
                mid = module_id
            try:
                deg_x = float(data.get("x", 0))
                deg_y = float(data.get("y", 0))
            except (TypeError, ValueError):
                return _json(self, 400, {"ok": False, "error": "x/y must be numbers"})
            r = write_joint_set_pos(port, mid & 0xFF, deg_x, deg_y)
            return _json(
                self,
                200,
                {
                    "ok": r.ok,
                    "module_id": r.module_id,
                    "x": r.deg_x,
                    "y": r.deg_y,
                    "status_name": r.status_name,
                    "message": r.message_en,
                    "tx_hex": r.tx_hex,
                    "rx_hex": r.rx_hex,
                },
            )

        return _json(self, 404, {"ok": False, "error": f"unknown api {path}"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"RoboFables bridge http://{HOST}:{PORT}/")
    print("Gates: LED=OFF  wheels=OFF  joint and ping=ON")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
