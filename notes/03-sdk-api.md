# 03 — witmodSdk.dll API surface

`witmodSdk.dll` = the vendor SDK ("Witmod" ≈ Womier module). C ABI
(`__cdecl`), exports grouped by prefix. All addresses are image RVAs
(preferred image base 0x10000000, DLL is 32-bit — the whole target is
32-bit Win32; see notes/18 for the platform and WinDbg capture method).

## HID / device layer (`CWitmodHid_*`)

| Export | RVA | Purpose |
|---|---|---|
| `CWitmodHid_Init` | 0x8650 | enumerate + open HID device, store handle/caps — **contains the 2030 time-bomb**: refuses to initialize once `(int)time64() ≥ 0x70DB6800` (2029-12-31 16:00 UTC = 2030-01-01 00:00 CST); the vendor app stops finding the keyboard after that. Decompiled ✅ (`ghidra-out/CWitmodHid_Init_10008650.c`, README callout) |
| `CWitmodHid_Close` | 0x6d10 | close handle, cleanup |
| `CWitmodHid_OpenPath` | 0x8790 | open a given device path |
| `CWitmodHid_SetNonblocking` | 0x87b0 | overlapped/async toggle |
| `CWitmodHid_HidWriteBuff` | 0x8360 | **send report** — app→wire cmd remap + the `buf[5]<0x3B` gate (decompiled ✅) |
| `CWitmodHid_HidReadBuff` | 0x8330 | **read report** |
| `CWitmodHid_FirmwareUpgrade` | 0x6d40 | firmware update flow (decompiled ✅ — notes/04) |
| `CWitmodHid_GetHidAndFirmwareInfoStu` | 0x71b0 | device info handshake — CSV + build date (decompiled ✅) |
| `CWitmodHid_GetSupportInfoList` | 0x82c0 | returns the supportHidList JSON |
| `CWitmodHid_GetHidInfoList` | 0x7d70 | returns hidInfoList JSON |
| `CWitmodHid_GetHidInfoStuMapList` | 0x82a0 | layout info map |
| `CWitmodHid_SetKeyboardColorInfoDataStu` | 0x105e0 | keyboard light-config state + preview dispatch (decompiled ✅ — notes/10) |
| `CWitmodHid_SetKeyboardColorInfoDataStuHaveChanged` | 0x107f0 | changed-only variant |
| `CWitmodHid_SetSideColorInfoDataStu` | 0x10920 | side RGB config → reports |
| `CWitmodHid_SetSideColorInfoDataStuHaveChanged` | 0x10ae0 | … |
| `CWitmodHid_keyClickedSendXY` | 0x10c10 | per-key click → preview state |
| `CWitmodHid_keyboardLightColorRuning` | 0x110c0 | animation/preview running state |
| `CWitmodHid_lightColorMix` | 0x110e0 | color mixing helper |
| `CWitmodHid_sideLightColorRuning` | 0x112d0 | side light running |
| `CWitmodHid_GetCurrentRippleLightColor` | 0x10560 | query ripple color |
| `CWitmodHid_GetCurrentAutoRippleLightConfig` | 0x10530 | query auto-ripple config |
| `CWitmodHid_GetSideCollisionLightRuningConfig` | 0x105c0 | side collision light config |
| `CWitmodHid_highPrecisionTimer{Init,Start,Stop,Runing}` | 0x4bb0/0x4ce0/0x4d00/0x4c50 | QPC-based timing for animations |
| `CWitmodLight_Init` | 0x112f0 | light engine init |
| `CWitmodSDK_VersionStr` | 0x1b700 | SDK version string |

## XML profile layer (`CWitmodXML_*`)

`CWitmodXML_Init`, `CreateXMLFile`, `ProFileImport/Export`, macro editing
(`AddKeyOrMouseEventItem`, `AddProFileBindMacroItem`), lighting profiles
(`AddProFileLightInfoItem`, `CustomLight*`), DKS ("dynamic keystroke")
`SeniorKey_*` — these operate on the **onboard profile XML** format the
app exchanges with the keyboard (profiles stored on the device, transferred
as text/XML over HID). `CWitmodXML_IsSupportHid` gates device support.

## Imported Windows APIs

- `hid.dll`: `HidD_GetAttributes`, `HidD_GetPreparsedData`, `HidP_GetCaps`,
  `HidD_SetNumInputBuffers`, `HidD_SetFeature`, `HidD_GetFeature`,
  `HidD_GetSerialNumberString`, `HidD_GetManufacturerString`,
  `HidD_GetProductString`, `HidD_GetIndexedString`, `HidD_FreePreparsedData`
- `setupapi.dll`: `SetupDiGetClassDevsW`, `SetupDiEnumDeviceInterfaces`,
  `SetupDiGetDeviceInterfaceDetailW`, … (HID GUID = `HIDClass`)
- `kernel32`: `CreateFileW`, `WriteFile`, `GetOverlappedResult`, `CloseHandle`
- also `winmm` (timeBeginPeriod for timers), `ws2_32`

→ **Protocol transport is HID feature reports / output reports** on the
raw-HID top-level collection, not serial, not WinUSB.
