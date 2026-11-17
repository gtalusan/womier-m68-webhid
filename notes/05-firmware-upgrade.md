# 05 — Firmware upgrade

## Two upgrade paths ship with the app

| Path | DLL | Devices | Transport |
|---|---|---|---|
| **M484 (our M68 HE)** | `witmodSdk.dll` → `CWitmodHid_FirmwareUpgrade` | VID 0416 (also 1FC9 QN9080 etc. — same SDK) | HID output/input reports, 64 B |
| **JL chip** | `jl_firmware_upgrade_x86.dll` (`JL_upgradeDevice`, `JL_loadUfwData`, `JL_getUfwCrc`…) | VID 4A4C | its own protocol, `JLUFW` magic, `.ufw` images — **not needed for M68 HE** |

## M484 upgrade protocol (from decompilation of `CWitmodHid_FirmwareUpgrade`)

1. **Enter bootloader**: M68.exe sends `{1, 0x0A, 0…}` (app cmd 0x0A → wire
   0x0B, debug `"Into firmware"`).
2. Read firmware file into memory; chunk into **48-byte (0x30) blocks**.
3. Per chunk, write 64-byte output report:

   | off | value |
   |---|---|
   | 0 | 1 (report ID; col06 → 6) |
   | 1 | 0x0C (wire cmd) |
   | 2 | 0 |
   | 3–4 | 16-bit chunk index (big-endian; ≥0x100 encoded via 4-hex-digit string split into 2 bytes) |
   | 5 | chunk length + 2 (0x32 = '2' for full chunks) |
   | 6… | **bitwise-inverted** (`~`) firmware bytes |
   | 0x30, 0x31 | 2 random bytes in 1..200 (first-chunk-with-flag variant: `0xFF, 0x00`) |

4. Blocking 64-byte read after each chunk; ACK at `resp[2]`: **0 = OK**,
   1 or 2 = abort. Progress callback after each chunk.
5. Final report: `{1, 0x0C, param5, 0xFF, 0xFF, 0x32, 0…}` → device
   flashes and reboots.

Notes:
- The whole file is sent in one continuous sequence; no separate erase
  command — the `0xFF,0x00` first-chunk marker is the erase signal.
- Firmware image is raw binary (file read whole; size passed in).
- JL DLL also exposes `JL_setPcModeWaitTime`, `JL_setResetWaitTime` —
  "PC mode" concept for JL devices; M484 path has no such step.
