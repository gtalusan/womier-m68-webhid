# M68 Light Studio

A browser configurator for the Womier M68 HE keyboard (X82HERGB) — no
drivers, no install: open the page in Chrome, click **Connect
keyboard**, and every control drives the real board over WebHID.

## Run

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Or host the folder on GitHub Pages (it's a static site — just push and
enable Pages on the repo).

## Browser support

- **Chrome / Edge** — full support (WebHID).
- **Firefox / Safari** — the page loads and shows the effect previews,
  but cannot connect to the keyboard (no WebHID implementation).
- Linux users may need the udev rule in `../tools/99-m68.rules` for the
  device to be reachable.

## What it does

- **15 light effects** with the app's exact parameter set per mode:
  brightness/speed (5 steps), foreground/background colors, full-color,
  and the per-mode direction maps (all app-register-verified).
- **Live preview** on the real X82HERGB board image — including
  press-driven effects (Reactive, Ripple, Cross, Fireworks, Speed
  Respond): type on this keyboard and watch.
- **One 64-byte commit frame per change** (the firmware wedges on any
  other length — enforced in code). Commits persist across power
  cycles, same as the vendor app.
- **Register readback** on connect: the UI hydrates to the keyboard's
  actual state.
- **Polling rate** (device-wide 1K/2K/4K/8K): read back on connect and
  applied immediately through the HE-parameter command (0x21 sub 9).
- **Debounce / anti-shake** (device-wide 0–7) in the Device panel.
- **Per-key sensitivity** via Keys → Tune: read a key’s press/release
  values, apply new ones (0.1 mm steps), reset that key, reset all, or
  apply to all keys. The all-keys path reads every key once, groups by
  Quick Trigger pair, and preserves each key’s QT values. Board-side
  setting; the profile store does not hold it.

## Protocol credits

The wire protocol was reverse-engineered from the vendor's **32-bit
Win32** app (`M68.exe` + the 32-bit `witmodSdk.dll`) and verified live
against the device. The app was run under x86 WinDbg with a breakpoint
on the SDK's single report-write wrapper (`witmodSdk+343f`), dumping
each 64-byte buffer with `db poi(esp+4) L40` (method:
[notes/18](../notes/18-win32-windbg-capture.md)). Every mode ID, the
frame layout (mode/brightness/speed/fg/bg/direction/full-color in one
64-byte report), the direction maps, and the register readback format
were confirmed by reading the keyboard's own register after the vendor
app committed each mode.

## Assets

`assets/keyboard.png` is the vendor app's own X82HERGB keyboard
render, used the same way the app uses it: the app sets it as a
`border-image` on the keyboard frame (stretched to a 712×240 canvas)
and draws the per-key light on top. The page mirrors that — the image
fills the board, and each key overlay is the vendor KeyInfo cell
inflated by 3 units (the app's 34×38 cap-top paint rect) mapped onto
the same frame. The image therefore supplies the keycaps' 3D bevels
and the perspective black border around every lit key. Per-key
positions come from `assets/icons/images/configDir/KeyInfo_X82HERGB.config`
(the vendor's KeyInfo table).

## Custom patterns

Custom lighting on this board is RAM-only (the firmware has no persist
path for it — the vendor app streams it too). The page can carry the
same 0x0f stream; pattern data lives in the profile XML
(`customLed` nodes: `keyCode`, `indexX/Y`, `colorR/G/B`).
