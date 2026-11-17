# 06 — Platform status (final)

Where each platform stands after all verification.

## macOS

- Userspace IOKit cannot configure the keyboard: Apple's HID driver
  exclusively owns the interface, the firmware implements no EP0
  SET_REPORT/GET_REPORT (`IOHIDDeviceSetReport` times out — notes/07),
  and libusb can't claim it.
- **The working macOS path is the web app** (notes/08 + `web/`):
  Chrome/Edge on macOS drives the board over WebHID ✅ (verified live —
  connect, read the register, commit effects; everything the CLI does).
  No driver, no install.
- The Linux CLI path remains available through a VM with USB
  passthrough (`tools/vm-run.sh`), which is how the protocol was
  originally validated.

## Linux

- Full support via hidraw: `packages/cli` (`m68ctl`) — the reference
  implementation used to verify every protocol claim.
- Udev rule: `tools/99-m68.rules`.

## Windows

- The vendor app works natively; the web app (Chrome/Edge WebHID) is
  equivalent for lighting configuration.

## Support matrix

| | Web app (WebHID) | m68ctl CLI |
|---|---|---|
| macOS | ✅ Chrome/Edge | ❌ (VM only) |
| Linux | ✅ Chrome/Edge (udev rule) | ✅ hidraw |
| Windows | ✅ Chrome/Edge | — (WSL/VM with passthrough) |
