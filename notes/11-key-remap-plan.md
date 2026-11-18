# 11 — Key bindings / remapping: verified spec (RE'd from the binaries)

## STATUS (2026-11-18) — where the next session picks up

RE phase COMPLETE (five parallel Ghidra agents + one resource-parser
agent). Everything below the "Implementation path" heading is
binary-verified. Two threads are ready to start:

1. **Key-bindings capture (one step, user-assisted).** Have the user,
   in the Win11 VM, click the app's custom-keys **Download** button
   while capturing WinDbg (usb7.log, same method as usb3–usb6). That
   produces the first-ever real 0x18 upload frames → diff against the
   framing below → then implement the web Remap tab with confidence.
   Without the capture, the framing below is binary-verified but
   never wire-validated for key data (two earlier replays with a
   wrong `[2]` assumption had no effect).
2. **Mode-icon UI swap (pure frontend, no device).** All 338 named
   resources are extracted to `web/assets/icons/` (map in
   `web/assets/resource-map.json`). Every mode has Def/Sel PNG pairs
   under `icons/images/deviceLed/keyboard/` (note: Snake is spelled
   `SnackDef.png` in the vendor's own resources). Swap the page's
   text `.mode` buttons for the app's QToolButton-style icon buttons
   (Def = unchecked, Sel = checked). Also available: checkboxes
   (`publicIco/checkBoxDef/Sel.png`), the full-color toggle, arrows.

Goal binding for the user: **PgUp (0x4B/74) → Print Screen
(0x46/70)** = the XML item below + the 0x18 upload.

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

- 64-byte frames: `[0]=1, [1]=0x18 (wire), [2]=running item count,
  [3]=0, [4]=packet#, [5]=item byte count (≤58), [6..]=chunk`.
- 14 items per packet, `Sleep(400)` between packets, all three profile
  configs uploaded in sequence, packet# resets per `<config>`.
- Note: `[2]` was re-derived from the caller disassembly (the pushes at
  the two call sites carry the item counter and the packet counter);
  a "profile/segment id" reading was considered and rejected.

## What remains unverified (one capture closes it)

The 0x18 upload has never been captured firing (all five WinDbg
captures to date contain only light traffic). One capture of the
app's **Download button click** (usb7.log) gives the exact frames for
a known XML — the final validation for the web implementation.

## Implementation path for the web app

1. XML editor: keyEvent items in the page (per-key picker using the
   matrix + label map; target picker with the 112 labels).
2. Upload: the 0x18 chunker with the framing above.
3. Validate: capture the app's Download click → diff frames → done.

## Example goal — PgUp → Print Screen

```xml
<item keyCode="74" keyChar="PrtSc" operateType="0" repeatNum="1" mode="1" Value="70"/>
```

(PgUp = 0x4B = 74; PrtSc = 0x46 = 70 — both from the label map.)
