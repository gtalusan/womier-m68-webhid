# 11 — Key bindings / remapping: verified spec (RE'd from the binaries)

## STATUS (2026-11-19) — 0x18 wire-validated (usb7.log)

The Download-button capture (usb7.log, same WinDbg method as usb3–6)
landed with the goal binding set. The upload is now wire-validated.
Corrections to the RE'd framing below, proven by the capture:

- **[2] is a segment id, not a running item count.** Two consecutive
  uploads, [2]=0 then [2]=2, each with its own packet# 0..9. Later
  decode (notes/14): the two segments are the **base layer
  (/appProfile_Default.xml, seg 0) and the FN layer
  (/appProfile_FN.xml, seg 2)** keymaps — the "pristine default"
  reading below was an unedited Fn layer. A dead Magnetic branch
  (seg 1) exists in the binary.
- **The payload is a binary keymap, not XML text.** 132 fixed 4-byte
  entries, row-major 6×22, 14 entries (56 B) per packet, last packet
  6 entries (24 B). [5] = chunk byte count, ≤58 — confirmed.
- **Entry = `00 <keyCode> 00 00`** (uint32 LE = keyCode<<8), keyCode
  = USB HID usage id, 0 = empty slot. One exception: slot 121 (r5c11)
  = `01 00 00 00` — the Fn marker (preserve verbatim when uploading).
- Row 0 (slots 0..21) is all-zero padding; rows 1..5 are the five
  physical rows (68 keys). The matrix coords below are 1-indexed
  columns — arrows Up r4c16 / Left r5c15 / Down r5c16 / Right r5c17
  confirmed on the wire.
- **PgUp = 0x4B = 75**, PrtSc = 0x46 = 70. (The old example's
  "keyCode=74" was a slip — 74 is Home. The XML Value="70" ✓.)
- **The goal binding on the wire:** the two captured uploads differ
  in exactly ONE slot — entry 82 (r3c16): seg0 = 0x46 (PrtSc), seg2
  = 0x4B (PgUp default). A remap = replace the slot's keyCode with
  the target's; the app always uploads the full 132-entry map.
- **After the keymap**, the app uploads two all-zero banks: 0x19
  (10 segments × 256 B) and 0x22 (40 × 50 B = 2000 B). Purpose
  uncharacterized (macro/text/aux data) — all zeros with no bindings.

**Second capture (usb8.log, 2026-11-19) resolves [2]:** with profile 2
active, the user set PgDn→Home + Insert→F12 and re-captured. seg[0]
now carries profile 2's map — and profile 1's PgUp→PrtSc is **gone
from the wire** (slot 82 back to 0x4B). seg[2] is byte-identical to
usb7's seg[2] — later decode shows it is the **FN layer** (an
unedited layer, hence the "pristine" look). So the app's Download
uploads: **the ACTIVE profile's base-layer keymap ([2]=0) + the
active profile's FN-layer keymap ([2]=2)** — never other profiles.
The RE'd "three profile configs" resolves to **three upload wires in
sequence**: 0x18 (keymaps, 2 segs) → 0x19 (macro bank, 10 segs ×
256 B) → 0x22 (DKS store, 40 × 50 B). Same order and sizes in both
captures. Profile 2's edits on the wire: slot 104 (r4c16) 0x4E→0x4A
(PgDn→Home), slot 38 (r1c16) 0x49→0x45 (Insert→F12).

Still open: what 0x19/0x22 carry when non-empty (macros/text — no
multimedia tab found in the UI), and whether the firmware requires
seg[2] + the zero banks or a lone seg[0] suffices (live replays from
the web app will settle the latter).

Still open, unrelated thread: **mode-icon UI swap** (pure frontend —
icons in `web/assets/icons/` + `web/assets/resource-map.json`; see
below).

Implementation — **DONE, both surfaces (2026-11-19):**
- CLI: `keymap show|set|reset|upload`, `profile list|use|current|
  import|export`, media/mouse targets — full Download replay
  live-verified (PgUp→PrtSc works + persists; Insert=Play/Pause
  emits consumer 0x00CD; Insert=ScrollUp/ScrollDown scroll for
  real). notes/12.
- Web app: click-to-remap UI with a key/media/mouse target tray,
  per-profile tabs (keymap + light), export/import (JSON + the
  app's Profile XML), upload/reset-board with progress + locking.
  notes/13.
- ALL operateType entry encodings RE'd from the Download compiler
  (FUN_00471ce0): notes/14.

Five parallel Ghidra passes (2026-11-17) decoded the binding system.
All claims below are verified in M68.exe / witmodSdk.dll disassembly
unless marked inferred.

## The headline truth: bindings are XML, and only XML

**There is no per-key remap wire command in the app's live paths.**

- wire 0x04 "Write Key / Six Key": the app ECHOES a keyboard-originated
  6KRO held-key report (modifier mask + up to six USB HID usage IDs).
  Its only caller is the HID-receive slot; the outgoing payload is
  always zero on every traced path.
- wire 0x05 "Write Full Key": also an echo — the app copies
  `report[6..18]` verbatim from a keyboard-originated report. The
  13-byte (and `[5]=0x15`-declared 21-byte) record is firmware-defined
  and not recoverable from the app.
- wire 0x06 (multimedia) and wire 0x13 (MouseKey): dead code — zero
  callers anywhere in M68.exe (verified three ways).

**The binding model is the profile XML `<keyEvent>` item**, uploaded to
the keyboard with the 0x18 chunked command. The app edits the local
XML on every save; the **Download button on the custom-keys page is
the only trigger** that uploads it.

## The XML item

```xml
<item keyCode="74" keyChar="PrtSc" operateType="0" repeatNum="1" mode="1" Value="70"/>
```

| attribute | meaning |
|---|---|
| keyCode | physical key, keyed by it (decimal) |
| keyChar | display label of the ACTION (UTF-8) |
| operateType | binding type enum (below) |
| repeatNum | macro repeat count; 1 otherwise |
| mode | type-dependent sub-mode; 1 otherwise |
| Value | action payload (target keyCode / macro index / media id / …) |

**operateType enum** (verified per save handler):

| operateType | binding | Value |
|---|---|---|
| 0 | **Remap Key** | target keyCode |
| 1 | Macro | macro index |
| 2 | Key Combination | combo payload |
| 3 | Multimedia | media id 0–15 |
| 4 | Mouse Key | mouse id 0–7 |
| 5 | Disable | "-1" |
| 6 | Text | the text |
| 7 | Assign Profile | profile index |
| 8 | Select App | app path |
| 9 | Shortcuts | shortcut id |
| 0x13 | Key Config (lock/layers/BT…) | function arg |
| 0x14–0x1b | Keyboard Light events | event id |
| 0x1e–0x22 | Side Light events | event id |
| 0x28 | Senior Keys (DKS) | senior-key index |

Media ids: 0 Vol+, 1 Vol−, 2 Mute, 3 Play/Pause, 4 Next, 5 Prev,
6 Stop, 8 Player, 9 Calc, A Computer, B Browser, C Email, D Brt+,
E Brt−, F Search. Mouse ids: 0 Left, 1 Center, 2 Right, 3 ScrollUp,
4 ScrollDown, 5 Forward, 6 Backward, 7 Sniper.

## Keycodes and labels

- The **132-slot keycode matrix** lives in witmodSdk.dll (not M68.exe):
  6×22, row-major, index = row*22+col. For every standard key the
  vendor keyCode **is the USB HID usage ID** (A=0x04 … F12=0x45,
  arrows 0x4F–0x52). Fn = −10 at r5c11. Arrow slots: Up r4c16, Left
  r5c15, Down r5c16, Right r5c17.
- The **112-entry label map** (keyCode → display name: "Q", "[{", "`~",
  "Num Enter"…) is also in witmodSdk.dll.
- No keycode→HID conversion table exists — it's the identity for
  standard keys.

## The upload (wire 0x18)

Verified framing from the app's own Download path
(`DCustomKeysPage` Download button → `sigTheKeyboardIntoDownloading`
→ `DDevicePage` slot 0x1d → `FUN_00471ce0`):

- 64-byte frames: `[0]=1, [1]=0x18 (wire), [2]=segment id,
  [3]=0, [4]=packet#, [5]=chunk byte count (≤58), [6..]=chunk`.
- 14 entries per packet (56 B), `Sleep(400)` between packets, configs
  uploaded in sequence, packet# resets per segment.
- Note: `[2]` is a **segment id** — usb7.log shows two back-to-back
  uploads with [2]=0 and [2]=2, each with packet# 0..9. (The old
  "running item count" reading is dead; see the wire spec at top.)

## What remains unverified

The 0x18 upload is captured firing twice (usb7 + usb8, 2026-11-19) —
see the wire spec at the top of this file. Still open: the contents
of 0x19/0x22 when non-empty (macro/DKS content — the bank builders
FUN_0047c4d0/FUN_0047d380 are not decoded), combo/shortcut/disable/
light-event entries (binary-verified in notes/14, not hardware-
tested), and whether a keymap read-back command exists at all (the
vendor app never reads the keymap — local XML only).

## Implementation path for the web app

1. XML editor: keyEvent items in the page (per-key picker using the
   matrix + label map; target picker with the 112 labels).
2. Upload: the 0x18 chunker with the framing above.
3. Validate: capture the app's Download click → diff frames → done.

## Example goal — PgUp → Print Screen

```xml
<item keyCode="75" keyChar="PrtSc" operateType="0" repeatNum="1" mode="1" Value="70"/>
```

(PgUp = 0x4B = **75**, PrtSc = 0x46 = 70 — wire-verified in usb7.log;
the old "74" was Home.)
