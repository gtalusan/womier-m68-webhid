# 09 — Verified protocol (ground truth only)

Everything below is verified by at least one of: the WinDbg wire
transcripts of the real app (`~/Downloads/usb3.log`, `usb4.log`), the
device's own responses/register mirrors, or direct observation of the
board. Speculation is called out explicitly.

(This note covers the lighting session. Key bindings/remapping live
in notes/11 (wire-validated upload spec) and notes/14 (all operateType
entry encodings).)

## Frame format (hard fact)

- 64-byte reports: `[0]=report ID 1`, `[1]=wire command`, `[2..63]=payload`.
- **65-byte writes wedge the firmware's OUT endpoint** (verified in
  usbmon; every wedge in this project traced to a 65-byte frame).
- All device writes go through the SDK's single `WriteFile` site
  (`witmodSdk.dll + 0x343f`) — the WinDbg transcripts captured
  everything the app ever writes.

## Session sequence (from the transcripts, in order)

| Step | Frame | Verified |
|---|---|---|
| Device info | `01 0d 00…` → 2 responses: CSV info + build date | ✅ device answered |
| SN | `01 15 00…` → hex-ASCII serial | ✅ |
| Light config query | `01 07 01 00…` → 12-byte register | ✅ |
| Mode list | `01 0a 00…` → 15 ids + `a5 5a 04 04` | ✅ |
| Other queries | 0x08 (side cfg), 0x21×3 (HE sens), 0x02 (side modes), 0x0e (layout), 0x14 (sleep) | ✅ device answered |
| Sync-ish 0x17 | `01 17 00 00 00 01 01` — sent at session start and re-sent every ~150 chunks | ⚠️ observed in transcripts; its effect was never isolated |
| Keepalive 0x01 | `01 01 00 00 00 01` — every ~59 chunks | ⚠️ observed; device ACKs with echo 0x01; purpose unverified |
| Stream 0x0F | `01 0f <group> 00 <chunk> <len> <data…>` — kbd group 0: 8 chunks (7×54B + 18B); side group 1: 54B + 45B; RGB data; one chunk per second | ✅ board renders it LIVE while streaming; reverts to committed state on clean stop |

## The commit — the one command that matters (verified end-to-end)

```
01 07 00 00 00 0e  <mode> <brightness> <speed>  <R> <G> <B> <…> 00 …
```

- `[6]=mode` — 0x00 = **Static** (verified: the app's Static commit wrote
  0x00 and the register mirrored it).
- `[7]=brightness`, `[8]=speed` — the app's Static commit carried
  04/03 (mirrored in the register).
- **`[9..11] = R,G,B`** — `[9]` is the red channel, NOT a flag. Verified
  three ways: (a) the app's "static red" commit wrote `ff 00 00` and the
  register read back `…04 03 ff 00 00…`; (b) my commit with
  `[9..11]=(00,ff,00)` → board went green; `(00,00,ff)` → blue;
  (c) `(ff,00,ff)` → purple exactly as predicted.
- `[12]=0`.
- **One frame persists across power cycles.** No stream, no yank, no
  keepalive needed — `light static <RRGGBB>` is a single commit.
- Brightness range: 0 = dark ("off" is just brightness 0).

**Full layout (binary-verified later — notes/10-neon-mode.md):** the
commit continues past the RGB: `[12..14]=background R,G,B`,
`[15]=direction (0..7)`, `[16]=full-color flag (0/1, forced 0 for
Static)`, `[17]=0`, `[18]=0`, `[0x3e..0x3f]=16-bit ms timestamp`.
Brightness/speed carry the raw slider values (Qt default 0..99).

## Mode table

Wire mode ids = the app's INTERNAL effect ids (definitively verified
2026-11-17: the real Windows app's Neon commit wrote 0x03 and the
device renders it as Neon — notes/10):

| id | name | | id | name | | id | name |
|---|---|---|---|---|---|---|---|
| 00 | Static ✅ | | 06 | Reactive* | | 0c | Speed Respond* |
| 01 | Breath* | | 07 | Aurora* | | 0e | Auto Ripple* |
| 02 | Wave* | | 08 | Ripple* | | 0f | Striation* |
| 03 | **Neon ✅** | | 09 | Twinkle* | | 10 | Fireworks* |
| 04 | Radar* | | 0a | Custom*† | | 100 | Musical Rhythm*† |
| 05 | Snake*† | | 0b | Cross* | | | |

✅ = verified (register anchor / app's own commit + device rendering).
* = binary-verified (FUN_004a8b40 UI↔internal-id switch; SDK renderer
dispatch FUN_1000a5d0). † = not in the device 0x0A list (which also
contains an extra 0x11 — renders dark; uncharacterized).

The earlier UI-index mapping (0x01=Neon, 0x02=Breath, …) is wrong on
the wire: the app shuffles ids internally (0x01=Breath, 0x02=Wave,
0x03=Neon). A live 0x01+full-color commit cycles colors too (Breath
with full-color looks Neon-ish) — the app's own register write is the
authoritative anchor.

## Things I inferred that were WRONG (kept for the record)

1. "ShakeHands 0x01 opens the session" — it's just a periodic keepalive.
2. "The 0x0F stream persists colors" — it's live preview only; the
   commit persists.
3. "The commit's [9] is an open/close flag" — it's the red channel.
4. "The color is at [10..12]" — off by one; it's [9..11].
5. "The device flash-writes on disconnect" — plausible but never
   isolated; irrelevant now that the commit persists.
6. "0x02 = off" — it's Breath; "off" is brightness 0. (Actually 0x02 =
   Wave under the corrected table; "off" is still brightness 0.)
7. "The 0x0A list maps positionally to the UI effect list" — the list
   values are the app's INTERNAL ids, in the device's own order:
   0x03=Neon, 0x01=Breath, 0x02=Wave. Definitively proven by reading
   the register after the real Windows app committed Neon → mode 0x03
   (notes/10). Also: a live 0x01+full-color commit looks like Neon —
   Breath with full-color cycles colors too, so eyes alone misled us
   twice; the app's own register writes are the anchor.
