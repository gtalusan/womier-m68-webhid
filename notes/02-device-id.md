# 02 — Device identification

## Our device

- **Womier M68 HE** (Hall-effect, 68 keys, HE RGB family)
- **VID = 0x0416** (Nuvoton Technology), **PID = 0x7372** — confirmed by user.
- MCU: **Nuvoton M484** (Cortex-M4F, USB FS device) — the SDK's device table
  names this entry `"M484"`.
- Software layout id: `"X82HERGB"` (shared with the Womier X82 HE RGB),
  `keyNum: 68`, `"likeName":"M68"`.

## Full device list baked into witmodSdk.dll (supportHidList JSON)

| VID | PID | SDK name | Chip |
|---|---|---|---|
| `1FC9` | `E8C7` | QN9080 Keyboard | NXP QN9080 |
| `1FC9` | `E8D8` | QN9080 Dongle | NXP QN9080 (2.4G dongle) |
| `4A4C` | `E987` | JL Keyboard | "JL" chip (VID = ASCII "JL") |
| `4A4C` | `E988` | JL Dongle | "JL" chip (2.4G dongle) |
| **`0416`** | **`7372`** | **M484** | **Nuvoton M484 — our M68 HE** |
| `1FC9` | `0091` | S5516 | NXP (S55 series) |

hidInfoList (layouts):

```json
{ "hidType":"keyboard", "addTime":"2024/04/10 PM", "transparentImg":0,
  "SizeWidth":0, "SizeHeight":0, "LanguageNum":31,
  "nucNum":"GDXXX XXX", "hidName":"X82HERGB", "keyNum":68,
  "productName":"", "likeName":"M68" }
```

(`nucNum:"GDXXX XXX"` is a GigaDevice placeholder used by other boards —
the M484 entry relies on `Vid/Pid` matching instead.)

## Enumerating the device

`witmodSdk.dll` enumerates HID devices with **SetupAPI**
(`SetupDiGetClassDevsW(GUID_DEVINTERFACE_HID, …)`, `SetupDiGetDeviceInterfaceDetailW`),
then matches **VID/PID** from `HidD_GetAttributes`, and opens the device
path (`\\?\hid#vid_0416&pid_7372&mi_xx#…`) with `CreateFileW`
(`GENERIC_READ|GENERIC_WRITE`, `FILE_SHARE_READ|FILE_SHARE_WRITE`,
`OPEN_EXISTING`, `FILE_FLAG_OVERLAPPED`).

Interesting: strings also contain `&mi_` filtering — the app may select a
specific interface (`mi_02`, `mi_03`, `col06`…) when the device is a
composite with multiple HID collections (keyboard + mouse + raw HID).
String `"mi_02...col06"` appears next to the hidInfoList JSON.

On macOS the equivalent enumeration is IOHIDManager
(`kIOHIDDeviceUsagePageKey`/usage) or IOKit matching on `idVendor`/`idProduct`;
the raw HID collection is reachable with `IOHIDDeviceSetReport` /
`IOHIDDeviceGetReport` (that's what hidapi does).
