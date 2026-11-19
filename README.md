# M68 HE — cross-platform configuration project

Reverse-engineered the Womier M68 HE (VID 0416 / PID 7372, Nuvoton M484,
board `X82HERGB`, FW V1_11_05) config protocol from the Windows-only
software, and built two working configurators: a **browser web app**
(any OS, no install) and a **Linux CLI**.

## The web app — `web/`

**M68 Light Studio** — live at
<https://gtalusan.github.io/womier-m68-webhid/> — is a full keyboard
configurator that runs in the browser and drives the real board over
WebHID:

- **All 15 light effects** with the vendor app's exact parameter set —
  brightness/speed (5 steps), foreground/background colors, full-color,
  and the per-mode direction buttons
- **Faithful keyboard render** — keycaps drawn from the vendor's own
  per-key geometry (`KeyInfo_X82HERGB.config`): real widths, stagger,
  labels, and the board's exact proportions
- **Key remapping** — click a cap and pick a target from the tray
  (keys, F-row, nav, mods, media, mouse) or click a second cap to
  swap; staged per profile, upload replays the app's byte-verified
  Download sequence
- **Profiles as tabs** — each profile holds its own keymap *and*
  light settings; export/import the store as JSON, or import the
  vendor app's Profile XML
- **Press-driven effects actually react to typing** — Reactive, Ripple,
  Cross, Fireworks, Speed Respond light up from keypresses on the page
  itself
- **One 64-byte commit per change** (the firmware wedges on any other
  length — enforced), paced at the app's cadence; commits persist
  across power cycles
- **Register readback on connect** — the UI hydrates to whatever the
  keyboard currently has, and locks itself until a board is attached
- Effect animations follow the device's verified behavior: fg/bg roles
  per mode, full-color cycling, direction semantics (Wave, Radar,
  Striation, Aurora, Speed Respond)

Run it locally: `cd web && python3 -m http.server 8000`, open
`http://localhost:8000`, click **Connect keyboard**. Chrome or Edge
required (WebHID); GitHub Pages-ready — the workflow in
`.github/workflows/pages.yml` deploys `web/` on every push to `main`.

See `web/README.md` for details, browser support, and asset provenance.

## The CLI — `packages/cli` (Linux)

```
./tools/vm-run.sh light static 0000ff    # blue, persists across power cycles
./tools/vm-run.sh light static ff0000    # red
./tools/vm-run.sh light neon --brightness 4 --speed 3 --fg ff0000 --bg 0000ff
./tools/vm-run.sh light neon --full-color --fg ff0000 --bg 0000ff
./tools/vm-run.sh light mode breath      # switch mode by name
./tools/vm-run.sh light off              # brightness 0
./tools/vm-run.sh info                   # model/FW/serial
./tools/vm-run.sh session                # full verified demo
```

`light neon|breath|wave|twinkle|radar|autoripple|ripple|striation|aurora|
reactive|cross|fireworks|speedrespond|custom` — each with the app's
controls (`--brightness 0-4`, `--speed 0-4`, `--fg/--bg RRGGBB`,
`--full-color`, `--direction` per mode) — plus `light custom-stream`
for live XML-driven custom patterns.

**Key remapping** (wire-verified upload; profiles are an XML concept,
0-based):

```
./tools/vm-run.sh keymap set PageUp=PrintScreen Insert=Play/Pause --profile 0
./tools/vm-run.sh keymap upload --profile 0   # the app's full Download sequence
./tools/vm-run.sh keymap show                 # grid + remaps
./tools/vm-run.sh keymap reset --profile 0    # clear the profile
./tools/vm-run.sh profile list                # 3 profiles, current marked
./tools/vm-run.sh profile import Profile2.xml # the app's own XML
```

Targets: any key name (`PageUp`, `PrtSc`…), `Play/Pause`, `Mute`,
`Vol+/-`, `Next/Prev/Stop`, `ScrollUp/ScrollDown`, `LeftClick/
RightClick/MiddleClick` — full operateType encodings in notes/14.

**The commit** — one 64-byte frame:
`[1]=0x07, [5]=0x0E, [6]=mode, [7]=brightness, [8]=speed, [9..11]=fg RGB,
[12..14]=bg RGB, [15]=direction, [16]=full-color, [17]=0` —
full layout in notes/10. Neon = mode `0x03` (app-register-verified;
device renders 0x03 as Neon).

## Platforms

- **macOS**: the **web app** is the route — Chrome/Edge WebHID drives
  the board with no driver (verified live). Native userspace IOKit is
  blocked by Apple's HID driver (notes/07); the Linux CLI runs through
  the Parallels VM (`tools/vm-run.sh`) when needed.
- **Linux**: web app (with the udev rule in `tools/99-m68.rules`) or
  `m68ctl` over hidraw.
- **Windows**: web app (Chrome/Edge) or the vendor app.

## ⏰ The SDK's 2030 time-bomb

The vendor SDK refuses to initialize once the system clock passes
**2030-01-01 00:00 CST** (2029-12-31 16:00 UTC) — after that, the
vendor's Windows app stops seeing the keyboard. `CWitmodHid_Init`
(witmodSdk.dll) gates its device enumeration on the system time.
Ghidra-verified (`ghidra-out/CWitmodHid_Init_10008650.c`):

```c
local_1c = _time64(0);
_Var2 = _time64(&local_1c);
if ((int)_Var2 < 0x70db6800) {   /* 0x70DB6800 = 2029-12-31 16:00:00 UTC */
  DAT_100442b0 = 1;              /* enabled — enumerate and open */
  ...
  return 0;
}
DAT_100442b0 = 0;                /* past the deadline */
return 0xffffffff;               /* Init fails — no device */
```

This project's own tools are unaffected — `m68ctl` and the web app
implement the protocol directly and never load the SDK.

## Notes

- [01 — Installer & unpacking](notes/01-installer.md)
- [02 — Device identification](notes/02-device-id.md)
- [03 — witmodSdk API surface](notes/03-sdk-api.md)
- [04 — HID protocol map (RE record)](notes/04-hid-protocol.md)
- [05 — Firmware upgrade](notes/05-firmware-upgrade.md)
- [06 — Platform status](notes/06-macos-driver.md)
- [07 — Live capture findings (macOS USB reality)](notes/07-live-capture.md)
- [08 — Live validation history](notes/08-live-validation.md)
- [09 — **Verified protocol (ground truth)**](notes/09-session-flow.md) ← the canonical reference
- [10 — NEON mode: verified frame layout (Ghidra RE)](notes/10-neon-mode.md)
- [11 — Key bindings: verified spec + plan](notes/11-key-remap-plan.md)
- [12 — Keymap CLI: feasibility plan + implementation log](notes/12-keymap-cli-plan.md)
- [13 — Web app: faithful render + remap UI](notes/13-webapp-faithful-render.md)
- [14 — Keymap entry encodings: all operateTypes](notes/14-keymap-entry-encodings.md)

## Software

- `web/` — M68 Light Studio (static site, no deps)
- `packages/protocol/` — verified command table, frame codec, decoders,
  session layer
- `packages/cli/` — `m68ctl` (Node, no deps)
- `tools/vm-deploy.sh` / `tools/vm-run.sh` — run in the Parallels VM
- `tools/` — Ghidra scripts, macOS probe evidence, udev rule
