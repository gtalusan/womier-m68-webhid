# 13 — Web app: faithful keyboard render (KeyInfo geometry)

## The delta that prompted this (2026-11-19)

The web app drew its keyboard as a static product-shot
(`web/assets/keyboard.png`) + a hand-calibrated uniform 6×22 overlay
(`geometry.json` v5). m68.exe draws real per-key geometry from a
vendor config. The overlay's square cells floated over the photo's
keycaps, included ghost cells for empty matrix slots, and ran off the
right edge — hence the old in-browser Calibrate mode.

## The vendor's true geometry

`:/images/configDir/KeyInfo_X82HERGB.config` (extracted Qt resource,
gb18030) = the app's per-key layout table:

- 67 keys, 5 rows (app rows 02..06 = wire rows 1..5), real widths:
  Back 71, Tab 49, CapsLk 61, Enter 82, L_Shift 83, R_Shift 63,
  Space 258, mods 36-38, **backslash 49 (1.75u — the M68's
  signature)**, standard 28; height 32; staggered x.
- Fn key = **dec −10** between R_Alt and Left — confirms the RE
  note and wire slot 121.
- Row07 = a 9-key **bottom function rail** (all x=0 in the config;
  flow-laid left-to-right): the M68's onboard special/IME keys —
  `|￥-`(137) `>/<`(50) `《》`(100) `-"ろ`(135) 無変換(139) 汉字(145)
  韩/英(144) 変換(138) カタカナ/ひらかな(136) — dec ids in the
  app's 0x13 KeyConfig range (operateType table, notes/11).
- Dec = USB HID usage id for every main key (identity, like the
  wire keymap).

Wire-slot mapping: slot = wire_row*22 + col, wire_row = app row − 1
(Row02..06 → rows 1..5). Verified: Esc=22, Q=45, PgUp=104, Fn=121,
Right=126 — matches the CLI keymap and the usb7/usb8 keymap decode.

## The web app now

- Keycaps drawn programmatically from the vendor geometry (dark caps,
  labels, real widths/stagger), + the 9-key rail.
- `setKey(r, c, …)` maps to the keycap via slot = r*22+c; empty
  slots are no-ops (no ghost cells). Hex colors now parsed for the
  near-black cutoff (resting keys render truly off).
- Pixel-space effects (Radar/Ripple) use per-key centers in the
  vendor's 700×280 space.
- Fixed latent bugs found on the way: KEYMAP backslash was col 13
  (now 14), arrows were 1-indexed (Right lit an empty slot), and the
  first KBD extraction was off by one row (app rows vs wire rows).
  Reactive verified: pressing Q lights exactly slot 45.
- Removed: keyboard.png base image, geometry.json overlay, the
  Calibrate button and its nudge/stretch code. (The two asset files
  remain on disk, orphaned.)

Remaining cosmetic deltas vs the app: the app's caps are squarer and
its legends glow from within; the webapp's caps are rounded with a
gradient + additive glow. Geometry is exact.

## Follow-ups (same day)

- **Text clipping**: labels were fixed `rem` while caps scale with the
  board. Now: container-query units (`cqw`, 1cqw = 1% of board width)
  + per-key auto-fit (long labels shrink to their cap). Verified at
  880px-wide viewport. Also fixed: `setKey` parses hex colors for the
  near-black cutoff (resting keys now render truly off), and a TDZ bug
  (initial `sync()` read `dev` before its `let` declaration).
- **Default state**: no keyboard attached = board OFF (brightness 0,
  hint "off — connect a keyboard to preview") instead of Static red.
- **Spacing vs m68.exe (measured from the user's app screenshot)**:
  the app draws the KeyInfo coords at ≈1:1 (legend-row pitch measured
  ≈40-42 logical px vs the config's 43-unit row pitch). The webapp
  renders the same coords as % — inter-key spacing identical by
  construction. The only distortion was my container: 700×280 (aspect
  2.50) vs the config's true bounds **692×220** for the key rows
  (aspect 3.15) — fixed; the board now uses the exact bounds
  (692×271 when the rail is shown).
- **Rail suppressed**: `SHOW_RAIL = false` (data + rendering code
  stay, one flag re-enables). The measurement agrees: the app draws
  nothing at the rail's config position below the space row, and the
  rail isn't on the physical board.

## Input-channel probe (WebHID) + click-to-remap UI

`web/probe-hid.html` opened every collection the chooser offers
(Chrome hides the boot-keyboard collection — protected usage):

- `0x0001/0x02` (mouse composite): inert, no reports.
- `0x000C/0x01` (Consumer Control): 2-byte `00 00` heartbeats; Fn
  press fires reports but payload stays `00 00`; Fn+1-9/0 = nothing
  (onboard profile switch, firmware-internal). Fn-combo media keys
  presumably land here — unverified.
- `0xFF1B/0x91` (vendor): answers queries only; no key reports even
  after the 0x0D handshake or the app's full session-start sequence.

**Verdict: normal keypresses are invisible to WebHID**, so the
press-to-remap loop is shelved. The remaining lead (unpursued): the
app's 0x04/0x05 "Six Key" echo proves key reports reach the app
somewhere — probably gated by a trigger sent when its custom-keys
page opens (never captured; a usb9.log of that page would show it).

**Shipped instead: click-to-remap** on the faithful render —
`Remap: on` chip → click a cap (amber) → pick a target from the
tray (F-row/nav/mods, the verified key targets) or click a second
cap to **swap**; per-profile (0-2) staged overrides in
`localStorage`, per-entry undo, reset-profile, and **Upload** that
replays the byte-verified Download sequence (0x18 seg0+seg2 @400ms,
0x19 ×10, 0x22 ×40 @100ms) with a progress bar and a
never-unplug-mid-upload warning. Fn is locked (marker slot).
`stockMap()`/`applyRemaps()` in the webapp are byte-identical to
usb7 seg[2]/seg[0]. Swap had a read-after-write bug (both sides
took B's action) — fixed and re-verified.
