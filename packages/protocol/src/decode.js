// Response decoders for each validated command (notes/08).
import { payloadString } from "./frame.js";

/** Handshake CSV: "M484,20,KB,FQ,X82HERGB,V1_11_05" → fields. */
export function decodeDeviceInfo(resp) {
  const csv = payloadString(resp, 6);
  const [model, layout, t1, t2, board, firmware] = csv.split(",");
  return { model, layout, t1, t2, board, firmware, raw: csv };
}

/** Second handshake response: "Mar 26 2024,11:06:05" → build date. */
export function decodeBuildDate(resp) {
  const s = payloadString(resp, 6).trim();
  const m = s.match(/^(\w{3}) (\d{1,2}) (\d{4}),(\d\d):(\d\d):(\d\d)/);
  if (!m) return { raw: s };
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
                   Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  return {
    raw: s,
    date: new Date(Date.UTC(+m[3], MONTHS[m[1]] - 1, +m[2], +m[4], +m[5], +m[6])),
  };
}

/** Serial number: hex-ASCII string at resp[6]. */
export function decodeSerial(resp) {
  const hex = payloadString(resp, 6).trim();
  const bytes = hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [];
  return { hex, bytes };
}

/** Light mode list (0x0A / 0x02): [5]=len, then IDs, then "a5 5a 04 04" marker. */
export function decodeModeList(resp) {
  const len = resp[5];
  const payload = Buffer.from(resp.subarray(6, 6 + len));
  // last 4 bytes are a firmware marker (a5 5a 04 04), not effect IDs
  const marker = payload.subarray(Math.max(0, len - 4));
  const ids = Array.from(payload.subarray(0, Math.max(0, len - 4)));
  return { count: ids.length, ids, marker: marker.toString("hex"), raw: payload.toString("hex") };
}

/**
 * Keyboard/side light config (0x07/0x08 with [2]=1).
 *
 * Response: `01 07 00 00 00 0c <12-byte register> …` where resp[5]=0x0c
 * is the payload length (same convention as the mode list) and the
 * register at resp[6..17] mirrors the commit fields:
 *   [6]=mode  [7]=brightness  [8]=speed
 *   [9..11]=fg R,G,B  [12..14]=bg R,G,B
 *   [15]=direction  [16]=full-color flag  [17]=reserved
 * (live-verified: Static commit read back `00 04 03 f2 55 ff` at
 * [6..11]; commit-side layout binary-verified — notes/10-neon-mode.md).
 */
export function decodeLightConfig(resp) {
  const len = resp[5];
  const fields = len > 0 && len <= 60
    ? Buffer.from(resp.subarray(6, 6 + len))
    : Buffer.from(resp.subarray(6, 6 + 12));
  return {
    len,
    respHex: Buffer.from(resp).toString("hex"), // whole 64-byte report, for audit
    mode: fields[0],
    modeName: null, // filled by callers that have the EFFECT table
    brightness: fields[1],
    speed: fields[2],
    fg: [fields[3], fields[4], fields[5]],
    bg: [fields[6], fields[7], fields[8]],
    direction: fields[9],
    fullColor: fields[10],
    reserved: fields[11],
    raw: fields.toString("hex"),
  };
}

/** Sleep time (0x14 [2]=2): raw bytes; semantics TBD. */
export function decodeSleep(resp) {
  return { fields: Buffer.from(resp.subarray(6, 6 + 8)).toString("hex") };
}

/** HE sensitivity (0x21 [5]=0x18 [6]=sub): [7]=value. */
export function decodeSensitivity(resp) {
  return { sub: resp[6], value: resp[7] };
}

/** Parse one <customLed index="N"> node from a profile XML. */
export function parseCustomLed(xmlText, index = 0) {
  const re = /<customLed index="(\d+)"[^>]*>([\s\S]*?)<\/customLed>/g;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    if (Number(m[1]) !== index) continue;
    const items = [];
    const itemRe = /<item keyCode="\d+"[^>]*?indexX="(\d+)" indexY="(\d+)" colorR="(\d+)" colorG="(\d+)" colorB="(\d+)"[^>]*?\/>/g;
    let im;
    while ((im = itemRe.exec(m[2])) !== null) {
      items.push({ row: +im[1], col: +im[2], rgb: [+im[3], +im[4], +im[5]] });
    }
    return items;
  }
  return null;
}
