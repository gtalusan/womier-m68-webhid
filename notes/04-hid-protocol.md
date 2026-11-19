# 04 — HID protocol map (Womier M68 HE / X82HE / Nuvoton M484)

Sources: Ghidra 12.2 decompilation of `witmodSdk.dll` + `M68.exe`,
cross-checked against live device responses and WinDbg captures of the
real app (usb3–usb6 logs). Claims are marked ✅ (verified on-device),
🔧 (verified in the binary), or removed entirely when they didn't hold.

## Transport

- **Windows**: SetupAPI + `hid.dll` → `CreateFile` on
  `\\?\hid#vid_0416&pid_7372&mi_xx#…` (or `col06` variant) →
  **`WriteFile` / `ReadFile`**, overlapped. The hot path is interrupt
  OUT/IN, not feature reports.
- **Linux**: hidraw (`/dev/hidrawN`) — raw 64-byte interrupt reports,
  udev rule in `tools/99-m68.rules`.
- **macOS**: userspace IOKit cannot write interrupt OUT while Apple's
  HID driver owns the interface (`IOHIDDeviceSetReport` times out —
  the firmware has no EP0 SET_REPORT). **WebHID in Chrome/Edge works on
  macOS** ✅ (verified live: the web app drives the board from a Mac).
- **Report size**: exactly **64 bytes both directions**. A 65-byte
  interrupt OUT wedges the firmware's OUT endpoint state machine until
  replug — this rule is load-bearing.

## Report frame (64 bytes)

| Offset | Field |
|---|---|
| 0 | **Report ID** = 1 (or 6 on the `col06` collection) |
| 1 | **Command opcode** (wire values below) |
| 2 | flag / sub-command (varies per command) |
| 3–4 | index / count (varies) |
| 5 | parameter (often X coordinate, count, or mode) |
| 6–63 | payload (ASCII or binary) |

App-side cmd (M68.exe `buf[1]`) is remapped by `CWitmodHid_HidWriteBuff`
before sending: app 0x00–0x1B → wire +1 (0x01–0x1C); app 0x1C–0x25 →
wire 0x40–0x49; app 0x26→0x1E, 0x27→0x1F, 0x28→0x20, 0x29→0x21,
0x2A→0x22. The SDK also gates most commands on `buf[5] < 0x3B`
(wire 0x20 is exempt — full-array payloads).

## Command table

### Handshake / info (all device-answered ✅)

| wire | Name | Payload / response |
|---|---|---|
| 0x0D | device info | send `{1,0x0D,0…}` → two responses: CSV `M484,20,KB,FQ,X82HERGB,V1_11_05` at resp[6] (`[5]`=len), then build date `"Mar 26 2024,11:06:05"` |
| 0x15 | serial | hex-ASCII SN at resp[6] |
| 0x0A | light mode list | `[5]`=len(0x13), 15 effect IDs, `a5 5a 04 04` tail |
| 0x02 | side mode list | 4 IDs + `a5 5a 04 04` |
| 0x07 | kbd light config | `[2]=1` → 12-byte register (layout in notes/09) |
| 0x08 | side light config | `[2]=1` → same register shape |
| 0x0E | custom layout support | 22 flag bytes |
| 0x14 | sleep time | `[2]=2` → sleep minutes |
| 0x21 | HE sensitivity | `[5]=0x18`, `[6]=4/9/10` |

### Lighting

| wire | Name | Notes |
|---|---|---|
| 0x07 | light commit | `[5]=0x0E` + mode/brightness/speed/fg/bg/direction/full-color — the full verified layout is notes/09 |
| 0x0F | per-key grid stream | live preview; usb6-verified framing in notes/09 |
| 0x09 | "Write custom-Led" | 🔧 builder found (`FUN_004e8e40`, `[2]=2`, 18-slot chunks); replayed with derived framing — no visible effect, no persistence. Not used by the current app UI |
| 0x18 | "Write Onboard-data" | 🔧+✅ keymap upload: 132 fixed 4-byte entries (`00 <kc> 00 00`, Fn marker `01 00 00 00` at slot 121), 14/packet, `[2]`=segment id (0 = active profile map, 2 = pristine default), `[4]`=packet#, `[5]`=len, Sleep(400) — wire-validated (usb7/usb8, notes/11) + live-verified; all operateType entry encodings RE'd (notes/14) |

### Key remap / macros (unchanged from the app's original use)

| app | wire | Name |
|---|---|---|
| 0x03 | 0x04 | Write Key (single / "Six Key") |
| 0x04 | 0x05 | Write Full Key |
| 0x05 | 0x06 | Write Multimedia |
| 0x12 | 0x13 | write key type 6 |
| 0x18 | 0x19 | Write Macro-data list (10 slots × 256 B; notes/14 — NOT DKS) |
| 0x17 | 0x18 | Write Onboard-data (see above) |
| 0x13 | 0x14 | Reset |

### Responses

64 bytes; logical layout after the report-ID byte: `[0]`=cmd echo,
`[1]`=status/flag, `[2]`=ACK/NACK flag, `[6..]`=payload. Connect: 0x15 →
SN; 0x0D → info CSV + build date. Firmware-chunk ACK: `resp[2]` 0=OK.

## Firmware upgrade (SDK `CWitmodHid_FirmwareUpgrade`, M484 path)

1. Send `{1, 0x0A, 0…}` → device enters bootloader (may re-enumerate).
2. 48-byte chunks → 64-byte reports: `[1]=0x0C, [3..4]=16-bit BE chunk
   index, [5]=len+2, [6..]=~inverted data, [0x30..0x31]=2 random bytes
   (first-chunk flag variant `0xFF,0x00`).
3. Blocking read per chunk; `resp[2]` 0=OK.
4. Final report `{1,0x0C,p5,0xFF,0xFF,0x32,0…}` → flash + reboot.

The JL-chip path (`jl_firmware_upgrade_x86.dll`, `.ufw` images) is a
separate protocol for VID 4A4C devices — not relevant to the M68 HE.

## Resolved former open items

- macOS collection: interface 2 = the vendor config channel (usage
  0xFF1B/0x91, report ID 1, 63B IN + 63B OUT) — and WebHID reaches it
  from Chrome on macOS ✅.
- Light-config payload: fully decoded (notes/09).
- Auto-ripple array config (wire 0x20): builder located
  (`FUN_004e9b40`); payload layout not needed for the configurator.
