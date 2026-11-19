// Command table for the Womier M68 HE (Nuvoton M484, VID 0416 / PID 7372).
// VERIFIED entries only — see notes/09-session-flow.md for the ground
// truth; speculative commands were removed.
//
// Frame format (always EXACTLY 64 bytes — the firmware wedges on 65!):
//   [0]      report ID = 1
//   [1]      wire command
//   [2..63]  payload (62 bytes)

/** Named wire commands (device-answered = verified live). */
export const CMD = Object.freeze({
  // --- verified: the device answers these ---
  DEVICE_INFO: 0x0d, // handshake; 2 responses: CSV info + build date
  DEVICE_SN: 0x15, // → hex-ASCII serial at resp[6]
  KBD_LIGHT_CONFIG: 0x07, // [2]=1 → query register; [5]=0x0E → COMMIT (see session.js)
  SIDE_LIGHT_CONFIG: 0x08, // [2]=1 → query side register
  KBD_LIGHT_MODE_LIST: 0x0a, // → 15 mode ids + a5 5a 04 04 marker
  SIDE_LIGHT_MODE_LIST: 0x02,
  CUSTOM_LAYOUT_SUPPORT: 0x0e,
  SLEEP_TIME: 0x14, // [2]=2 query
  HE_SENSITIVITY: 0x21, // [5]=0x18, [6]=sub (3=calibrate, 4/9/10=query)
  // --- observed in the app's transcripts; roles not fully isolated ---
  KEEPALIVE: 0x01, // "ShakeHands": [5]=1, device ACKs echo 0x01; app sends it ~every 59 chunks
  LIGHT_SYNC: 0x17, // [5]=1 [6]=1; app sends at session start + ~every 150 chunks
  LIVE_GRID: 0x0f, // live-preview grid chunks: [2]=group(0=kbd,1=side),
                    // [4]=chunk#, [5]=len, [6..]=RGB — renders live while
                    // streaming; reverts to the committed state on stop
  // --- keymap Download upload (wire-validated, usb7/usb8 — notes/11) ---
  ONBOARD_DATA: 0x18, // compiled 132-entry keymap; [2]=seg(0=active map,2=pristine), [4]=pkt#, [5]=len
  SENIOR_KEY: 0x19, // SeniorKey/DKS banks (app 0x18); 10 segs × 256 B, zeros = unused
  KEYMAP_AUX: 0x22, // app 0x2A; 40 × 50 B = 2000 B, all-zero — role unknown, replayed verbatim
});

/**
 * Light mode IDs on the WIRE (commit frame [6]) = the app's internal
 * effect ids. Verified by reading the device register after the REAL
 * Windows app committed Neon (2026-11-17): mode=0x03, and the device
 * renders 0x03 as Neon cycling. The app's mode-change slot
 * (FUN_004a8b40) maps UI index → internal id: Neon→3, Breath→1,
 * Wave→2, Twinkle→9, Radar→4, Snake→5, AutoRipple→0xe, Striation→0xf,
 * Aurora→7, Ripple→8, Reactive→6, Cross→0xb, Fireworks→0x10,
 * SpeedRespond→0xc, Custom→0xa, Musical→100; the SDK preview renderer
 * (FUN_1000a5d0) dispatches on the same ids.
 *
 * The device's 0x0A mode list `02 01 03 09 04 00 0e 0f 06 07 0b 0c 10
 * 08 11` contains these ids minus Snake(5)/Custom(0xa)/Musical(100),
 * plus an extra 0x11 (renders dark on the board — likely the
 * device-side Custom id; the app's Custom path uses 0x0a internally
 * and the separate 0x09 custom-led command — TBD).
 */
export const EFFECT = Object.freeze({
  0x00: "Static", // ✅ register anchor
  0x01: "Breath", // * (0x01+fullcolor cycles colors — looks Neon-ish!)
  0x02: "Wave", // *
  0x03: "Neon", // ✅ app-register-verified + renders Neon on-device
  0x04: "Radar", // *
  0x05: "Snake", // * (not in the device 0x0A list)
  0x06: "Reactive", // *
  0x07: "Aurora", // *
  0x08: "Ripple", // *
  0x09: "Twinkle", // *
  0x0a: "Custom", // * (not in the device 0x0A list — see above)
  0x0b: "Cross", // *
  0x0c: "Speed Respond", // *
  0x0e: "Auto Ripple", // *
  0x0f: "Striation", // *
  0x10: "Fireworks", // *
  100: "Musical Rhythm", // * (not in the device 0x0A list)
});

export const SIDE_EFFECT = Object.freeze({
  0x00: "Static",
  0x01: "Neon",
  0x02: "Breath",
  0x03: "Wave",
  0x04: "Collision",
});

export const VID = 0x0416;
export const PID = 0x7372;
export const REPORT_ID = 1;
export const FRAME_LEN = 64; // non-negotiable. 65 wedges the firmware.
