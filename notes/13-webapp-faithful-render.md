# 13 — Web app: faithful keyboard render (KeyInfo geometry)

## The delta that prompted this

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

## Later the same day (post-commit rounds)

- **Remap is always on** — the `Remap: on` toggle chip was removed;
  the rail lock (no keyboard) gates it instead.
- **Profile tabs**: the rail's top-level structure is now Profile
  1/2/3 tabs containing Effect + Parameters + Remap. Light settings
  remember per profile; a fresh profile defaults to Static black;
  switching tabs loads the stored light (and commits if connected).
- **Media + Mouse tray groups** (16 + 8 targets) using the
  wire-verified encodings (notes/14); compiled entries match the
  hardware bytes exactly. The app-XML importer reads operateType
  3/4 too.
- **Export/Import** the profile store (JSON) — portability across
  browsers, since the board's keymap has no read-back command.
- **Upload UX**: hard-locks the whole UI (rail + Effect + caps +
  chips), live percent, "Uploading…" state; the keymap actions live
  **inside Remap**: “Upload keymap to board”, “Restore stock keymap”
  (writes stock keymap + clears this profile’s remaps), and “Clear
  profile remaps” (local only). Lighting is reset separately with
  “Reset lighting” in the Effect header.
- **Disconnect is a function**: the Connect chip toggles to
  "Disconnect keyboard" (`device.close()`), and reconnecting reuses
  the grant via `getDevices()` — no chooser.
- **Bug fixes**: the color well (a `<label>`) was grown to ~236px by
  `.row label { flex: 1 }` — scoped with `.row .well`. A stale
  WebHID session after many hard-reloads can wedge Chrome's USB
  grant stack; restarting Chrome clears it.

## Cap-face correction (superseded by the image render below)

The interim programmatic-cap render leaked the widget bleed into the
cap: wide keys (Back/Tab/CapsLk/Enter/shifts/Space) used larger widget
margins while the face inset was a fixed px value, so their caps were
~5 units taller than standard keys. Faces were made the exact KeyInfo
cell and the surround a uniform 2-unit border; Ins was normalized from
the vendor's PosX 666 to 664 because it stuck past the 692-unit
board. That fixed the flat render but removed the keycaps' 3D
perspective.

## Vendor-image render (the app's actual keyboard)

The app's keyboard is a QFrame styled
`border-image: url(/images/hidImages/Keyboard_<model>.png)`
(FUN_00509ef0), stretched to a **712×240** frame. The per-key
`keyboardButCustom` widgets (QToolButton subclass, constructed by
FUN_004214d0 from `FUN_0050c7a0`) paint only the light on top: the
paint rect is 34×38 units for a 28×32 KeyInfo cell (`CAP_PAD` 3 —
FUN_00421d30's rounded rect). The perspective black border around a
lit key is therefore the **image's own 3D keycap bevel and side
walls**, not a flat widget background.

The web app now does the same:

- `assets/keyboard.png` (byte-identical to the vendor image, md5
  27c6543b…) fills `.board` stretched 100%/100%; the board's
  aspect-ratio is 712/240.
- Each key overlay is the KeyInfo cell inflated by 3 units on every
  side, mapped onto that frame. Verified against the image in the
  simulator: the Q/1/Del/Space overlays land on the image's cap tops.
- The black surround div is gone; the image supplies the bevels and
  therefore the perspective border at every cap height.
- Ins uses the vendor PosX **666** again — that is where the image's
  Ins cap sits (the image's right column is in perspective, not a
  flat grid; the interim 664 normalization is reverted).
- The `noremap` Fn dimming no longer uses element opacity (which let
  the image's own "Fn" legend ghost through the cap); it dims the
  opaque face/label/glow instead.
- **Cap sheen**: the image's cap tops carry a baked specular gradient
  (sampled on the spacebar: ~65 at the top-left falling to ~43 at the
  bottom-right, with bright bevel rims on the top and bottom edges).
  The overlay reproduces it with a 135° white→black gradient plus a
  top-left radial hotspot and inset bevel lines; the lit color is
  mixed into the face base (60% key color + 40% cap gray, replacing
  the old ::after wash) so the sheen sits over the light and the
  label stays crisp.
