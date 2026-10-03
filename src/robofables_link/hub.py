"""USB serial helpers for the classroom dongle and a joint module.

The HTTP bridge uses these helpers to list ports, ping the dongle, discover
modules on the same colour channel, and move a joint. LED and wheel motion
are not sent from here; the bridge refuses those routes.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import serial
from serial.tools import list_ports

DONGLE_VID = 0x03EB
DONGLE_PID = 0xFABE
BAUD = 500_000
PING = bytes([0xFF])
ACK = ord("A")
HASH = ord("#")
RADIO_HDR = 0xFE
DISCOVER_CMD_EF = 0xEF
PACKET_DELAYED_PING = 0xEE
PACKET_PING = 0xFF
PACKET_SYNC = 0xFC
MODULE_JOINT = 3
MODULE_SPIN = 4
DEFAULT_JOINT_ID = 0xA2
JOINT_POS_X_ADR = (62, 63)
JOINT_POS_Y_ADR = (84, 85)
JOINT_DEG_SCALE = 3.41333333
BROADCAST = 0xFF
DISCOVER_DELAY_MS = 25

MODULE_TYPE_NAMES = {
    255: "Any",
    0: "Development",
    1: "Dongle",
    2: "Head",
    3: "Joint",
    4: "Spin",
    5: "Face",
    6: "Branch4Way",
    7: "Foot1Way",
}


@dataclass
class PortInfo:
    device: str
    description: str
    hwid: str
    vid: int | None
    pid: int | None
    likely_dongle: bool


def list_serial_ports() -> list[PortInfo]:
    out: list[PortInfo] = []
    for p in list_ports.comports():
        desc = p.description or ""
        hwid = p.hwid or ""
        vid = p.vid
        pid = p.pid
        likely = False
        if vid == DONGLE_VID and pid == DONGLE_PID:
            likely = True
        elif "VID_03EB" in hwid.upper() and "PID_FABE" in hwid.upper():
            likely = True
        elif desc.lower().startswith("fable"):
            # OS name some hosts give this dongle when VID/PID are missing.
            likely = True
        out.append(
            PortInfo(
                device=p.device,
                description=desc,
                hwid=hwid,
                vid=vid,
                pid=pid,
                likely_dongle=likely,
            )
        )
    return out


def open_hub(port: str, timeout: float = 0.05) -> serial.Serial:
    return serial.Serial(
        port=port,
        baudrate=BAUD,
        bytesize=serial.EIGHTBITS,
        parity=serial.PARITY_NONE,
        stopbits=serial.STOPBITS_ONE,
        timeout=timeout,
        write_timeout=1.0,
    )


@dataclass
class PingResult:
    ok: bool
    tx_hex: str
    rx_hex: str
    message_en: str


def ping_hub(port: str) -> PingResult:
    """PC to dongle over USB only. Does not prove radio to a robot module."""
    tx_hex = PING.hex(" ")
    try:
        with open_hub(port) as ser:
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            ser.write(PING)
            ser.flush()
            deadline = time.monotonic() + 0.4
            buf = bytearray()
            while time.monotonic() < deadline:
                chunk = ser.read(64)
                if chunk:
                    buf.extend(chunk)
                    if ACK in buf:
                        break
                else:
                    time.sleep(0.01)
            rx_hex = buf.hex(" ") if buf else "(empty)"
            if ACK in buf:
                return PingResult(
                    True,
                    tx_hex,
                    rx_hex,
                    "USB link to the dongle is OK. This does not prove the robot can hear it.",
                )
            if not buf:
                return PingResult(
                    False,
                    tx_hex,
                    rx_hex,
                    "Timeout — no bytes. Check the USB cable.",
                )
            return PingResult(
                False,
                tx_hex,
                rx_hex,
                f"Response without ACK (first byte 0x{buf[0]:02X}).",
            )
    except serial.SerialException as e:
        return PingResult(False, tx_hex, "(error)", f"Serial error: {e}")
    except PermissionError as e:
        return PingResult(False, tx_hex, "(error)", f"Permission denied: {e}")


@dataclass
class ModuleHit:
    type_id: int
    module_id: int
    status: int = ord("A")
    serial: str = ""

    @property
    def type_name(self) -> str:
        return MODULE_TYPE_NAMES.get(self.type_id, f"type{self.type_id}")

    @property
    def status_name(self) -> str:
        known = {ord("A"): "ACK", ord("N"): "NACK", ord("S"): "STOP_ACK"}
        return known.get(self.status, f"0x{self.status:02X}")

    @property
    def acked(self) -> bool:
        return self.status == ord("A")


@dataclass
class DiscoverResult:
    ok: bool
    modules: list[ModuleHit] = field(default_factory=list)
    tx_hex: str = ""
    rx_hex: str = ""
    message_en: str = ""


def _write_radio(ser: serial.Serial, payload: list[int]) -> None:
    """Frame a radio payload: header, length, bytes. One status byte may follow."""
    if len(payload) > 255:
        raise ValueError("payload too long")
    frame = bytes([RADIO_HDR, len(payload), *payload])
    ser.write(frame)
    ser.flush()
    _ = ser.read(1)


def _parse_module_frames(buf: bytes) -> list[ModuleHit]:
    """Parse short module replies and longer discover replies from the dongle."""
    hits: list[ModuleHit] = []
    i = 0
    while i < len(buf):
        if buf[i] == HASH and i + 5 <= len(buf) and buf[i + 1] == 3:
            hits.append(
                ModuleHit(type_id=buf[i + 2], module_id=buf[i + 3], status=buf[i + 4])
            )
            i += 5
            continue
        if buf[i] == HASH and i + 10 <= len(buf) and buf[i + 1] == 8:
            status = buf[i + 4]
            serial = "".join(
                chr(b) if 32 <= b < 127 else "?" for b in buf[i + 6 : i + 10]
            )
            hits.append(
                ModuleHit(
                    type_id=buf[i + 2],
                    module_id=buf[i + 3],
                    status=status,
                    serial=serial,
                )
            )
            i += 10
            continue
        i += 1
    best: dict[tuple[int, int], ModuleHit] = {}
    for h in hits:
        key = (h.type_id, h.module_id)
        prev = best.get(key)
        if prev is None:
            best[key] = h
        else:
            keep = h if (h.acked and not prev.acked) else prev
            if h.serial and not keep.serial:
                keep = ModuleHit(keep.type_id, keep.module_id, keep.status, h.serial)
            elif prev.serial and h.acked and not prev.acked:
                keep = ModuleHit(h.type_id, h.module_id, h.status, prev.serial)
            best[key] = keep
    return list(best.values())


def discover_modules(port: str, listen_s: float = 1.2) -> DiscoverResult:
    """Ask modules on this colour channel to answer."""
    attempts = [
        [BROADCAST, BROADCAST, PACKET_DELAYED_PING, DISCOVER_DELAY_MS],
        [BROADCAST, BROADCAST, DISCOVER_CMD_EF],
    ]
    all_tx: list[str] = []
    all_rx = bytearray()
    try:
        with open_hub(port, timeout=0.05) as ser:
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            for payload in attempts:
                frame = bytes([RADIO_HDR, len(payload), *payload])
                all_tx.append(frame.hex(" "))
                _write_radio(ser, payload)
                per = listen_s / max(len(attempts), 1)
                deadline = time.monotonic() + per
                while time.monotonic() < deadline:
                    chunk = ser.read(64)
                    if chunk:
                        all_rx.extend(chunk)
                    else:
                        time.sleep(0.02)
            tx_hex = " | ".join(all_tx)
            rx_hex = all_rx.hex(" ") if all_rx else "(empty)"
            modules = _parse_module_frames(bytes(all_rx))
            if modules:
                lines = ", ".join(
                    f"{m.type_name} id=0x{m.module_id:02X} ({m.status_name})"
                    + (f" serial={m.serial!r}" if m.serial else "")
                    for m in modules
                )
                all_ack = all(m.acked for m in modules)
                if all_ack:
                    en = f"Radio OK — module seen: {lines}."
                else:
                    en = (
                        f"Radio: module replied: {lines}. "
                        "The reply was not a clear OK. "
                        "Match the colour, turn the module on, and check the type."
                    )
                return DiscoverResult(True, modules, tx_hex, rx_hex, en)
            return DiscoverResult(
                False,
                [],
                tx_hex,
                rx_hex,
                "Radio: no module answered. Match dongle and module colour, turn it on, stay in range.",
            )
    except serial.SerialException as e:
        return DiscoverResult(
            False, [], " | ".join(all_tx) if all_tx else "", "(error)", f"Serial error: {e}"
        )
    except PermissionError as e:
        return DiscoverResult(
            False, [], " | ".join(all_tx) if all_tx else "", "(error)", f"Permission denied: {e}"
        )


@dataclass
class TargetPingResult:
    ok: bool
    modules: list[ModuleHit] = field(default_factory=list)
    tx_hex: str = ""
    rx_hex: str = ""
    message_en: str = ""


def ping_module(
    port: str,
    module_id: int = DEFAULT_JOINT_ID,
    module_type: int = MODULE_JOINT,
    listen_s: float = 1.0,
) -> TargetPingResult:
    """Directed radio ping. Success means the module answers with ACK."""
    attempts = [
        [module_type, module_id, PACKET_PING],
        [BROADCAST, module_id, PACKET_PING],
    ]
    uniq: list[list[int]] = []
    seen: set[tuple[int, int, int]] = set()
    for p in attempts:
        key = tuple(p)
        if key not in seen:
            seen.add(key)
            uniq.append(p)

    all_tx: list[str] = []
    all_rx = bytearray()
    hits: list[ModuleHit] = []
    try:
        with open_hub(port, timeout=0.05) as ser:
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            for payload in uniq:
                frame = bytes([RADIO_HDR, len(payload), *payload])
                all_tx.append(frame.hex(" "))
                _write_radio(ser, payload)
                deadline = time.monotonic() + listen_s / max(len(uniq), 1)
                while time.monotonic() < deadline:
                    chunk = ser.read(64)
                    if chunk:
                        all_rx.extend(chunk)
                    else:
                        time.sleep(0.02)
            hits = [
                h
                for h in _parse_module_frames(bytes(all_rx))
                if h.module_id == module_id
            ]
            typed = [h for h in hits if h.type_id == module_type]
            if typed:
                hits = typed
            tx_hex = " | ".join(all_tx)
            rx_hex = all_rx.hex(" ") if all_rx else "(empty)"
            type_name = MODULE_TYPE_NAMES.get(module_type, f"type{module_type}")
            if any(h.acked for h in hits):
                lines = ", ".join(
                    f"{h.type_name} id=0x{h.module_id:02X} ({h.status_name})" for h in hits
                )
                return TargetPingResult(
                    True,
                    hits,
                    tx_hex,
                    rx_hex,
                    f"Module ping OK — {type_name} 0x{module_id:02X} answered. ({lines})",
                )
            if hits:
                lines = ", ".join(
                    f"{h.type_name} id=0x{h.module_id:02X} ({h.status_name})" for h in hits
                )
                return TargetPingResult(
                    False,
                    hits,
                    tx_hex,
                    rx_hex,
                    f"Module ping: {type_name} 0x{module_id:02X} replied without a clear OK ({lines}).",
                )
            return TargetPingResult(
                False,
                [],
                tx_hex,
                rx_hex,
                f"Module ping failed — no answer from id 0x{module_id:02X}.",
            )
    except serial.SerialException as e:
        return TargetPingResult(False, [], "", "(error)", f"Serial error: {e}")
    except PermissionError as e:
        return TargetPingResult(False, [], "", "(error)", f"Permission denied: {e}")


def prefer_joint_target(modules: list[ModuleHit], fallback_id: int = DEFAULT_JOINT_ID) -> int:
    """Joint id to drive: first joint seen, otherwise the usual classroom default."""
    for m in modules:
        if m.type_id == MODULE_JOINT:
            return m.module_id & 0xFF
    return fallback_id & 0xFF


def crop_joint_deg(deg: float) -> float:
    """Keep a joint angle inside -90..90 degrees."""
    if deg < -90:
        return -90.0
    if deg > 90:
        return 90.0
    return float(deg)


def deg_to_joint_raw(deg: float) -> int:
    return int(round(JOINT_DEG_SCALE * crop_joint_deg(deg) + 512, 0))


def encode_joint_pos(deg_x: float, deg_y: float) -> bytes:
    """Write slots for joint X then Y."""
    raw_x = deg_to_joint_raw(deg_x)
    raw_y = deg_to_joint_raw(deg_y)
    ax0, ax1 = JOINT_POS_X_ADR
    ay0, ay1 = JOINT_POS_Y_ADR
    return bytes(
        [
            ax0,
            raw_x & 0xFF,
            ax1,
            (raw_x >> 8) & 0xFF,
            ay0,
            raw_y & 0xFF,
            ay1,
            (raw_y >> 8) & 0xFF,
        ]
    )


def build_joint_set_pos_frame(module_id: int, deg_x: float, deg_y: float) -> bytes:
    payload = [MODULE_JOINT, module_id & 0xFF, PACKET_SYNC, *encode_joint_pos(deg_x, deg_y)]
    return bytes([RADIO_HDR, len(payload), *payload])


@dataclass
class JointSetPosResult:
    ok: bool
    tx_hex: str = ""
    rx_hex: str = ""
    hub_ack_hex: str = ""
    module_id: int = 0
    deg_x: float = 0.0
    deg_y: float = 0.0
    status: int | None = None
    status_name: str = ""
    message_en: str = ""


def _joint_status_name(status: int | None) -> str:
    if status is None:
        return "(none)"
    known = {
        ord("A"): "ACK",
        ord("N"): "NACK",
        ord("S"): "STOP_ACK",
        0: "BOOT",
        1: "READY",
        2: "LOAD_ERROR",
        5: "RUNNING",
        6: "LOCKED",
    }
    return known.get(status, f"0x{status:02X}")


def write_joint_set_pos(
    port: str,
    module_id: int,
    deg_x: float,
    deg_y: float,
    listen_s: float = 0.8,
) -> JointSetPosResult:
    """Move one joint module. Does not send LED or wheel commands."""
    module_id = module_id & 0xFF
    frame = build_joint_set_pos_frame(module_id, deg_x, deg_y)
    tx_hex = frame.hex(" ")
    try:
        with open_hub(port, timeout=0.05) as ser:
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            ser.write(frame)
            ser.flush()
            hub_ack = ser.read(1)
            all_rx = bytearray(hub_ack)
            deadline = time.monotonic() + listen_s
            while time.monotonic() < deadline:
                chunk = ser.read(64)
                if chunk:
                    all_rx.extend(chunk)
                else:
                    time.sleep(0.02)
            rx_hex = all_rx.hex(" ") if all_rx else "(empty)"
            hub_ack_hex = hub_ack.hex(" ") if hub_ack else "(empty)"
            hits = _parse_module_frames(bytes(all_rx))
            joint_hits = [
                h
                for h in hits
                if h.module_id == module_id
                and (h.type_id == MODULE_JOINT or h.type_id == BROADCAST)
            ]
            if not joint_hits:
                joint_hits = [h for h in hits if h.module_id == module_id]
            if joint_hits:
                h = joint_hits[0]
                typed = [x for x in joint_hits if x.type_id == MODULE_JOINT]
                if typed:
                    h = typed[0]
                st = h.status
                sn = _joint_status_name(st)
                return JointSetPosResult(
                    True,
                    tx_hex,
                    rx_hex,
                    hub_ack_hex,
                    module_id,
                    deg_x,
                    deg_y,
                    st,
                    sn,
                    f"Joint moved — id=0x{module_id:02X} deg=({deg_x},{deg_y}) status={sn}.",
                )
            for i in range(len(all_rx) - 4):
                if (
                    all_rx[i] == HASH
                    and all_rx[i + 1] == 3
                    and all_rx[i + 2] == MODULE_JOINT
                    and all_rx[i + 3] == module_id
                ):
                    st = all_rx[i + 4]
                    sn = _joint_status_name(st)
                    return JointSetPosResult(
                        True,
                        tx_hex,
                        rx_hex,
                        hub_ack_hex,
                        module_id,
                        deg_x,
                        deg_y,
                        st,
                        sn,
                        f"Joint moved — id=0x{module_id:02X} deg=({deg_x},{deg_y}) status={sn}.",
                    )
            return JointSetPosResult(
                False,
                tx_hex,
                rx_hex,
                hub_ack_hex,
                module_id,
                deg_x,
                deg_y,
                None,
                "(none)",
                f"Joint did not answer — id=0x{module_id:02X}.",
            )
    except serial.SerialException as e:
        return JointSetPosResult(
            False, tx_hex, "(error)", "", module_id, deg_x, deg_y, None, "", f"Serial error: {e}"
        )
    except PermissionError as e:
        return JointSetPosResult(
            False, tx_hex, "(error)", "", module_id, deg_x, deg_y, None, "", f"Permission denied: {e}"
        )
