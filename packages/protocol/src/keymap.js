// M68 HE keymap — wire-validated 2026-11-19 against the app's own
// Download uploads (usb7/usb8.log, notes/11-key-remap-plan.md).
//
// The upload is a compiled 132-entry keymap, NOT the XML text:
//   132 fixed 4-byte entries, row-major 6×22 (row*22+col),
//   entry = `00 <keyCode> 00 00`  (uint32 LE = keyCode<<8)
//   keyCode = USB HID usage id; 0 = empty slot
//   ONE exception: slot 121 (r5c11) = `01 00 00 00` — the Fn marker,
//   preserved verbatim in every upload.
// Row 0 (slots 0..21) is zero padding; rows 1..5 are the 66 physical
// keys (+ the Fn marker at slot 121). The slot's stock value IS the
// key's HID usage id (identity).

export const MATRIX_ROWS = 6;
export const MATRIX_COLS = 22;
export const SLOTS = MATRIX_ROWS * MATRIX_COLS; // 132
export const FN_SLOT = 121; // r5c11 — marker entry `01 00 00 00`, not remappable

// Layout: one row per string, 22 tokens, `..` = empty slot.
// Hex = the key's HID usage id (== its stock keymap entry).
const LAYOUT = [
  ".. .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. ..",
  "29 1e 1f 20 21 22 23 24 25 26 27 2d 2e .. 2a .. 49 .. .. .. .. ..",
  "2b 14 1a 08 15 17 1c 18 0c 12 13 2f 30 .. 31 .. 4c .. .. .. .. ..",
  "39 .. 04 16 07 09 0a 0b 0d 0e 0f 33 34 .. 28 .. 4b .. .. .. .. ..",
  "e1 .. 1d 1b 06 19 05 11 10 36 37 38 .. e5 .. 52 4e .. .. .. .. ..",
  "e0 e3 e2 .. .. .. 2c .. .. e6 .. .. .. .. 50 51 4f .. .. .. .. ..",
];

// The 66 physical keys, in slot order: slot → [keyCode, name].
// (Wire-verified count: the M68's keymap carries 66 keys + the Fn
// marker — the vendor XML's customLed covers only a 37-key subset.)
export const PHYSICAL_KEYS = [];

for (let r = 0; r < MATRIX_ROWS; r++) {
  const cols = LAYOUT[r].trim().split(/\s+/);
  if (cols.length !== MATRIX_COLS) {
    throw new Error(`keymap layout row ${r} has ${cols.length} cols, want ${MATRIX_COLS}`);
  }
  for (let c = 0; c < MATRIX_COLS; c++) {
    if (cols[c] === "..") continue;
    const slot = r * MATRIX_COLS + c;
    if (slot === FN_SLOT) continue; // marker, not a key
    PHYSICAL_KEYS.push([slot, parseInt(cols[c], 16)]);
  }
}

// HID usage-id names. Physical keys first (names are ours, aligned
// with the vendor label map), then extra remap TARGETS from the
// vendor's 112-entry label map (F-row, nav, PrtSc — all standard
// HID usage ids).
const USAGE_NAMES = {
  0x04: "A", 0x05: "B", 0x06: "C", 0x07: "D", 0x08: "E", 0x09: "F",
  0x0a: "G", 0x0b: "H", 0x0c: "I", 0x0d: "J", 0x0e: "K", 0x0f: "L",
  0x10: "M", 0x11: "N", 0x12: "O", 0x13: "P", 0x14: "Q", 0x15: "R",
  0x16: "S", 0x17: "T", 0x18: "U", 0x19: "V", 0x1a: "W", 0x1b: "X",
  0x1c: "Y", 0x1d: "Z",
  0x1e: "1", 0x1f: "2", 0x20: "3", 0x21: "4", 0x22: "5", 0x23: "6",
  0x24: "7", 0x25: "8", 0x26: "9", 0x27: "0",
  0x28: "Enter", 0x29: "Esc", 0x2a: "Backspace", 0x2b: "Tab",
  0x2c: "Space", 0x2d: "Minus", 0x2e: "Equal", 0x2f: "LeftBracket",
  0x30: "RightBracket", 0x31: "Backslash", 0x33: "Semicolon",
  0x34: "Quote", 0x36: "Comma", 0x37: "Period", 0x38: "Slash",
  0x39: "CapsLock",
  0x3a: "F1", 0x3b: "F2", 0x3c: "F3", 0x3d: "F4", 0x3e: "F5",
  0x3f: "F6", 0x40: "F7", 0x41: "F8", 0x42: "F9", 0x43: "F10",
  0x44: "F11", 0x45: "F12",
  0x46: "PrintScreen", 0x47: "ScrollLock", 0x48: "Pause",
  0x49: "Insert", 0x4a: "Home", 0x4b: "PageUp", 0x4c: "Delete",
  0x4d: "End", 0x4e: "PageDown", 0x4f: "Right", 0x50: "Left",
  0x51: "Down", 0x52: "Up",
  0x53: "NumLock",
  0x54: "NumpadDivide", 0x55: "NumpadMultiply", 0x56: "NumpadMinus",
  0x57: "NumpadPlus", 0x58: "NumpadEnter",
  0x59: "Numpad1", 0x5a: "Numpad2", 0x5b: "Numpad3", 0x5c: "Numpad4",
  0x5d: "Numpad5", 0x5e: "Numpad6", 0x5f: "Numpad7", 0x60: "Numpad8",
  0x61: "Numpad9", 0x62: "Numpad0", 0x63: "NumpadPeriod",
  0x65: "Menu",
  0xe0: "LeftCtrl", 0xe1: "LeftShift", 0xe2: "LeftAlt", 0xe3: "LeftGui",
  0xe4: "RightCtrl", 0xe5: "RightShift", 0xe6: "RightAlt", 0xe7: "RightGui",
};

/** kc → name (all USAGE_NAMES entries). */
export const KEY_NAME = Object.freeze(USAGE_NAMES);

/** name (case-insensitive) → kc. */
const NAME_TO_KC = {};
for (const [kc, name] of Object.entries(USAGE_NAMES)) NAME_TO_KC[name.toLowerCase()] = Number(kc);
export function keycodeFromName(name) {
  return NAME_TO_KC[String(name).toLowerCase()];
}

// Media bindings (operateType 3): entry = `07 <id'> 00 00`, id' =
// the firmware's media byte (notes/14, FUN_0047be90). The XML/media
// ids 0-15 are the app's UI list; the wire byte differs per id.
export const MEDIA_NAMES = Object.freeze({
  0: "Vol+", 1: "Vol-", 2: "Mute", 3: "Play/Pause", 4: "Next", 5: "Prev",
  6: "Stop", 7: "Media7", 8: "Player", 9: "Calc", 10: "Computer",
  11: "Browser", 12: "Email", 13: "Brt+", 14: "Brt-", 15: "Search",
});
export const MEDIA_WIRE = Object.freeze({
  0: 0x10, 1: 0x11, 2: 0x12, 3: 0x13, 4: 0x14, 5: 0x15, 6: 0x16, 7: 0x17,
  8: 0x30, 9: 0x32, 10: 0x34, 11: 0x23, 12: 0x20, 13: 0x38, 14: 0x39, 15: 0x21,
});
const MEDIA_BY_WIRE = {};
for (const [id, wire] of Object.entries(MEDIA_WIRE)) MEDIA_BY_WIRE[wire] = Number(id);

// Mouse bindings (operateType 4): entry = `12 <isScroll> <btn> 00`
// (notes/14, FUN_0047bfa0/bfe0). isScroll = 1 for the wheel actions
// (ids 3/4); btn = the button/wheel byte.
export const MOUSE_NAMES = Object.freeze({
  0: "LeftClick", 1: "MiddleClick", 2: "RightClick", 3: "ScrollUp",
  4: "ScrollDown", 5: "Forward", 6: "Backward", 7: "Sniper",
});
export const MOUSE_BTN = Object.freeze({
  0: 0x01, 1: 0x04, 2: 0x02, 3: 0x01, 4: 0xff, 5: 0x10, 6: 0x08, 7: 0x00,
});
export function mouseWire(id) {
  return [(id === 3 || id === 4) ? 1 : 0, MOUSE_BTN[id] ?? 0];
}

/** Display name for a remap target: a keycode number, or "media:N" /
 *  "mouse:N" strings (see applyRemaps). */
export function targetLabel(target) {
  if (typeof target === "string") {
    if (target.startsWith("media:")) {
      const id = Number(target.slice(6));
      return MEDIA_NAMES[id] ?? `media ${id}`;
    }
    if (target.startsWith("mouse:")) {
      const id = Number(target.slice(6));
      return MOUSE_NAMES[id] ?? `mouse ${id}`;
    }
  }
  return KEY_NAME[target] ?? `0x${target.toString(16)}`;
}

/** Display name for a keymap ENTRY's byte1, by marker byte: 0 = key,
 *  7 = media (wire id'), 0x12 = mouse (button byte), else unknown. */
export function entryLabel(marker, b1) {
  if (marker === 0x07) {
    const id = MEDIA_BY_WIRE[b1];
    return id !== undefined ? `Media:${MEDIA_NAMES[id]}` : `Media:0x${b1.toString(16)}`;
  }
  if (marker === 0x12) {
    const id = Object.entries(MOUSE_BTN).find(([, b]) => b === b1)?.[0];
    return id !== undefined ? `Mouse:${MOUSE_NAMES[id]}` : `Mouse:0x${b1.toString(16)}`;
  }
  if (marker === 0) return KEY_NAME[b1] ?? `0x${b1.toString(16)}`;
  return `0x${marker.toString(16)}:0x${b1.toString(16)}`;
}

/** slot → name, for the 68 physical keys. */
export const SLOT_NAME = Object.freeze(
  Object.fromEntries(PHYSICAL_KEYS.map(([slot, kc]) => [slot, USAGE_NAMES[kc] ?? `0x${kc.toString(16)}`]))
);

/** Stock (pristine) keymap: 132 × 4-byte entries, byte-identical to
 *  the app's seg[2] upload (usb7/usb8). */
export function stockKeymap() {
  const buf = Buffer.alloc(SLOTS * 4);
  for (const [slot, kc] of PHYSICAL_KEYS) {
    buf[slot * 4 + 1] = kc;
  }
  // Fn marker — the app sends `01 00 00 00` at slot 121.
  buf[FN_SLOT * 4] = 1;
  return buf;
}

/**
 * Apply remap overrides to a keymap: { slot: target }.
 * target = a HID keycode (number) → `00 <target> 00 00` (the goal
 * binding PgUp→PrtSc is wire-verified: slot 82 = 0x46), or a
 * `"media:N"` string → `07 <id'> 00 00` (notes/14). The Fn marker
 * is preserved.
 */
export function applyRemaps(base, overrides = {}) {
  const map = Buffer.from(base);
  for (const [slotStr, target] of Object.entries(overrides)) {
    const slot = Number(slotStr);
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) {
      throw new Error(`bad slot ${slotStr}`);
    }
    if (slot === FN_SLOT) throw new Error("the Fn key is not remappable");
    map.fill(0, slot * 4, slot * 4 + 4);
    if (typeof target === "string" && target.startsWith("media:")) {
      const id = Number(target.slice(6));
      if (!(id in MEDIA_WIRE)) throw new Error(`bad media id ${id} for slot ${slot}`);
      map[slot * 4] = 0x07; // media marker
      map[slot * 4 + 1] = MEDIA_WIRE[id];
      continue;
    }
    if (typeof target === "string" && target.startsWith("mouse:")) {
      const id = Number(target.slice(6));
      if (!(id in MOUSE_NAMES)) throw new Error(`bad mouse id ${id} for slot ${slot}`);
      const [scroll, btn] = mouseWire(id);
      map[slot * 4] = 0x12; // mouse marker
      map[slot * 4 + 1] = scroll;
      map[slot * 4 + 2] = btn;
      continue;
    }
    if (!Number.isInteger(target) || target < 0 || target > 0xff) {
      throw new Error(`bad target keycode ${target} for slot ${slot}`);
    }
    map[slot * 4 + 1] = target;
  }
  return map;
}

/** All remaps currently on a map: slot → target kc (≠ stock). */
export function remapsOf(map, stock = stockKeymap()) {
  const out = {};
  for (let slot = 0; slot < SLOTS; slot++) {
    if (slot === FN_SLOT) continue;
    const kc = map[slot * 4 + 1];
    const skc = stock[slot * 4 + 1];
    if (kc !== skc) out[slot] = kc;
  }
  return out;
}
