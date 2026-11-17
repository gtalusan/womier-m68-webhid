# 08 — Live protocol validation (Linux VM + live web-app tests)

Every claim here was observed on the real board.

## Load-bearing rules

- **Exactly 64-byte reports.** A 65-byte interrupt OUT splits into
  64+1 on the wire and wedges the firmware's OUT endpoint state
  machine until replug. (This was the root cause of every wedge in the
  project's history.) `packages/protocol`'s `buildFrame()` validates
  length; the web app builds frames in fixed 64-byte arrays.
- **Pace commands** (~100 ms between writes), like the app's worker.
- **Never unplug mid-stream** — cutting power during the 0x0F stream
  factory-resets the device (boots to Wave/red + rainbow grid).
- **Commits persist across clean power cycles.**

## Confirmed responses (64-byte frames, echo = cmd)

| wire | Query | Response |
|---|---|---|
| 0x0D | handshake | `M484,20,KB,FQ,X82HERGB,V1_11_05` (CSV at resp[6]), then build date `Mar 26 2024,11:06:05` |
| 0x15 | serial | hex-ASCII SN at resp[6] |
| 0x0A | light modes | 15 effect IDs + `a5 5a 04 04` |
| 0x07 | light config | `[5]=0x0c`, register at resp[6..17] (notes/09) |
| 0x0E | custom layout | 22 flag bytes |
| 0x21 | HE sensitivity | `[6]=sub`, `[7]=value` |

## Mode commit + register

The one command that matters: `01 07 00 00 00 0e <mode> <brightness>
<speed> <fg R,G,B> <bg R,G,B> <direction> <fullcolor> 00 00 …` — the
full verified layout, mode table, and register format live in
notes/09 (canonical).

## Per-key grid stream (0x0F) — usb6-verified framing

Startup (from the app's own capture): side grid (chunk 0 twice +
chunk 1) → keepalive `01 01 00 00 00 01` → light-sync
`01 17 00 00 00 01 01` → grid cycles. Grid: group 0 = keyboard,
132 slots × RGB (396 B, chunks 0..7 = 7×54+18); group 1 = side, 33
slots (99 B). Slot = row*22+col = the profile XML's `indexX/indexY`.
The stream needs a committed brightness > 0 to render.

The grid is **RAM-only**: shows while streaming, dies on power loss.
The vendor app behaves the same way — its custom patterns are not
persisted either (WinDbg captures of checkbox flips and profile
switches contain zero 0x18/0x09 writes).

## Still open (not needed for lighting config)

- Sleep-time (0x14) unit semantics; HE sensitivity value scales; the
  22 custom-layout flags (0x0E); the 0x0A list's extra id 0x11
  (renders dark; uncharacterized).
