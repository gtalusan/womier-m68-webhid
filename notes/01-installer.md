# 01 — Installer analysis & unpacking

File: `M68_HE_Software_V2.exe` (15,576,167 bytes)
SHA-256: `cfd8afa7d4ce2a18e711aea1f09479b43664b3a7646c3ae031fa41f9b881508d`
Type: PE32 GUI, i386 (32-bit)

## Structure

| File offset | Content |
|---|---|
| 0x0000 – 0x2CDFF | **Inno Setup loader stub** — Delphi binary (PE sections: `.text` 0xf400, `.itext`, `.data`, `.idata`, `.rsrc` 0x1a600). Delphi markers `DVCLAL` + `PACKAGEINFO` in resources. `PACKAGEINFO` lists Inno units: `SetupLdr`, `RedirFunc`, `7PathFunc`, `CmnFunc2`, `InstFunc`, `MsgIDs`, `Compress`, `SHA1`, `Messages`, `MD5`, `SetupEnt`, `LZMADecompSmall`, `SafeDLLPath` … |
| 0x2CE00 – 0xE6EF38 | **Compressed setup payload** (~14.3 MB). Starts with bytes `7a 6c 62 1a` ("zlb" + 0x1a) = Inno Setup's zlib variant header, high entropy after. |
| 0xE6EF39 – EOF | **Inno Setup data header**: magic `Inno Setup Setup Data (5.5.7) (u)` + NUL, 8 zero bytes (unknown), CRC + offsets into the payload, then trailing metadata. |

Imports of the stub are the classic minimal Delphi loader set
(kernel32/user32/advapi32/oleaut32) — nothing USB-related.

## Extraction

`innoextract` (Homebrew) unpacks it directly:

    innoextract -s -d extracted/app M68_HE_Software_V2.exe

Result: 114 files. The interesting ones (all in `extracted/app/app/`):

| File | Size | Role |
|---|---|---|
| `M68.exe` | 6.89 MB | The keyboard config app — Qt 5 (Qt5Core/Gui/Widgets/Multimedia/Network/Svg), MSVC runtime, exports 74 `_cJSON_*` symbols (bundled cJSON) |
| `witmodSdk.dll` | 284 KB | **Vendor SDK** — all HID comms + XML profile handling. Exports `CWitmodHid_*`, `CWitmodXML_*` (see note 03) |
| `jl_firmware_upgrade_x86.dll` | 305 KB | Firmware flasher for **JL-chip** devices (VID `4A4C`). Exports `JL_upgradeDevice`, `JL_queryDevicePidVid`, `JL_loadUfwData`, … (see note 05) |
| `fftreal.dll` | 19.5 KB | FFT (audio-reactive lighting) |
| `hidImages/Keyboard_X82HERGB.png` | 1 MB | Layout image for the X82 HE RGB family (our M68 = X82 68-key) |
| `translation/*.qm` | — | Qt translations (EN/ZH/… 14 languages) |
| Qt5*.dll, api-ms-win-*, msvcp*, opengl32sw.dll | — | Qt 5 runtime + MSVC CRT + software GL, bundled for Windows-only deployment |

## Why this matters

The installer itself holds no protocol logic — it's a plain Inno wrapper.
Everything of interest is in `M68.exe` + `witmodSdk.dll`
(+ `jl_firmware_upgrade_x86.dll` for flashing).
