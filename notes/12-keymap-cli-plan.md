# 12 — Keymap CLI: feasibility plan (profile-aware m68ctl)

Status: IMPLEMENTED (2026-11-19) — CLI + web UI land; P2 closed, P0/P1
still open. Wire spec for the keymap upload is wire-validated
(usb7/usb8 — see notes/11 STATUS).

**Implementation log (live-verified 2026-11-19):**
- **Full Download replay WORKS on the board** — `keymap set
  PageUp=PrintScreen --profile 0 --upload` → PgUp types PrtSc, and
  it persists across replug. First CLI-driven key remap.
- Minimal probe (seg[0] only) ran after the full upload — result
  ambiguous, needs the clean isolation test (reset→stock→replug→
  minimal→test→replug). If seg[0] alone commits + persists, the
  upload drops from ~17 s to ~4 s.
- `--profile` stripping had a const-reassignment bug on all `light`
  commands (fixed 2026-11-19).
**Profile model (final, 2026-11-19):** P2 closed — a board-side
profile switch left every known register byte-identical, so the
device has no observable profile state. **Profiles are an XML
concept only**: `--profile` applies to `keymap`/`profile` commands
(0-based index into the app's 3 profile XMLs) and was REMOVED from
all `light` commands (the 0x07 register is one device-wide slot).
The store keeps only per-profile keymap overrides; `profile import
<file>` merges the app's per-profile XML `<keyEvent>` items
(operateType 0, non-identity — identity items like the app's
`M→M` are no-ops) and `profile export <file>` writes an app-shaped
`<Parameters><config><keyEvent>` file (best-effort). Live-tested
against the real Profile2.xml on the VM.
- `protocol/src/keymap.js`: stock keymap + 66-key layout table, name
  map, `applyRemaps` — **byte-identical to the captures** (stock ==
  usb7/usb8 seg[2]; PgUp→PrtSc == usb7 seg[0]; the usb8 profile-2
  edits rebuild usb8 seg[0] exactly).
- `protocol/src/session.js`: `uploadKeymap()` — the full Download
  sequence (0x18 seg0+seg2 @400ms, 0x19 ×10 @100ms, 0x22 ×40
  @100ms, then ACK drain). Generated frames are **byte-identical to
  usb7's 0x18** in the same order; the app also re-sends 3 duplicate
  0x19 packets (quirk, not replicated). ~17 s total.
- `cli/src/profiles.js`: profile store `~/.m68/profiles.json`
  (3 profiles, 0-based per user decision; current-profile pointer;
  per-profile keymap overrides + last light effect).
- `cli/src/cli.js`: `keymap show|set|reset|upload`, `profile
  list|use|current|import|export`. Name aliases
  (PrtSc, PgUp, …) + hex/decimal targets. Note: the keymap carries
  **66 physical keys** + the Fn marker — the "M68" name is not a key
  count (the vendor's customLed XML covers only a 37-key subset).
  (Earlier builds remembered light per profile on `light` commands —
  removed once P2 showed profiles are an XML-only concept.)

## Feasibility verdict

**HIGH.** The 0x18 upload is write-only interrupt-OUT traffic on the
same hidraw channel the CLI already drives (`HidrawTransport`,
exactly-64-byte frames, pacing). No new transport, no new deps. The
entire Download sequence is byte-known:

```
0x18 seg[2]=0  active keymap   132 × 4B entries, 14/packet, 10 pkts (last 6)
0x18 seg[2]=2  pristine default map   (byte-identical in usb7 + usb8)
0x19           SeniorKey/DKS banks   10 × 256 B, all-zero when unused
0x22           unnamed bank          40 × 50 B = 2000 B, all-zero
```

(0x19 = the SDK's "Write SeniorKey (DKS)" command, app 0x18 → wire
0x19, notes/04. 0x22 = app 0x2A → wire 0x22, role unknown — replay
zeros.)

Three small unknowns, each settled by a cheap VM probe (below):

1. Does the device ACK/echo upload frames? (The WinDbg bp only logged
   OUT writes; the CLI must either drain ACKs or ignore reads.)
2. Is the app's Sleep(400) between packets required, or does the
   project's ~100 ms pacing rule suffice?
3. Are seg[2] + the two zero banks required, or does seg[0] alone
   commit the keymap?

## The profile model (what "profile" means here)

Evidence:

- The app has 3 profiles; its Download uploads ONLY the active
  profile's keymap (usb8: profile 1's edit absent once profile 2 was
  active; profile switch sends **zero** frames — usb5/usb6).
- No wire command to switch or read a profile is known. The SDK's
  XML layer claims "profiles stored on the device, transferred as
  text/XML" (notes/03), but the wire shows compiled binary keymaps
  and nothing profile-ish beyond seg ids 0/2.
- Lighting: the app scopes light config per profile in its XML
  (`AddProFileLightInfoItem`), but the 0x07 commit register is a
  single slot and profile switches send nothing — so per-profile
  lighting may be app-side only. UNVERIFIED (probe P2).

Working model (what the CLI builds on): **profiles are local state
(app-side XML); the device holds whatever was last uploaded.** The
CLI keeps 3 local profiles (keymap + light config + custom pattern,
mirroring the app's XML), and "using" a profile = making its data
the CLI's defaults + uploading its keymap on demand. This matches
every wire-verified fact; if probe P2 finds a device-side profile
register, we add it as an optional read.

## CLI surface (proposed)

```
keymap show [--profile N]            print profile N's map (68 keys, names)
keymap set KEY=TARGET [KEY=TARGET …] edit profile N (opType 0 remaps only,
  [--profile N] [--upload]           target = any label-map key)
keymap reset [--profile N]           back to stock
keymap upload [--profile N]          app-equivalent Download (full sequence)
profile list|use N|current           local profile switching
profile import <file>|export <file>  the app's Profile XML format
light … [--profile N]                store/commit light config per profile
```

- `--profile` numbering: **0-based** (user decision 2026-11-19):
  CLI 0/1/2 = the app's profiles 1/2/3. Default: **0 (profile 1)**
  unless probe P2 finds a profile register — then `profile current`
  reads it and omitted `--profile` means "current" (the user's
  preferred default).
- Profiles stored in the VM as the app's Profile XML (interop with
  the app's files; `decode.js` already parses customLed, keyEvent
  parsing is a small addition). CLI-only edits default to a
  `~/.m68/profiles.xml` seed if no app XML is given.
- Keymap compile (XML → 132 entries) is trivial and wire-verified:
  stock identity map (byte-exact from usb7 seg[2]) + for each
  `keyEvent` item with operateType=0: `map[keyCode] = Value`. The
  goal binding round-trips: PgUp (75) → 0x46 at slot 82. Fn slot 121
  stays `01 00 00 00` always.
- First cut supports operateType 0 (remap-to-key) only. Media/mouse/
  macro/DKS encodings are unverified on the wire — later, via a
  third capture or RE (the app's multimedia tab wasn't found in the
  UI either).

## Probes (Linux VM, ~15 min, before finalizing defaults)

- **P0 — ACK check:** OPEN. After an upload, short-timeout reads until
  quiet; count + dump any reports. Decides drain-vs-ignore. (The CLI
  drains either way, so this is informational.)
- **P1 — minimal upload:** OPEN. `keymap upload --minimal` exists
  (seg[0] only). The clean isolation test is still to run:
  reset→stock→replug→minimal→test→replug. If seg[0] alone commits +
  persists, the upload drops from ~17 s to ~4 s.
- **P2 — profile register hunt:** CLOSED (2026-11-19). Board-side
  profile switch left every known register byte-identical — no
  device-side profile state. `--profile` defaults to the store's
  current (0).

## Work breakdown

1. **protocol**: `STOCK_KEYMAP` (132×4B constant) + key/label name
   table (68 keys + label-map targets, HID names); `uploadKeymap()`
   (0x18×2 + 0x19 + 0x22, pacing, optional drain); keyEvent XML
   parse/compile.
2. **cli**: `keymap` + `profile` commands, `--profile` plumbing on
   `light`; profile store (`~/.m68/profiles.xml` or imported app XML).
3. **VM probes P0–P2**; fold results into defaults.
4. **Live validation**: replay usb7's exact goal binding (PgUp→PrtSc)
   from the CLI, byte-diff the generated frames against usb7.log;
   then P1's minimal variants.
5. Notes/11 + this file updated with probe outcomes.

## Risks

- Replaying uploads with wrong pacing/order could leave the firmware
  mid-stream — mitigations: app-faithful replay first, 400 ms pacing
  default, never unplug mid-upload (factory-reset risk, notes/07).
- If the device turns out to store per-profile keymaps and seg ids
  map to slots differently than "active + pristine", a third capture
  with Fn-combo switching settles it before any CLI work lands.
