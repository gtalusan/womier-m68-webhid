# 15 — Macros: how they work + implementation plan

Status: DECODED (2026-11-19) — the macro/DKS content formats and the
full Download pipeline are asm-verified (notes/14). Remaining:
wire-validation with a real macro, then the CLI/webapp compilers.

## The decoded model (notes/14 has the byte-level spec)

- **Binding**: macro-bound key = keymap entry `10 <keyCode>
  <slotIdx> 00`; slotIdx = the 0x19 bank slot (0..9). No checksum
  exists.
- **Bank**: wire 0x19 = the Macro-data list — 10 slots × 5 packets
  (58/58/58/58/24), sent inline during the keymap compile; unused
  slots are zero-filled after. Packet 0 carries an 8-byte header:
  `[7]=repeatNum−1`, `[9]=4×eventCount`.
- **Events**: 4 bytes each — `[value][flags][delay_hi][delay_lo]`.
  flags bit4 = down/up, bit0 = mouse/key. Delay = 16-bit big-endian
  (units unproven, likely ms). No per-step modifiers (combos = key
  down/up steps), mouse = left/right/middle buttons only (no wheel,
  no movement, no text).
- **DKS (wire 0x22)**: separate feature — 40 store slots, one
  50-byte report each (`17 <storeIdx> 00 00` entry), modes with
  key/combo actions + a /10 delay field.

## Capability answers (decoded, from the app's own model)

- **Delays between keypresses**: YES — each step carries a 16-bit
  big-endian delay (ms presumed).
- **Rapid fire**: YES via repeatNum (packet-0 byte 7 = repeat−1).
  No hold-to-repeat structure exists in the content.
- **Mouse inputs combined with keys**: YES, limited to the three
  buttons (left/right/middle) — no wheel, no movement.
- **Combos inside macros**: as separate down/up steps (no per-step
  modifier mask).

## Implementation plan

1. **Wire validation (one capture)**: record a macro in the app's
   macro editor (SDK exports prove it exists), Download under WinDbg
   (usb9.log), diff against the decoded format. Also settles the
   delay units (ms vs 10ms) by comparing recorded values to emitted
   bytes.
2. **CLI**: macro DSL (steps + delays + repeat) compiling to the
   248-byte content + slot allocator; extend `keymap upload` to
   include the macro bank (10 slots, zero-filled) and DKS bank
   (40 × 50B zero) exactly as the app does.
3. **Webapp**: mini step editor (down/up/mouse steps, delays,
   repeat) + the extended upload with progress.

## Risks

- The macro bank format may be firmware-version specific — validate
  against FW V1_11_05.
- The delay unit (ms vs 10 ms) is the one semantic unknown; the
  capture resolves it.
- Mid-upload unplug rule unchanged; existing locking/progress UX
  carries over.
