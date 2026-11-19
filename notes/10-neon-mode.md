# 10 — NEON mode: verified frame layout (Ghidra RE of M68.exe)

Every claim below is verified against the decompiled/disassembled
M68.exe + witmodSdk.dll binaries (Ghidra 12.2, project `ghidra-work/m68`).
No guessing: function addresses are given so the trace can be re-verified.

## The commit frame — complete layout (was: only [6..11] known)

`FUN_004a7010` is the app's commit builder ("USB serial port [Write
keyboard Led] Successful … ledType:%1" is its debug string). Raw
disassembly (`MOV [EBP+idx-0x50]` writes into a memset-0x40 buffer):

```
[0]=1            report ID
[1]=6            app cmd 6 → wire 0x07 (SDK remap in HidWriteBuff)
[2..4]=0
[5]=0x0e         effect commit marker
[6]=mode         param_2  = dialog +0x84
[7]=param_3-1    dialog stores slider+1 at +0x88  →  frame = slider value
[8]=param_4-1    dialog stores slider+1 at +0x8c  →  frame = slider value
[9..11]=param_5..7   = dialog +0x90/+0x94/+0x98  =  TOP/FOREGROUND R,G,B
[12..14]=param_8..10 = dialog +0x9c/+0xa0/+0xa4  =  BOTTOM/BACKGROUND R,G,B
[15]=param_11    = dialog +0xa8  =  DIRECTION (0..7)
[16]=param_12    = dialog +0xac  =  FULL COLOR (0/1); forced 0 when mode==0
[17]=param_13    = dialog +0xb0  =  never written by the UI → 0
[18]=0
[0x3e..0x3f]=currentMSecsSinceEpoch & 0xffff, big-endian
rest=0
```

The 14 dwords at dialog `+0x80..+0xb4` are passed as params;
`+0x80` itself is the keyboard(0)/side(1) selector (`FUN_004a6e30`:
0 → FUN_004a7010, 1 → FUN_004a7370 side commit).

### Evidence per field (dialog slot functions, via qt_static_metacall FUN_005a3ab0)

| Field | Slot | Code |
|---|---|---|
| +0x88 brightness | FUN_004a7a90 `onBackCurrentPositionNum_Brightness` | `+0x88 = param+1; commit(2)` |
| +0x8c speed | FUN_004a7ac0 `onBackCurrentPositionNum_Speed` | `+0x8c = param+1; commit(3)` |
| +0x90..0x98 fg | FUN_004a7b20 `onGetRGB(R,G,B)` + FUN_004a6e30(0) | copies +0xb8..+0xc0 → +0x90..0x98 |
| +0x9c..0xa4 bg | same | copies +0xc4..+0xcc → +0x9c..0xa4 |
| +0xa8 direction | FUN_004a98f0 | 8 radio buttons → `+0xa8 = 0..7; commit(4)` |
| +0xac fullcolor | FUN_004aa790 (full-color checkbox at UI+0x154) | `+0xac = checked?1:0; commit(1)` |

`FUN_004a95c0` (top/bottom color tab): param 0 → shows +0x90..0x98,
else +0x9c..0xa4 — proves the two RGB triples are fg/bg.

The builder forces fullcolor to 0 for mode 0 (Static): `if (param_2==0)
param_12=0`. Our CLI mirrors this.

### Brightness/speed ranges (app UI + device-verified live)

The app's BRIGHTNESS and SPEED sliders each have **5 steps (0..4)** —
confirmed in the Windows app's Neon dialog. The commit carries the raw
step value:

- **brightness: 0..4** — 0 = dark/off, 4 = full (the app's captured
  Static commit carried exactly 4 = max). 5+ → lights off.
- **speed: 0..4** — app UI: left (0) = slowest, right (4) = fastest.
  The app never sends above 4; out-of-range values (5..14 tested) make
  the firmware misbehave (slow/stuck/dark), so >4 is garbage, not a
  hidden slow setting.

The app's custom position widgets ("BackCurrentPositionNum" — not real
QSliders, and no QSlider::setRange exists in the binary) emit these
5-step ranges.

## Mode ID table — the wire carries the app's INTERNAL ids

**Definitively verified (2026-11-17):** the real Windows app was set to
NEON (full color, brightness step 2, speed step 4) and the device
register read back `03 01 03 ff0000 000000 00 01` — i.e. the app wrote
**mode 0x03** for Neon, brightness/speed as raw 0-indexed step values
(no remapping), full-color at [16]. The device renders 0x03 as the Neon
cycling. (An earlier live test committed 0x01 and also saw color
cycling — that was Breath with full-color, which looks Neon-ish. The
app's own register write settles it.)

Wire mode ids = the app's internal ids from `FUN_004a8b40`:

```
0 Static   1 Breath    2 Wave    3 Neon     4 Radar    5 Snake
6 Reactive 7 Aurora    8 Ripple  9 Twinkle  0xa Custom 0xb Cross
0xc Speed Respond     0xe Auto Ripple  0xf Striation  0x10 Fireworks
100 Musical Rhythm
```

App-register-verified anchors: **Static=0x00** (original anchor),
**Breath=0x01** (2026-11-17: the app's Breath commit read back
`01 04 03 ff 00 00 00 00 ff 00 00 00` — b=4, s=3, fg red, bg blue, no
full color), **Neon=0x03** (same day, see above), **Wave=0x02**
(`02 02 02 ff 00 00 00 00 00 00 04 01` — outward, full color),
**Twinkle=0x09** (`09 02 02 ff 00 00 00 00 00 00 00 01` — full control
set: b, s, fg, bg, full color; no direction),
**Radar=0x04** (`04 02 02 ff 00 00 00 00 00 00 07 01` — direction 7 =
counter-clockwise; the two Radar directions are the raw button values
6=clockwise, 7=counter-clockwise),
**Auto Ripple=0x0e** (`0e 02 02 ff 00 00 00 00 00 00 04 01` — direction
4 = the app's stored default for Auto Ripple per FUN_004a2cb0; its
2 visible direction buttons (6/7) were not touched),
**Ripple=0x08** (`08 04 02 ff 00 00 00 00 00 00 04 00` — direction 4 =
stored default, no direction UI; fullColor was 0 because the checkbox
was off at capture time),
**Striation=0x0f** (`0f 02 02 ff 00 00 00 00 00 00 07 01` — same
2-button direction set as Radar: 6=clockwise, 7=counter-clockwise),
**Aurora=0x07** (`07 04 02 ff 00 00 00 00 00 00 05 01` — 2-button
direction set: 5=inward, 4=outward (same values as Wave's pair); like
Ripple, Aurora doesn't light the LEDs — mouse-driven, app previews
only),
**Reactive=0x06** (`06 02 02 ff 00 00 00 00 00 00 00 01` — no direction
UI, full control set; keypress-reactive),
**Cross=0x0b** (`0b 02 02 ff 00 00 00 00 00 00 00 01` — no direction UI
observed; the binary leaves 2 of the 8 direction buttons visible for
Cross but the app's commit carried the stored default 0),
**Fireworks=0x10** (`10 02 02 ff 00 00 00 00 00 00 04 01` — direction
row hidden entirely (+0xe0 container); commit carries the stored
default 4),
**Speed Respond=0x0c** (`0c 02 02 ff 00 00 00 00 00 00 02 00` — 2-button
direction set: up=2, down=3 (same values as Wave's pair), fullColor off
at capture),
**Custom=0x0a** (`0a 02 02 00 00 ff 00 00 00 00 00 01` — UI exposes only
brightness + fg; speed=2/fullColor=1 are the app's stored Custom-record
defaults, FUN_004a2cb0).

## Custom lightings (checkboxes behaving as radio buttons)

RE-verified in the binary: clicking an item runs `FUN_004a9ab0`
(onCustomLightItemMouseClicked) which unchecks every other item,
checks the clicked one, and marks it "Using" in the profile XML
(`CWitmodXML_ModifyProFileCustomLightNodeUsingStatus`). The 5 nodes
(alphabet, WASD+Arrows, custom3/4/5) are custom-light nodes in the
profile XML; the pattern reaches the device via the LIVE 0x0f stream
(app-side per-key grid), not a persisted upload.

**The custom layer is RAM-only (capture-verified):** two WinDbg
captures of the app (usb5/usb6 logs — checkbox flips AND a full
profile switch) contain ZERO 0x18 "Write Onboard-data" frames, only
0x0f preview streams. The app's persisted state is the 0x07 commit
(mode 0x0a); the custom pattern colors live in device RAM, streamed
while the Custom dialog is open, lost on power cycle. (The 0x18
upload builder — FUN_0047bc70 / FUN_00471ce0 — turned out to be the
**keymap/DKS Download** path, not a light path; fully decoded in
notes/11 + notes/14 — no lights persistence was ever seen.)

**Power/persistence model (live-verified 2026-11-17):**

- The 0x07 commit **persists across clean power cycles** (Static blue
  survived an unplug/replug with the device idle).
- The **132-slot grid is RAM**: it survives USB re-attaches that don't
  cut power (VM switches), dies on power loss.
- **Unplugging MID-STREAM factory-resets the device**: cutting power
  while the 0x0f stream runs made the firmware boot to factory
  defaults (register → Wave/b4/s3/red/full-color, grid → rainbow
  demo). Don't unplug while streaming.
- The boot-default grid after a factory reset = rainbow; Static mode
  freezes whatever grid is in RAM (Static blue after a clean boot,
  static rainbow after the factory reset — the commit's fg does NOT
  override a non-empty grid).
- **Persist attempts that failed (kept for the record):** the app's
  binary has two candidate persist paths — the 0x18 XML upload
  (FUN_0047bc70, per-config packets) and the 0x09 custom-Led write
  (FUN_004e1e80, `[2]=2`, 18-slot chunks). Both were replayed against
  the device with derived framing (0x09 alone and combined with an
  active 0x0f stream): neither rendered nor survived a power cycle.
  If a persist exists, it needs the app's save UI captured (the
  custom-light editor's save action — never seen in our captures).
  Until then: custom patterns are live-only (`light custom-stream`).

**The stream (usb6-verified):** group 0 = keyboard 132 slots × RGB
(396 B, chunks 0..7 = 7×54+18), group 1 = side 33 slots (99 B, chunks
0..1). Slot = row*22+col = the XML indexX/indexY. Startup: side grid
(chunk0 ×2 + chunk1) → keepalive `01 01 00 00 00 01` → light-sync
`01 17 00 00 00 01 01` → grid cycles (group 0 then group 1). The app
dims the streamed colors by the commit brightness (b=2 → 0.556×).

CLI: `light custom-stream --xml <profile.xml> [--index 0-4]
[--color RRGGBB] [--brightness 0-4]` — parses the customLed node,
commits Custom (0x0a), streams the grid every ~1.2 s until Ctrl-C.
Live-verified 2026-11-17: green Alphabets from Profile2.xml rendered
on the board. The XML is fully data-driven — custom3/4/5 are empty
canvases; any pattern with keyCode/indexX/indexY/colorR/G/B works.

The device's 0x0A list `02 01 03 09 04 00 0e 0f 06 07 0b 0c 10 08 11`
= these ids minus Snake(5)/Custom(0xa)/Musical(100), plus an extra
**0x11** (renders dark — uncharacterized; the app never writes it via
the standard commit).

## Register readback (0x07 with [2]=1)

Response `01 07 00 00 00 0c 00 04 03 f2 55 ff …` — resp[5]=0x0c is the
payload **length** (12, same convention as the mode-list response); the
register at resp[6..17] mirrors the commit fields:
`[6]=mode, [7]=brightness, [8]=speed, [9..11]=fg, [12..14]=bg,
[15]=direction, [16]=fullcolor, [17]=reserved`. (Live-verified
2026-11-17: the device read back mode/brightness/speed/fg/bg exactly as
committed, incl. direction and the full-color flag.)

## NEON specifics (app + device verified 2026-11-17)

- mode byte = **0x03** (the real app's register write; the device
  renders it as the Neon cycling)
- BRIGHTNESS slider → frame[7] (5 steps: 0..4, 0 = dark; >4 kills it)
- SPEED slider → frame[8] (5 steps: 0..4; app UI: 0 = slowest,
  4 = fastest; >4 = firmware garbage)
- FULL COLOR checkbox → frame[16] (1 = cycle colors automatically).
  Live-verified: the app's own commit `01 … 0e 03 01 03 ff 00 00 00
  00 00 00 01 …` → register mirrored every byte and the board showed
  the Neon cycling. **Slider values map 1:1 to frame bytes — the
  app wrote brightness step 2 → 1 and speed step 4 → 3.**
- **DIRECTION: not a Neon control.** The app hides the direction row
  for Neon (`FUN_004a5c10`: internal-Neon case hides the row at
  UI+0xe0; direction belongs to Wave/Radar/Striation/Aurora per the
  app UI). Frame[15] stays 0 for Neon. (Live note: committing
  different direction values made the animation restart, which looked
  like "different motion" — a restart artifact, not real direction
  changes. The register does store the byte.)
- fg → frame[9..11], bg → frame[12..14] (both mirrored in the
  register)

## Mode behavior classes (user-observed 2026-11-17)

- **Always-on animations**: Static, Breath, Wave, Neon, Twinkle,
  Radar, Auto Ripple, Striation.
- **Keypress-reactive** (lights fire only on keypresses — the board
  looks dark at idle): Ripple, Aurora, Reactive, Cross, Fireworks,
  Speed Respond. Their commits are correct; they just need typing to
  show anything.

## Direction field (frame[15]) — Wave and friends

The app's 8 direction buttons (values 0..7; 2 are hidden per mode —
Wave shows 6) map to frame[15] via the .ui button order, which is NOT
the visual order for the left/right and inward/outward pairs.
App-register-verified: the app's Wave commit with "right" (2nd UI
element) wrote 0, "outward" (6th) wrote 4; the rest follow the button
creation order (FUN_004a98f0 case→widget offsets):

```
left=1  right=0  up=2  down=3  inward=5  outward=4   (6 hidden, 7 hidden)
```

Wave's app commit also anchored mode 0x02: register
`02 02 02 ff 00 00 00 00 00 00 04 01` (b=2, s=2, fg red, bg black,
outward, full color).

## What this changes in the code

- `commitLightEffect()` builds the full verified frame (incl. the
  16-bit ms timestamp at [0x3e..0x3f], like the app).
- `decodeLightConfig()` reads the register with the layout above
  (resp[5]=len, register at resp[6..17]).
- CLI: `light neon|breath|wave [--brightness 0-4] [--speed 0-4]
  [--fg RRGGBB] [--bg RRGGBB] [--full-color]`; wave also takes
  `--direction left|right|up|down|inward|outward`. Modes 0x03/0x01/0x02.

## Ghidra tooling used (tools/)

- `FindString.java` — locate strings (ASCII/UTF-16) + xrefs
- `FindStore.java` / `FindOffset.java` — instruction scans
- `DumpXrefs.java`, `DumpListing.java`, `DumpBytes.java`
- `DecompileFns.java` — batch decompile by address range

Run: `analyzeHeadless ghidra-work m68 -process M68.exe -noanalysis
-scriptPath tools -postScript <Script>.java <out> <args>`
