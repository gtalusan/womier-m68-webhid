# 19 — DKS (vendor "Senior Keys") — decoded model + wire format

Status: **binary-decoded, NOT hardware-tested.** Sources: M68.exe
`FUN_0047d380` (the 0x22 store builder), `FUN_00471ce0` (Download
compiler, 0x28 branch), the SeniorKey page handlers, and
witmodSdk.dll's `CWitmodXML_SeniorKey_*` XML functions (record layout,
XML schema, defaults). Live behavior of the hold/release transitions
is the one open question — see "What to test on hardware".

## What the vendor app calls it

"Senior Keys" is an umbrella for three binding types (operateType
0x28 for all of them):

| keyType / mode | UI name | model |
|---|---|---|
| 1 | **DKS** | 4 actions at 4 press-depth trigger points |
| 2 | **MT** | hold-vs-click (mod-tap); 2 actions + hold duration |
| 3 | **TGL** | toggle; 1 action + status |

The DKS UI says: "The key can achieve four functions: 1 to 4
functions can be bound according to four different pressing degrees."
Four action buttons are labeled **A, B, C, D**, laid over a 1–4 mm
travel graph; the stroke editor is "Trigger points for DKS actions".

## The four events (standard DKS order)

Matches the standard DKS model (Wooting/ROG):

| Event | When it fires | Record field | Default |
|---|---|---|---|
| **A** | press past the first (top) point | Value1 | 15 (1.5 mm) |
| **B** | press past the second (bottom) point | Value2 | 36 (3.6 mm) |
| **C** | release back past the second point | Value3 | 36 (3.6 mm) |
| **D** | release back past the first point | Value4 | 15 (1.5 mm) |

Values are **0.1 mm units** (UI display = value/10; the app's slider
max is 0x24 = 36 = 3.6 mm). A/D are the same physical top point and
B/C the same bottom point, hence the symmetric defaults. The stroke
popup we traced (DStrokeConfigView, `FUN_0058c630`) writes
**Value1 and Value4 together** (the top pair). No writer for
Value2/Value3 was found in that path — newly created items keep the
3.6 mm defaults. The per-action K fields are never written by the
app at all; they are zero for items it creates.

## The 416-byte SDK item record

```
+0x000 int  index                     (senior-key id, 1-based)
+0x004 char name[256]                 (XML attribute name=)
+0x104 int  mode                      1=DKS, 2=MT, 3=TGL
+0x108 char keyCode1[16]              action A (DKS) / hold (MT) / action (TGL)
+0x118 char keyCode2[16]              action B / click (MT)
+0x128 char keyCode3[16]              action C
+0x138 char keyCode4[16]              action D
+0x148 int  K1A, K2A, K3A, K4A        per-action A aux values — always 0 here
+0x158 int  K1B..K4B                  per-action B
+0x168 int  K1C..K4C                  per-action C
+0x178 int  K1D..K4D                  per-action D
+0x188 int  Value1                    top press point   (0.1 mm)
+0x18C int  Value2                    bottom press point
+0x190 int  Value3                    bottom release point
+0x194 int  Value4                    top release point
+0x198 int  ValueTime                 MT hold duration in ms (wire = /10)
+0x19C int  status                    TGL
```

XML (file `/SeniorKeyConfig.xml`):

```xml
<Parameters>
  <configDKS name="SeniorKeyDKS" keyType="1">
    <item index="1" name="Key1" keyCode1="26" K1A="0" K2A="0" K3A="0" K4A="0"
          keyCode2="2,26" K1B="0" K2B="0" K3B="0" K4B="0"
          keyCode3="26" K1C="0" K2C="0" K3C="0" K4C="0"
          keyCode4="" K1D="0" K2D="0" K3D="0" K4D="0"
          Value1="15" Value2="36" Value3="36" Value4="15"/>
  </configDKS>
  <configMT ...> <configTGL ...>
  <strokeNum>
    <DKSValue Value1="15" Value2="36" Value3="36" Value4="15"/>
  </strokeNum>
</Parameters>
```

Action strings are parsed at Download time (not at save):
- `"26"` → single key: `00 1A 00 00` on the wire.
- `"2,26"` → combo: first token is the modifier **bitmask**
  (bit0 LCtrl, bit1 LShift, bit2 LAlt, bit3 LWin, bit4 RCtrl,
  bit5 RShift, bit6 RAlt, bit7 RWin), second token is the HID
  usage; parsed by `FUN_0047e4a0`. One mod → `13 <mod> <key> 00`;
  two mods → `13 <mod1> <mod2> <key>`. The parser keeps at most two
  modifier bits.
- `""` → `00 00 00 00` (no key).

## The keymap entry

A key bound to senior key N compiles to the 4-byte keymap entry:

```
17 <storeIdx> 00 00
```

`storeIdx` is **not** the senior-key id — it is a running 0-based
slot in the 0x22 bank, assigned by `++field_7c0` during the Download
compile (`FUN_00471ce0` 0x28 branch → `FUN_0047d380`). The counter
starts at -1 per Download and runs across both keymap segments
(base seg0, Fn seg2), max 40.

## The 0x22 store frame (wire)

One 64-byte report per slot, sent inline while the keymap is
compiled; unassigned slots are zero-filled (mode 0) after both
segments from the current counter up to slot 39.

```
[0]=01  [1]=22 (wire; app cmd 0x2A)  [2]=storeIdx  [3]=0  [4]=0
[5]=0x32 (50-byte payload)  [6..55]=payload  [56..63]=0
```

Payload (50 B):

```
off  len  field
 0    1   mode (1 = DKS)
 1    4   Value1..Value4                 (each clamped to a byte)
 5    4   action A  (keyCode1 encoding)
 9    4   K1A K2A K3A K4A                (zeros)
13    4   action B
17    4   K1B..K4B
21    4   action C
25    4   K1C..K4C
29    4   action D
33    4   K1D..K4D
37   13   0
```

Mode 2 (MT): payload = `02` + action1(4B) + action2(4B) +
`(ValueTime/10)` (one byte) — fields at payload[1..9], rest zero.
Mode 3 (TGL): payload = `03` + action1(4B) only; the record's
`status` field is not copied into the 0x22 frame by this builder.

## Mapping the "W → walk/sprint" goal

| Event | Point | Action | Wire action bytes |
|---|---|---|---|
| A light press | Value1=15 (1.5 mm) | W | `00 1A 00 00` |
| B full press | Value2=36 (3.6 mm) | LShift+W | `13 E1 1A 00` |
| C partial release | Value3=36 | W | `00 1A 00 00` |
| D full release | Value4=15 | (empty = release all) | `00 00 00 00` |

Physical W is slot **46** (row 2, col 2; HID 0x1A). Its keymap entry
becomes `17 00 00 00` for store slot 0:

```
full 0x22 frame, slot 0 (64 bytes):
off  bytes
00   01 22 00 00 00 32 01 0F 24 24 0F 00 1A 00 00 00
10   00 00 00 13 E1 1A 00 00 00 00 00 00 1A 00 00 00
20   00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
30   00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

This is the canonical DKS example (Wooting's own DKS doc uses exactly
light-press W / bottom-out Shift+W). It is a sensible goal.

## What to test on hardware (the only real unknowns)

The app never sets the K fields, and its UI exposes only the top
stroke pair, so the firmware's transition policy is not visible in
M68.exe. Test with a real DKS slot:

1. **Is A held?** Light press W and keep holding: does the OS see W
   held (auto-repeat), or a single tap?
2. **A→B transition:** does the firmware release A's W and re-press
   Shift+W, or add Shift while keeping W down? Either is usable;
   only the former can hiccup repeat.
3. **B→C:** does partial release release Shift and leave W held (or
   re-press it)?
4. **D:** with D empty, does full release release everything? (The
   standard model says D clears every hold.)
5. **K fields:** send zeros (as the app does) and confirm they are
   ignored.
6. **Order:** our uploader sends the 0x22 slots after the keymap
   segments; the app interleaves them. Confirm the firmware commits
   DKS slots written after the keymap.

Until 1–6 are confirmed, treat wire/format as verified and behavior
as expected-but-unproven.

## Recon artifacts (for the next agent)

- **Store builder:** `ghidra-out/FUN_0047d380_47d380.c` — the whole
  0x22 frame layout above, including the K-field interleave and the
  mode 2/3 branches.
- **Download compiler / 0x28 branch:** `ghidra-out/FUN_00471ce0_471ce0.c`
  — the 0x28 entry (`17 storeIdx 00 00`) around lines 871–886, the
  senior-key item load around lines 357–430, and the zero-fill of the
  remaining DKS slots around lines 1226–1264.
- **SDK XML/record:** `ghidra-out/dks/CWitmodXML_SeniorKey_*.c`
  (`SelectAllInfoItem`, `AddInfoItem`, `GetDKSStrokeStuInfo`,
  `ModifyDKSStrokeStuInfo`); tag-name bytes in
  `ghidra-out/dks/tags_3f3e0.txt` and `tags_ee90.txt`.
- **Vendor UI:** `FUN_0057d450` (Senior Keys retranslate; A–D
  buttons, 1–4 mm graph labels), `FUN_0058bc90` + `FUN_0058c630`
  (`DStrokeConfigView`; edits Value1+Value4), `FUN_0058a790`
  (explain dialog), `FUN_00573d40`/`FUN_005752a0`/`FUN_00577ec0`
  (action-slot bind/clear/combo handlers).
- **K-field proof:** `tools/FindDisp.java` — scans memory-operand
  displacements; only `FUN_0058c630` touches the item record's
  Value1/Value4, nothing writes K1A..K4D.
- **Ghidra project:** `ghidra-work/m68.rep`, headless project name
  `m68` (see memory `m68-ghidra-workflow`).
- **State:** binary-verified 2026-11-21. NOT hardware-tested — the
  keyboard was not attached during this pass. No vendor DKS capture
  exists yet.

## Implementation handoff (not started)

- `packages/protocol/src/keymap.js` builds 132 × 4-byte entries;
  add a DKS entry builder (`17 <storeIdx> 00 00`) alongside
  `applyRemaps`. W's stock slot is **46**.
- `packages/protocol/src/session.js` `uploadKeymap()` currently sends
  the 0x22 bank as 40 zero slots (lines ~266–268). Replace that loop
  with built DKS payloads + zero fill to 40. The 0x22 wire constant
  is `CMD.KEYMAP_AUX` (`commands.js`).
- Suggested shape: `dksSlot({ actions: [A,B,C,D], strokes: [v1..v4] })`
  → 50-byte payload; action = `{key}` / `{mods:[bits], key}` / null.
  Encode single key `00 key 00 00`; one mod `13 (E0+bit) key 00`;
  two mods `13 (E0+b1) (E0+b2) key`; null = four zeros.
- The web app has its own copy of the keymap/upload logic in
  `web/index.html` (~line 723 onwards); mirror the change there when
  adding UI.

## Live-test checklist (next session)

1. Attach the board; on macOS use Chrome/Edge WebHID (notes/07).
2. Upload: seg0 keymap with slot 46 = `17 00 00 00`, seg2 stock,
   0x19 zeros, 0x22 slot 0 = the 64-byte frame above, slots 1–39
   zero-filled (mode 0).
3. Watch the input reports (`tools/hid_probe.py` or a WebHID probe
   page):
   - tap light → W down/up; hold light → W stays down (OS repeat);
   - press through → Shift+W (check whether W is released/re-pressed);
   - release halfway → back to W; release fully → everything up.
4. If nothing fires: re-send the slot *interleaved* with the keymap
   packets (vendor order), then try non-zero K bytes, then a
   different store index, and confirm the entry really is `17 idx`.
5. Definitive fallback: capture the vendor app's 0x22 frame for a
   real DKS binding with the WinDbg method (notes/18). That one
   capture settles the K fields, the frame order, and whether the app
   ever sends anything beyond this layout.
