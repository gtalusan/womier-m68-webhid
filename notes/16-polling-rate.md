# 16 — Polling / report rate (0x21 sub 9)

Status: **CLI implemented and live-tested**, including
persistence across a physical replug and USB endpoint-interval
measurement. Still TODO: characterize what the rate setting actually
throttles (the endpoint descriptor does not change) and any
125/250/500 probe.

## What the vendor app does

`M68_HE_Software_V2.exe` has a **“Rate return”** control on the
Trigger/HE settings page (DTriggerSettingPage). The Chinese UI calls it
**回报率** — the report/polling rate. It has four positions:

| UI label | wire value |
|---|---|
| 1K | 1 |
| 2K | 2 |
| 4K | 4 |
| 8K | 8 |

The slider slot `FUN_004d0980` maps slider index 0..3 → 1/2/4/8;
the DDevicePage slot `FUN_0046ef20` builds the setter frame. The SDK
(`CWitmodHid_HidWriteBuff`) remaps app cmd `0x29` → wire `0x21`.

This app does **not** expose 125/250/500 Hz. Those appear only in the
M68HE **PRO** manual, which describes a different device/protocol
(gen2, `qmk.top` web driver). Do not assume this firmware accepts them.

## Wire frames (64 bytes, always)

```
query:  01 21 00 00 00 18 09 00 00 …
set:    01 21 00 00 00 18 09 01 <code> 00 …
reply:  … bytes 6=09, 7=<code> …       (response shape: notes/08)
```

- `[5]=0x18`, `[6]=9` (sub-param), `[7]=0` query / `1` set,
  `[8]=code` (1/2/4/8 = 1K/2K/4K/8K).
- The app sends the query at connect alongside sensitivity (`[6]=4`)
  and anti-shake (`[6]=0x0a`): usb3.log lines 51–61, usb7.log.
- Response parser: `M68.exe` FUN_00460630, branch `raw[1] == 0x21`,
  `raw[6] == 9` → `raw[7]` = code (FUN_00413b40 stores it).

### Don’t confuse the 0x21 sub-params

| `[6]` | setting |
|---|---|
| 4 | HE sensitivity |
| 9 | **polling / report rate** (this note) |
| 10 | key anti-shake |
| 5 | dynamic-display sensitivity query |
| 6 | default/reset sensitivity |

## CLI

```
m68ctl rate                  # query: { sub: 9, code: 1, hz: 1000 }
m68ctl rate set 8k           # send code 8
m68ctl rate set 4000         # same, Hz form
m68ctl rate set 500          # rejected: vendor app has no 500 Hz code
```

Protocol helpers: `M68Session.rate()` and `setRate(code)` in
`packages/protocol/src/session.js`; `decode.decodeRate()` maps
code → Hz. `setRate` writes `[7]=1 [8]=code`, waits 300 ms and
best-effort drains one ACK (the vendor app never reads a reply).

## Web app

`web/index.html` has **Device → Polling rate** (1K/2K/4K/8K). On
connect it sends the query; a click sends the setter and the board's
reply updates the selection. Simulator mode starts at 8K and exercises
the same UI. Frame-level checks in the browser: the 63-byte WebHID
body is `21 00 00 00 18 09 01 <code> …` (wire `01 21 …`), and the
reply parser uses data[5]=sub 9, data[6]=code. **Live WebHID test is
pending** — the board was passed through to the Linux VM, so macOS
could not see it.

## Live test results (Ubuntu VM)

Board: Womier M68 HE, VID 0416 / PID 7372, X82HERGB / V1_11_05.

- Initial readback: **sensitivity (sub 4) = 40, rate (sub 9) = 8
  (8000 Hz), anti-shake (sub 10) = 3**.
- `rate set 4k` → `rate` returned `{code:4, hz:4000}`.
- `rate set 8k` → `{code:8, hz:8000}`.
- `rate set 1k` → `{code:1, hz:1000}`; `rate set 2k` →
  `{code:2, hz:2000}`.
- **Persistence:** set 4k, physically unplugged/replugged the board,
  then `rate` still returned `{code:4, hz:4000}`.
- Restored to **code 8 (8000 Hz)**, the value found at the start.
- The vendor UI’s “1K” label is only the widget’s initial text; the
  board was actually at 8K before any CLI write.
- `session` now prints the three HE params separately
  (sensitivity / rate / anti-shake).
- The setter’s 500 ms ACK drain did not interfere with the following
  readback; whether the device actually sends an ACK was not isolated.
- **USB endpoint interval (sysfs):** the board enumerates at **USB 2.0
  high speed (480 Mbps)**. At **8K** every interrupt endpoint —
  ep_81 keyboard IN, ep_82 mouse IN, ep_04 vendor OUT, ep_83 vendor IN
  — advertises **`bInterval=1` → 125 µs**. After setting **1K**, every
  endpoint still reads **`bInterval=1`/125 µs** and the device does not
  re-enumerate (same devnum).
  → **The rate setting does not change the USB polling interval.**
- **Vendor query round-trip (8K vs 1K):** 25 write→read samples each on
  hidraw6 — 8K min/avg/max = 385/1209/1551 µs; 1K =
  347/1272/1609 µs. Statistically identical → the setting does not
  gate the vendor report path either.
- **The keyboard IN interface is event-driven:** no idle reports over
  3 s; holding a key produced a single report on press (hidraw5 /
  input1) and nothing periodic. No controllable rapid state-change
  source was available, so the key-report/scan cadence could not be
  measured directly.
  → Best characterization: the setting controls the **internal HE
  scan/report-generation rate** (how often key-state changes are
  sampled and queued), not the USB endpoint interval. The host polls
  at 125 µs in both modes; if the firmware only has new key data every
  1 ms at 1K, the extra polls are NAKs.

## Remaining TODO

1. Directly measure the scan/report cadence with a controllable rapid
   key-state source — e.g. a validated onboard macro with repeat, or a
   signal-driven magnet — and timestamp hidraw5 reports at 8K vs 1K.
2. Only if desired: probe whether 125/250/500 are accepted as other
   codes. The CLI deliberately rejects them; restore a known value
   afterwards.
3. Anti-shake and sensitivity setters are not implemented — we have
   read-only queries for sub 4/10. Their set frames would follow the
   same `[7]=1 [8]=value` shape.
4. Live-test the web app’s Device → Polling rate row over WebHID
   (Chrome/Edge on macOS, with the board released from the VM). The UI,
   simulator, setter frame, and reply parser are verified; the real
   browser→device round trip is not.

## Also open

- Does the device ACK the setter? We drain one report for 500 ms but
  have not confirmed.
- Is the setting device-wide or per-profile? The vendor app exposes
  no profile dimension for it, so assume device-wide until tested.
- The app also has a `rateOfReturnNumDel` slot; not investigated.
