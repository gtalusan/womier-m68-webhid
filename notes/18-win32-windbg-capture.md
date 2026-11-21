# 18 — Win32 target & WinDbg capture method

The vendor software at the center of this project is a **32-bit Win32
application**. The bitness was already implicit in the file headers
(notes/01) and the DLL description (notes/03), but it drives the whole
RE workflow, so this note records it explicitly — together with the
WinDbg technique used to capture every HID report the app writes on
the config paths.

## The target is Win32 (x86), not x64

| Piece | Evidence |
|---|---|
| Installer `M68_HE_Software_V2.exe` | PE32 GUI, **i386 (32-bit)** (notes/01) |
| `M68.exe` | Qt 5 GUI app, 32-bit; WinDbg loads it from `C:\Program Files (x86)\M68\` |
| `witmodSdk.dll` | **32-bit**, preferred image base `0x10000000` (notes/03) |
| `jl_firmware_upgrade_x86.dll` | 32-bit flasher (notes/05) |
| Transport | `hid.dll` + `setupapi.dll` → `CreateFileW` / `WriteFile` on a raw HID collection |

Consequences:

- Use the **x86 WinDbg** (32-bit user mode), not the x64 debugger. The
  transcripts' prompts are `0:008>` … `0:023>` — a 32-bit user-mode
  session.
- Module offsets are 32-bit **RVAs**: `witmodSdk+343f` means VA
  `0x1000343f` at the preferred base, which is also where Ghidra maps
  the DLL.
- Function arguments follow the x86 stack convention (stdcall/cdecl),
  so a buffer pointer can be found by reading the **ESP register** and
  then dumping memory at that pointer — the technique below.

## Why break on WriteFile instead of a USB sniff

The HID traffic is produced deep inside a closed-source Qt GUI. A
user-mode breakpoint on the SDK's report-write wrapper yields exactly
the bytes handed to `WriteFile` — after the app→wire remap — without a
kernel driver or USB filter. It also preserves the report boundaries
(64 bytes) as the app itself sees them.

Device→host traffic is *not* visible at this breakpoint; replies were
verified separately from the device's own responses/register readbacks
(and usbmon on Linux for the 65-byte wedge, notes/09).

## The breakpoint

`witmodSdk.dll + 0x343f` is the `call WriteFile` inside
`FUN_100033d0`, the SDK's report-write wrapper. Its callers are:

- `CWitmodHid_HidWriteBuff` (0x8360) — every normal report write; it
  builds a fresh 64-byte buffer and remaps the app-internal command
  into it before calling the wrapper.
- `CWitmodHid_GetHidAndFirmwareInfoStu` (0x71b0) — the device-info
  handshake.

(The firmware flasher, `CWitmodHid_FirmwareUpgrade`, calls `WriteFile`
directly with its own 0x40-byte writes; those are not covered by this
breakpoint.)

Disassembly at the breakpoint (`objdump -d` on the extracted DLL):

```
10003435  8d 45 e4              lea  eax,[ebp-0x1c]          ; &overlapped
10003438  50                    push eax
10003439  6a 00                 push 0                       ; lpNumberOfBytesWritten = NULL
1000343b  53                    push ebx                     ; nBytesToWrite (0x40)
1000343c  57                    push edi                     ; lpBuffer
1000343d  ff 36                 push dword ptr [esi]         ; hFile
1000343f  ff 15 34 a0 02 10     call dword ptr [0x1002a034]  ; WriteFile
```

WinDbg stops **before** the call executes, so all five stdcall
arguments are already on the stack. The top of the stack holds `hFile`;
`[esp+4]` holds `lpBuffer`; `[esp+8]` holds the length (`0x40` = 64).
Hence:

```
db poi(esp+4) L40
```

means “dereference the pointer in the `[esp+4]` stack slot and dump 0x40
bytes.” The pointer is a per-call heap buffer, so the printed address
changes on every hit; the 64 bytes it points at are the wire report.

## The session recipe

All captures used the same recipe. The transcript shape:

```
0:008> bp witmodSdk+343f "db poi(esp+4) L40; g"
bp witmodSdk+343f "db poi(esp+4) L40; g"
0:008> g
02d5b484  01 0d 00 00 00 00 00 00-00 00 00 00 00 00 00 00  ................
02d5b494  00 00 00 00 00 00 00 00-00 00 00 00 00 00 00 00  ................
...
```

Recipe:

1. Start `M68.exe` and let it enumerate/open the keyboard.
2. Attach the **x86** WinDbg to the process (or launch it under WinDbg).
3. `.logopen <path>\capture.log` to record the output.
4. `bp witmodSdk+343f "db poi(esp+4) L40; g"` — the embedded `g`
   resumes automatically after each dump.
5. `g` to run.
6. Drive one feature per capture (commit a mode, move sliders, click
   Download, flip custom-light checkboxes, switch profiles) so the log
   is attributable.
7. `.logclose`; repeat.

An early capture tried `dd poi(esp+8) L4` (the length argument) before
settling on the `db poi(esp+4) L40` form used by the later captures.

## Parsing

`tools/parse_windbg.py` reads a `.logopen` transcript, re-groups the
`db` lines into 64-byte frames, counts the wire commands, and
reassembles 0x18 uploads by segment and packet:

```
python3 tools/parse_windbg.py capture.log
```

## What the captures established

| Capture group | Feature exercised | Result | Notes |
|---|---|---|---|
| lighting | info query, register read, mode commits, sliders/direction/full-color | session sequence + 0x07 commit + mode ids | notes/09, 10 |
| custom layer | custom-light checkbox flips + a full profile switch | **zero** 0x18 frames, only 0x0f preview streams → custom layer is RAM-only | notes/10 |
| keymap Download | Download button after remapping PgUp→PrtSc | 0x18 seg0/seg2 keymap + 0x19 macro bank + 0x22 DKS bank | notes/11, 14 |
| second keymap | profile 2: PgDn→Home, Insert→F12 | active profile map on seg0; seg2 identical (Fn layer) | notes/11 |
| HE parameters | polling + debounce (0x21 sub 9/10) | parameter replies | notes/16 |

## Caveats

- Breakpoints pause the app; animations and Qt timers stall while the
  debugger is stopped. Continue promptly (`g`) so the UI behaves
  normally.
- The dumped address is a process-virtual heap pointer, not a device
  address; only the 64 bytes matter.
- The buffer is post-remap: `HidWriteBuff` rewrites the app-internal
  command into `[1]` before the wrapper is called. That is why wire ids
  can differ from the app's internal effect ids (notes/10).
- The wrapper pads short writes up to the report size if needed
  (`FUN_100033d0` mallocs + zero-fills when `param_3` is below the HID
  caps); both normal callers pass `0x40`.
- If the report size ever changes, `L40` and the parser's 64-byte frame
  length must change together.
- This is host-side write truth only. Device replies were read back
  through the protocol itself (register readback, mode list, etc.) and,
  on Linux, usbmon.
