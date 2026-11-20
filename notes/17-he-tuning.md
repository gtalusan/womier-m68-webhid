# 17 — HE tuning: sensitivity + debounce/anti-shake

Status: **Live-verified.** Debounce and per-key sensitivity both
read/write on the board; sensitivity’s override flag can be cleared
with the sub-6 reset.

## Debounce / key anti-shake (0x21 sub 10)

Global setting (not per-key), alongside the rate (sub 9).

```
query:  01 21 00 00 00 18 0a 00 00 …
set:    01 21 00 00 00 18 0a 01 <value> 00 …
reply:  … byte 6=0a, byte 7=<stored value> …
```

- App UI: DTriggerSettingPage’s “Key anti shake” slider is built with
  `FUN_00593ef0(7)` — **7 divisions = positions 0..7** (the rate slider
  uses `FUN_00593ef0(3)` = four positions).
- Device readback at test time: **3**.
- Live probe: the firmware **echoes every value 0..25** we sent; it
  does not clamp at the app’s UI limit. The app is the range spec:
  **0..7**.
- “Most debounce” default = **7**. Units are not proven (likely ms;
  the app label is a bare number).
- Setter restored to **3** after probing.

## Sensitivity (0x21 sub 4 query + per-key apply)

### Readback

`01 21 00 00 00 18 04 00 …` → byte 6=04, byte 7=value.
Live value on the test board: **40**.

The DTrigger page refreshes its 0.1 mm sliders from
`(value + 1) / 2`, with slider max = 20 (`0x14`) and min = 1:
the global value is in **0.05 mm units** (40 = 2.0 mm), while the UI
sliders are **0.1 mm steps, 0.1–2.0 mm**. The page’s default positions
are 20/19/20. “Lowest sensitivity” = slider **1** (0.1 mm).

### Per-key apply (the setter)

Apply handler `FUN_004d1300` → signal `sigMagnetsKeysApplyConfig` (5
ints) → `FUN_0046e5c0` builds the frame:

```
01 21 00 00 00 18 <selMode> <22-byte key mask> \
   <press> <release> <QT press> <QT release> 00 …
```

- `selMode`: `0` = neither checkbox, `1` = sensitivity only,
  `12` = quick trigger only, `13` = both.
- Key mask: 22 bytes, one per column; bit per row (6 rows). The app
  requires at least one selected key (“Please select one Key first”).
- The four values are the page’s slider positions (1..20, 0.1 mm).
  When split mode is off, press=release and QT press=QT release.
- Query sub 5 (`01 21 … 18 05 <indexX> <indexY>`) returns five bytes:
  `[override flag, press, release, QT press, QT release]` (see below).

### Live verification

Coordinates: `indexX = row`, `indexY = col` (vendor XML: Q is
`indexX=2,indexY=1`). Query frame:
`01 21 00 00 00 18 05 <row> <col> 00 …`.

Sub-5 reply is five bytes:

```
[ override flag, press(0.1mm), release(0.1mm), QT press, QT release ]
```

Baseline grid: every physical key read `[0, 20, 20, 1, 1]`
(2.0 mm, QT 1); padding/empty slots read `[0, 20, 20, 0, 0]`.

Single-key apply (Esc = row 1, col 0 → mask byte 0 bit 1):

```
01 21 00 00 00 18 01 02 00 00 … 03 04 01 01 00 …
                      ^mask       ^press/release/QT
```

Results:

| step | Esc (1,0) | Q (2,1) |
|---|---|---|
| before | `[0,20,20,1,1]` | `[0,20,20,1,1]` |
| after apply 3/4 | **`[1,3,4,1,1]`** | `[0,20,20,1,1]` |
| restore 20/20 with `selMode=1` | `[1,20,20,1,1]` | `[0,20,20,1,1]` |
| restore 20/20 with **`selMode=0`** | **`[0,20,20,1,1]`** | `[0,20,20,1,1]` |
| after sub-6 reset | `[0,20,20,1,1]` | `[0,20,20,1,1]` |

- The first byte is a **per-key override flag**. `selMode=1` sets it
  even when the values equal the defaults; **`selMode=0` with the
  default values clears it**. That is the per-key reset:
  `01 21 00 00 00 18 00 <mask> 14 14 01 01 …`
  (20/20 = 2.0 mm, QT 1/1). Verified on Esc; Q untouched.
- The app’s global **Reset sensitivity** (sub 6,
  `01 21 00 00 00 18 06 00 …`) also clears flags, but only touches
  press/release — a prior QT 0 test stayed 0 after sub 6.
- The apply reply is an ACK-shaped frame
  `01 21 00 00 00 01 00 …`, not the new values.
- Per-key writes do not change the global sub-4 value (queried 40
  before and after).

### TODO

1. Test persistence of per-key sensitivity across a replug (set a
   distinguishable value, replug, query, reset).
2. Decode quick-trigger-only (`selMode=12`) and both (`selMode=13`).
3. All-keys grouped apply is implemented in the web UI; re-check the
   multi-QT grouping path on hardware. Phase 2: multi-key selection
   (arbitrary subset).
4. Sub 4 is used as the reset-default anchor
   (`default = (value+1)/2` → 20 for 40); its exact semantics (global
   default vs range anchor) are still not fully proven.

## Web UI — Phase 1

`web/index.html` now has:

- **Keys panel above Device**, with a **Remap | Tune** mode switch.
  Board clicks remap in Remap mode and select a key in Tune mode.
- **Tune tab**: single-key sensitivity editor. Press/Release sliders
  1–20 (0.1–2.0 mm), `DEFAULT`/`CUSTOM` from the sub-5 flag, and
  Apply / Apply to all / Reset key / Reset all.
  - Apply: `sub 1`, key mask, press/release, preserving the key’s
    read-back QT bytes.
  - Apply to all keys: reads every physical key once via sub 5
    (~67 queries at the normal 100 ms pace, with progress), groups
    keys by identical QT pair, and sends one masked `sub 1` frame per
    group. The QT map is cached per connection.
  - Reset key: `sub 0`, key mask, `tuneDefault` (from sub 4), QT
    preserved; clears the override flag.
  - Reset all: `sub 6` with a confirm.
  - No-data default is 1/1 (lowest); the real values replace it after
    the sub-5 read.
- **Device panel**: Debounce 0–7 (default 7), query sub 10 / set
  `sub 10 [7]=1 [8]=value`; readback corrects it.
- Simulator mode fakes the per-key readback (20/20 DEFAULT) and
  exercises Apply/Reset; tested in Safari. The underlying sub-5 read,
  sub-1 apply, sub-0 reset, and sub-6 reset frames were live-verified
  on the board through the CLI/Python path.
- Phase 2: multi-key selection, Quick Trigger section, persistence.

## Connected-but-no-data defaults (user)

When a board is connected and no readback has landed yet:

| setting | default |
|---|---|
| brightness | 2 |
| speed | 2 |
| polling rate | 8K (code 8) |
| sensitivity | lowest (0.1 mm / slider 1) |
| debounce | most (7) |

Web app: all five defaults are implemented (sensitivity starts at
1/1 in Tune until a key is read; debounce starts at 7). The profile
bar sits above the layout so profile is the primary context for the
per-profile settings; sensitivity/debounce are labelled device-side.
