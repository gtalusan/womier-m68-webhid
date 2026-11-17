#!/usr/bin/env python3
"""Linux hidraw probe for the Womier M68 HE (0416:7372).

Finds the vendor interface's /dev/hidraw node, sends the 0x0D handshake
and the 0x15 SN query (interrupt OUT via hidraw write), reads responses
(interrupt IN via hidraw read), prints hex + ascii.

No dependencies — pure Python 3 on Linux. Run as root, or grant the
udev rule (tools/99-m68.rules) for unprivileged access.
"""
import os
import select
import sys
import time

VID = 0x0416
PID = 0x7372
# kernel HID_ID format: bus(4):vendor(8):product(8), e.g. 0003:00000416:00007372
TARGET_HID_ID = f"0003:{VID:08X}:{PID:08X}"


def find_hidraw():
    """Scan /sys/class/hidraw for a node whose parent device is our
    vendor interface (the one with both IN and OUT reports)."""
    candidates = []
    for name in sorted(os.listdir("/sys/class/hidraw")):
        if not name.startswith("hidraw"):
            continue
        uevent_path = f"/sys/class/hidraw/{name}/device/uevent"
        try:
            uevent = open(uevent_path).read()
        except OSError:
            continue
        if f"HID_ID={TARGET_HID_ID}" in uevent:
            candidates.append((name, uevent))
    if not candidates:
        return None
    # The vendor/config collection is interface 2 (HID_PHYS .../input2).
    # (Interface 1's descriptor also has an Output item — the 1-byte LED
    # report — so match the interface number, not just the 0x91 byte.)
    for name, uevent in candidates:
        phys = [l for l in uevent.splitlines() if l.startswith("HID_PHYS=")]
        phys = phys[0].split("=", 1)[1] if phys else ""
        print(f"  candidate {name}: {phys}")
        if phys.endswith("/input2"):
            return f"/dev/{name}"
    # fallback: first candidate
    return f"/dev/{candidates[0][0]}"


def read_report(fd, timeout=2.0):
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            data = os.read(fd, 64)
            return data
    return None


def main():
    path = find_hidraw()
    if path is None:
        print("!! no hidraw node for 0416:7372 (device attached to VM?)")
        sys.exit(1)
    print(f"hidraw node: {path}")
    fd = os.open(path, os.O_RDWR | os.O_NONBLOCK)

    # --- handshake: wire cmd 0x0D (device info) ---
    frame = bytes([0x01, 0x0D]) + bytes(62)
    n = os.write(fd, frame)
    print(f"write 64B [01 0d 00..] -> {n} bytes")
    time.sleep(0.3)
    resp = read_report(fd)
    if resp:
        print(f"resp {len(resp)}B hex: {resp.hex()}")
        print(f"resp ascii:      {bytes(b if 32 <= b < 127 else 46 for b in resp).decode()}")
        if resp[1] == 0x0D:
            payload = resp[6:].split(b"\x00")[0]
            print(f"device info CSV: {payload.decode(errors='replace')}")
    else:
        print("no response to handshake")

    # --- SN query: wire cmd 0x15 ---
    frame = bytes([0x01, 0x15]) + bytes(62)
    os.write(fd, frame)
    print("write 64B [01 15 00..] (SN query)")
    time.sleep(0.3)
    resp = read_report(fd)
    if resp:
        print(f"resp {len(resp)}B hex: {resp.hex()}")
        print(f"resp ascii:      {bytes(b if 32 <= b < 127 else 46 for b in resp).decode()}")
    else:
        print("no response to SN query")

    os.close(fd)


if __name__ == "__main__":
    main()
