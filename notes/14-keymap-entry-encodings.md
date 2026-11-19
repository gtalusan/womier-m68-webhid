# 14 — Keymap entry encodings (all operateTypes) — binary-verified

RE'd 2026-11-19 from M68.exe `FUN_00471ce0` — the Download path that
compiles the profile XML into the 132-slot keymap AND sends the 0x18
upload (same function; the 14-items-per-packet flush and Sleep(400)
are visible in the decomp, matching usb7/usb8 byte-for-byte).

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
| 0 Remap Key | `00 <target> 00 00` | wire-verified (usb7/usb8). Value −10 → `01 00 00 00`; Value −20 → `14 00 00 00` |
| 1 Macro | `10 <index> <crc> 00` | crc = FUN_0047c460→FUN_0047c4d0 over the macro text; text goes to the 0x19 macro bank (builder not decoded — see below) |
| 2 Key Combination | `13 <mod1> [<mod2>] <key> [00]` | Value = `"<modmask>,<keycode>"`; mask bits 0-7 → mods 0xE0-0xE7 (LCtrl…RGui) |
| 3 Multimedia | `07 <id'> 00 00` | id′ table below (FUN_0047be90) |
| 4 Mouse Key | `12 <isScroll> <btnOrWheel> 00` | isScroll = 1 iff Value ∈ {3,4}. btnOrWheel: 0→01, 1→04, 2→02, 3→01, 4→FF, 5→10, 6→08, 7→00 |
| 5 Disable | `00 00 00 00` | = an empty slot |
| 6 Text | `16 00 00 <x>` | |
| 7 Assign Profile | `16 00 00 <x>` | same shape as Text |
| 8 Select App | `16 00 00 <x>` | same shape |
| 9 Shortcuts | `13 <mod> <key> 00` | presets (FUN_0047c2d0): 0 Alt+F5, 1 Alt+Tab, 2 Win+D, 3 Win+E, 4 Win+L, 5 Ctrl+C, 6 Ctrl+X, 7 Ctrl+V, 8 Ctrl+F, 9 Ctrl+N, 10 Ctrl+P, 11 Ctrl+S |
| 0x13 Key Config | `11 <arg> 00 00` | arg 0xb parses a comma pair (lock-key layout) |
| 0x14-0x19,0x1b kbd light | `<opType−0x12> <eventId> 00 00` | markers 2,3,4,5,6,8,9 |
| 0x1a / 0x22 (side variants) | `11 04…` / `11 06…` | Value 0/1 variants |
| 0x1e-0x21 side light | `<opType−0x14> <eventId> 00 00` | markers 0xA,0xB,0xC,0xD |
| 0x28 DKS | `17 <idx> 00 00` | + DKS data (FUN_0047d380, 0x51a bytes) → the 0x19 banks |

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

## What this unlocks / what remains

- Media, mouse, combo, shortcut, disable, light-event and key-config
  bindings can now be compiled to keymap entries from the same XML
  values the app uses.
- **MEDIA IS WIRE-VERIFIED (2026-11-19):** `keymap set
  Insert=Play/Pause --upload` on the real board → pressing Insert
  emits `cd 00` on the consumer channel (usage 0x00CD = Play/Pause,
  press/release pairs observed in the WebHID probe). The firmware
  translates its compact media bytes into standard HID consumer
  usages on the wire — macOS handles them natively.
- **MOUSE IS WIRE-VERIFIED (2026-11-19):** `Insert=ScrollUp` /
  `Insert=ScrollDown` scroll the window under the cursor in the VM,
  and `Insert=LeftClick` clicks — the `12 <isScroll> <btn> 00`
  entries (incl. the `ff` = −1 wheel byte) behave on the board.
  Mouse reports ride the boot-mouse interface, so the WebHID probe
  can't see them — the cursor is the test.
- NOT decoded: the macro-text bank builder (FUN_0047c4d0, 13KB) and
  the DKS payload builder (FUN_0047d380, 15KB) — both needed only
  for macro/DKS *content* upload (0x19 banks). The 0x19/0x22 senders
  live outside FUN_00471ce0 and were not traced this pass.
