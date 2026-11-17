# 07 — USB/macOS reality check (capture + empirical findings)

Keyboard: "Gaming Keyboard", VID 0416 / PID 7372, USB 2.0 full-speed,
1 configuration.

## USB layout (libusb config descriptor)

| Iface | Class | Sub/Proto | Endpoints | Role |
|---|---|---|---|---|
| 0 | HID | 0/2 (mouse) | ep 0x81 IN (64B) | mouse composite |
| 1 | HID | 1/1 (boot kbd) | ep 0x82 IN (64B) | boot keyboard |
| **2** | **HID** | **0/0** | **ep 0x83 IN + ep 0x04 OUT (64B)** | **vendor/config channel** |

Vendor collection: usage **0xFF1B/0x91**, report ID 1, **63B INPUT +
63B OUTPUT** — this is the config channel. Descriptor:
`06 1b ff 09 91 a1 01 85 01 19 00 2a ff 00 15 00 26 ff 00 75 08 95 3f 81 02 19 00 29 ff 91 02 c0`

## macOS transport findings (all tested)

| Path | Result |
|---|---|
| `IOHIDDeviceOpen` (vendor collection) | ✅ succeeds |
| `IOHIDDeviceSetReport(output)` — 4 frame variants | ❌ `kIOReturnTimeout` — no EP0 SET_REPORT in the firmware |
| `IOHIDDeviceGetReport(input)` | ❌ timeout — no GET_REPORT |
| libusb `claim_interface` | ❌ `LIBUSB_ERROR_ACCESS` |
| IOUSBLib `USBInterfaceOpen` | ❌ `kIOReturnExclusiveAccess` (Apple's HID driver owns it) |
| **WebHID in Chrome/Edge** | ✅ **works** — drives the board from macOS (verified live; Chrome's backend reaches the interrupt pipes) |

The Windows app works because Windows HID = `WriteFile` → interrupt OUT
(ep 0x04). macOS userspace has no equivalent — except WebHID, which is
the supported macOS route (notes/06).

## USB behavior rules (live-verified)

- **Exactly 64-byte reports.** 65 bytes wedges the OUT endpoint until
  replug.
- **Commands are paced** (~100 ms) — the app and CLI both do this.
- **Commits persist across clean power cycles**; the per-key grid is
  RAM (survives VM switches that don't cut USB power, lost on power
  loss). **Unplugging mid-stream factory-resets the device** — never
  pull the cable while the 0x0F stream is running.
