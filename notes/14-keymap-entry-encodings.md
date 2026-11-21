# 14 — Keymap entry encodings (all operateTypes) — binary-verified

RE'd from M68.exe `FUN_00471ce0` — the Download path that
compiles the profile XML into the 132-slot keymap AND sends the 0x18
upload (same function; the 14-items-per-packet flush and Sleep(400)
are visible in the decomp, matching the keymap captures byte-for-byte).

## The entry format

Every keymap entry is 4 bytes: `[0] = type marker, [1..3] = payload`.
The compiler iterates ALL 132 slots: empty slot (keyCode 0) →
`00 00 00 00`; unbound key → `00 <keyCode> 00 00` (keyCode clamped to
≤ 0xFF); bound key → the table below. (This is why the upload is
always exactly 528 bytes.)

## The table (each case = one operateType branch in the compiler)

| operateType | entry | notes |
|---|---|---|
| *(no binding)* | `00 <keyCode> 00 00` | stock/identity |
| *Fn (keyCode −10)* | `01 00 00 00` | slot 121 — wire-verified |
| 0 Remap Key | `00 <target> 00 00` | wire-verified (both captures). Value −10 → `01 00 00 00`; Value −20 → `14 00 00 00` |
| 1 Macro | `10 <keyCode> <slotIdx> 00` | slotIdx = ++field_744, the wire-0x19 macro-bank slot (0..9). **No CRC** — the old notes' "crc" reading was the slot counter. Macro content: see below |
| 2 Key Combination | `13 <mod1> [<mod2>] <key> [00]` | Value = `"<modmask>,<keycode>"`; mask bits 0-7 → mods 0xE0-0xE7 (LCtrl…RGui) |
| 3 Multimedia | `07 <id'> 00 00` | id′ table below (FUN_0047be90); wire-verified |
| 4 Mouse Key | `12 <isScroll> <btnOrWheel> 00` | wire-verified |
| 5 Disable | `00 00 00 00` | = an empty slot |
| 6 Text | `16 00 00 <x>` | |
| 7 Assign Profile | `16 00 00 <x>` | same shape as Text |
| 8 Select App | `16 00 00 <x>` | same shape |
| 9 Shortcuts | `13 <mod> <key> 00` | presets (FUN_0047c2d0): 0 Alt+F5, 1 Alt+Tab, 2 Win+D, 3 Win+E, 4 Win+L, 5 Ctrl+C, 6 Ctrl+X, 7 Ctrl+V, 8 Ctrl+F, 9 Ctrl+N, 10 Ctrl+P, 11 Ctrl+S |
| 0x13 Key Config | `11 <arg> 00 00` | arg 0xb parses a comma pair (lock-key layout) |
| 0x14-0x19,0x1b kbd light | `<opType−0x12> <eventId> 00 00` | markers 2,3,4,5,6,8,9 |
| 0x1a / 0x22 (side variants) | `11 04…` / `11 06…` | Value 0/1 variants |
| 0x1e-0x21 side light | `<opType−0x14> <eventId> 00 00` | markers 0xA,0xB,0xC,0xD |
| 0x28 DKS | `17 <storeIdx> 00 00` | storeIdx = ++field_7c0, the wire-0x22 DKS store index (0..39) |

## Media id table (FUN_0047be90: XML Value → wire byte)

| Value | wire | name | Value | wire | name |
|---|---|---|---|---|---|
| 0 | 0x10 | Vol+ | 8 | 0x30 | Player |
| 1 | 0x11 | Vol− | 9 | 0x32 | Calc |
| 2 | 0x12 | Mute | 10 | 0x34 | Computer |
| 3 | 0x13 | Play/Pause | 11 | 0x23 | Browser |
| 4 | 0x14 | Next | 12 | 0x20 | Email |
| 5 | 0x15 | Prev | 13 | 0x38 | Brt+ |
| 6 | 0x16 | Stop | 14 | 0x39 | Brt− |
| 7 | 0x17 | (8th media) | 15 | 0x21 | Search |

Consistency check: the compiler's stock defaults for other boards'
built-in media keycodes use the same markers — keyCode 0x80 → `07 10`
(Vol+), 0x81 → `07 11` (Vol−), 0x7f → `07 12` (Mute), 0xd7 → `07 32`
(Calc). ✓ internal agreement.

## The macro content format (wire 0x19) — decoded

Four agents cross-checked the Download pipeline; all claims below are
asm-verified (the old notes' "0x51a = 1306 bytes of macro text" and
"macro crc" readings were wrong — see the ledger at the bottom).

- **Bank**: wire 0x19 = the Macro-data list (app cmd 0x18 remapped by
  the SDK). 10 slots; each slot = 5 packets of 58/58/58/58/24 =
  256 bytes (content area 248 + 8-byte packet-0 header). Unused slots
  are zero-filled after the keymap by the compiler (the "all-zero
  bank" in the keymap captures). The keymap entry's slotIdx links the
  binding to the bank slot.
- **Packet 0 header** (offsets within the 64-byte frame):
  `[6]=0, [7]=repeatNum−1, [8]=0, [9]=4×eventCount (content bytes),
  [10]=0, [11]=atoi(struct+0x58) (unexplained), [12]=0, [13]=0`,
  then content[0..49]. Packets 1-3: content[50..223]; packet 4:
  content[224..247].
- **Event encoding — 4 bytes per step**:
  `[value][flags][delay_hi][delay_lo]`
  - value: key step = atoi(item+0x60) (HID keycode); mouse step =
    1 left / 2 right / 4 middle (parsed from Windows message codes
    513-520; unrecognized codes emit NO value byte)
  - flags: bit4 = down(1)/up(0) (strcmp(item+0xb0,"down")), bit0 =
    mouse(1)/key(0)
  - delay: 16-bit big-endian, the delay FOLLOWING the event; step i
    takes item[i+1]'s field (+0x40), the first item's value is
    dropped, the last step gets 0. **Units unproven — likely ms**
    (no scaling anywhere in the code).
- **No per-step modifiers** — combos = separate down/up steps
  (Ctrl-down, C-down, C-up, Ctrl-up).
- **No wheel, no mouse movement, no text** in macro steps — the
  app's macro model is keys + three mouse buttons + delays only.
- **No checksum anywhere.** The event list is padded with zeros to
  248 bytes and sent as-is.

## The DKS content format (wire 0x22) — decoded

- **Bank**: wire 0x22 = the SeniorKey/DKS store (app cmd 0x2A
  remapped). 40 slots; each slot = one 64-byte report
  `01 2A <storeIdx> 00 00 32 <mode…>`, payload length 0x32=50
  (meaningful prefix; rest zero). Unused slots zero-filled (the
  keymap captures' 40×50B bank). The keymap entry's storeIdx links
  binding to store slot.
- **Record model** (from a 416-byte SDK record; mode at +0x104,
  action strings at +0x108/+0x118/+0x128/+0x138):
  - mode 1: 5 actions, each = 4 timing bytes + a 4-byte action
    (key `[00][key][00][00]` or mod-mask combo `[13][modA][modB][key]`)
  - mode 2: 2 actions + a delay byte = field/10
  - mode 3: 1 action
- The 0x13 combo tag inside actions matches the keymap combo family.

## The upload order (fully decoded)

```
for pass in [Default layer (seg 0), FN layer (seg 2)]:   # 2 × 0x18 keymaps
    per 132 slots: emit entry; macro/DKS-bound keys ALSO send their
                   bank frames inline (wire 0x19 / 0x22)
    flush keymap packets every 14 entries
Sleep(400); zero-fill macro slots to 10 (wire 0x19)
Sleep(400); zero-fill DKS slots to 40 (wire 0x22)
```

(The two 0x18 segments are the BASE and FN LAYER keymaps — pass
sources `/appProfile_Default.xml` and `/appProfile_FN.xml`; a dead
`/appProfile_Magnetic.xml` branch = seg 1. The old "seg 2 = pristine
default map" reading in notes/11 was an unedited Fn layer.)

## Wire-verification status

- **MEDIA ✅:** `keymap set Insert=Play/Pause --upload`
  → pressing Insert emits `cd 00` on the consumer channel (usage
  0x00CD = Play/Pause; press/release pairs in the WebHID probe).
  The firmware translates its compact media bytes into standard HID
  consumer usages — macOS handles them natively.
- **MOUSE ✅:** `Insert=ScrollUp/Down` scroll the window
  under the cursor; `Insert=LeftClick` clicks. Mouse reports ride the
  boot-mouse interface (the probe can't see them — the cursor is the
  test).
- **Macro/DKS:** binary-verified (above), NOT hardware-tested — a
  capture with a real macro is the closing step.

## Corrections ledger (decode pass)

- `0x51a` in the compiler = **1306 DWORDs (5224 bytes)**, the
  by-value SDK per-key record — not "1306 bytes of macro text".
- The macro entry byte2 = the **0x19 bank slot index** (++field_744),
  not a checksum. No CRC exists anywhere in the pipeline.
- Wire naming (app→wire remap in the SDK): app 0x17 → wire 0x18
  (keymap), app 0x18 → wire **0x19 = Macro-data list**, app 0x2A →
  wire **0x22 = DKS/SeniorKey**. The old notes/04 label
  "0x19 = Write SeniorKey (DKS)" is wrong.
- `Sleep(400)` in the compiler sits before the two clear passes, not
  between keymap packets.
