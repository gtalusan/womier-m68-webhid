// Frame building / validation. The 64-byte rule is load-bearing:
// the M484 firmware wedges its OUT endpoint on any other length.
import { FRAME_LEN, REPORT_ID } from "./commands.js";

/**
 * Build a 64-byte output frame.
 * @param {number} cmd wire command byte
 * @param {Uint8Array|number[]|Buffer} [payload] up to 62 bytes
 * @returns {Buffer}
 */
export function buildFrame(cmd, payload = []) {
  const p = Buffer.from(payload);
  if (p.length > FRAME_LEN - 2) {
    throw new RangeError(`payload too long: ${p.length} (max ${FRAME_LEN - 2})`);
  }
  const frame = Buffer.alloc(FRAME_LEN);
  frame[0] = REPORT_ID;
  frame[1] = cmd & 0xff;
  p.copy(frame, 2);
  return frame;
}

/** Validate a received report (64 B, matching report ID + echo). */
export function checkResponse(resp, expectEcho) {
  if (!resp || resp.length !== FRAME_LEN) {
    throw new Error(`bad response length ${resp ? resp.length : 0} (want ${FRAME_LEN})`);
  }
  if (resp[1] !== expectEcho) {
    throw new Error(
      `unexpected echo 0x${resp[1].toString(16)} (want 0x${expectEcho.toString(16)})`
    );
  }
  return resp;
}

/** Extract the ASCII field starting at resp[6], NUL-trimmed. */
export function payloadString(resp, from = 6) {
  let end = from;
  while (end < resp.length && resp[end] !== 0) end++;
  return resp.subarray(from, end).toString("ascii");
}

/** Pretty hex dump for debug output. */
export function hexdump(buf) {
  return Buffer.from(buf).toString("hex").match(/.{1,2}/g).join(" ");
}

/** ASCII-ish rendering for debug output. */
export function ascii(buf) {
  return Buffer.from(buf)
    .toString("ascii")
    .replace(/[^\x20-\x7e]/g, ".");
}
