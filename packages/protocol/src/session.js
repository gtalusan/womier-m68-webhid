// Session layer — verified protocol only (notes/09-session-flow.md).
//
// A Transport is any object with:
//   write(frame: Buffer): Promise<void>   — send one 64-byte frame
//   read(timeoutMs): Promise<Buffer>      — read one 64-byte report
//   close(): void
import { buildFrame, checkResponse } from "./frame.js";
import { CMD, HE_PARAM_SUB } from "./commands.js";
import { stockKeymap } from "./keymap.js";
import * as decode from "./decode.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class M68Session {
  /**
   * @param {{write:Function,read:Function,close:Function}} transport
   */
  constructor(transport) {
    this.t = transport;
    this.info = null;
    this.buildDate = null;
  }

  /** Device info handshake; two responses (CSV + build date). */
  async handshake() {
    await this.t.write(buildFrame(CMD.DEVICE_INFO));
    await sleep(250);
    const r1 = checkResponse(await this.t.read(2000), CMD.DEVICE_INFO);
    this.info = decode.decodeDeviceInfo(r1);
    try {
      const r2 = checkResponse(await this.t.read(1500), CMD.DEVICE_INFO);
      this.buildDate = decode.decodeBuildDate(r2);
    } catch {
      this.buildDate = null;
    }
    await sleep(500);
    return { info: this.info, buildDate: this.buildDate };
  }

  /** Keepalive (observed in the app: [5]=1, ACKed with echo 0x01). */
  async keepalive() {
    const resp = await this.cmd(CMD.KEEPALIVE, [0, 0, 0, 1], CMD.KEEPALIVE);
    return resp;
  }

  async cmd(cmd, payload, expectEcho = cmd, waitMs = 1500) {
    await this.t.write(buildFrame(cmd, payload));
    await sleep(300);
    const resp = checkResponse(await this.t.read(waitMs), expectEcho);
    return resp;
  }

  /**
   * THE commit — one frame, persists across power cycles.
   *
   * Full layout (verified against M68.exe FUN_004a7010, the app's
   * "Write keyboard Led" builder — see notes/10-neon-mode.md):
   *   [5]=0x0E  [6]=mode  [7]=brightness  [8]=speed
   *   [9..11]=top/foreground R,G,B   [12..14]=bottom/background R,G,B
   *   [15]=direction (0..7)          [16]=full-color flag (0/1)
   *   [17]=0  [18]=0  [0x3e..0x3f]=16-bit ms timestamp (BE)
   *
   * mode = the app's internal effect id (device-verified: the real
   * Windows app commits 0x03 for Neon and the device renders it as the
   * Neon cycling; 0x00=Static register anchor). See EFFECT.
   * Brightness/speed are the app's 5-step slider values (0..4) —
   * app-register-verified: the app wrote raw step values with no
   * remapping (brightness step 2 → 1, speed step 4 → 3). Brightness
   * 0 = dark, 4 = full; speed 0 = slowest, 4 = fastest; out-of-range
   * values (≥5) make the firmware misbehave. The app forces
   * full-color to 0 for Static (mode 0) — mirrored here.
   */
  async commitLightEffect({
    mode,
    brightness = 0x04,
    speed = 0x03,
    fg = [0xff, 0x00, 0x00],
    bg = [0x00, 0x00, 0x00],
    direction = 0,
    fullColor = false,
  }) {
    const p = Buffer.alloc(62);
    p[3] = 0x0e; // frame[5]
    p[4] = mode & 0xff; // frame[6]
    p[5] = brightness & 0xff; // frame[7]
    p[6] = speed & 0xff; // frame[8]
    p[7] = fg[0] & 0xff; // frame[9]
    p[8] = fg[1] & 0xff; // frame[10]
    p[9] = fg[2] & 0xff; // frame[11]
    p[10] = bg[0] & 0xff; // frame[12]
    p[11] = bg[1] & 0xff; // frame[13]
    p[12] = bg[2] & 0xff; // frame[14]
    p[13] = direction & 0xff; // frame[15]
    p[14] = mode === 0 || !fullColor ? 0 : 1; // frame[16]
    // frame[17], frame[18] stay 0
    const ts = Date.now() & 0xffff; // frame[0x3e..0x3f], like the app
    p[0x3c] = (ts >> 8) & 0xff;
    p[0x3d] = ts & 0xff;
    await this.t.write(buildFrame(CMD.KBD_LIGHT_CONFIG, p));
    await sleep(300);
  }

  /** Back-compat: Static-style commit (fg color only). */
  async commitLightMode(modeId, brightness = 0x04, speed = 0x03, rgb = [0xff, 0x00, 0x00]) {
    await this.commitLightEffect({ mode: modeId, brightness, speed, fg: rgb });
  }

  /**
   * Stream a per-key grid to the device (wire 0x0f) — the app's live
   * preview path. Verified against the app's own captures (usb6.log):
   *   group 0 = keyboard, 132 slots × RGB (396 B) in chunks 0..7
   *   (7×54 B + 18 B); group 1 = side, 33 slots (99 B) in chunks 0..1.
   * Slot i = (row*22 + col), matching the XML indexX/indexY coords.
   * Startup sequence (usb6-verified, `preamble: true`):
   *   side grid (chunk0, chunk0, chunk1) → keepalive 0x01 [5]=1 →
   *   light-sync 0x17 [5]=1 [6]=1 → then grid cycles.
   * The device renders the grid while the stream runs; it lives in
   * RAM only (lost on power cycle — the app behaves the same way).
   * Requires a committed brightness > 0 to take effect (notes/08).
   */
  async streamGrid(grid, { chunkPaceMs = 100, preamble = false } = {}) {
    const kbd = Buffer.isBuffer(grid) ? grid : Buffer.from(grid);
    if (kbd.length !== 396) throw new Error(`keyboard grid must be 396 bytes (132 slots), got ${kbd.length}`);
    const side = Buffer.alloc(99); // side array dark
    const sendGroup = async (data) => {
      for (let off = 0, chunk = 0; off < data.length; off += 54, chunk++) {
        const c = data.subarray(off, Math.min(off + 54, data.length));
        const p = Buffer.alloc(62);
        p[0] = data === kbd ? 0 : 1; // [2] group
        p[1] = 0; // [3]
        p[2] = chunk; // [4]
        p[3] = c.length; // [5]
        c.copy(p, 4); // [6..]
        await this.t.write(buildFrame(0x0f, p));
        await sleep(chunkPaceMs);
      }
    };
    if (preamble) {
      await sendGroup(side);
      await sendGroup(side); // the app sends chunk0 twice + chunk1
      await this.t.write(buildFrame(0x01, [0, 0, 0, 1])); // keepalive
      await sleep(chunkPaceMs);
      await this.t.write(buildFrame(0x17, [0, 0, 0, 1, 1])); // light-sync enter
      await sleep(chunkPaceMs);
    }
    await sendGroup(kbd);
    await sendGroup(side);
  }

  async serial() {
    const resp = await this.cmd(CMD.DEVICE_SN, [], CMD.DEVICE_SN);
    return decode.decodeSerial(resp);
  }

  async lightModeList() {
    const resp = await this.cmd(CMD.KBD_LIGHT_MODE_LIST, [], CMD.KBD_LIGHT_MODE_LIST);
    return decode.decodeModeList(resp);
  }

  async sideModeList() {
    const resp = await this.cmd(CMD.SIDE_LIGHT_MODE_LIST, [], CMD.SIDE_LIGHT_MODE_LIST);
    return decode.decodeModeList(resp);
  }

  async lightConfig() {
    const resp = await this.cmd(CMD.KBD_LIGHT_CONFIG, [1], CMD.KBD_LIGHT_CONFIG);
    return decode.decodeLightConfig(resp);
  }

  async sideConfig() {
    const resp = await this.cmd(CMD.SIDE_LIGHT_CONFIG, [1], CMD.SIDE_LIGHT_CONFIG);
    return decode.decodeLightConfig(resp);
  }

  async customLayoutSupport() {
    const resp = await this.cmd(CMD.CUSTOM_LAYOUT_SUPPORT, [], CMD.CUSTOM_LAYOUT_SUPPORT);
    return { flags: Buffer.from(resp.subarray(6, 6 + resp[5])).toString("hex") };
  }

  async sleepTime() {
    const resp = await this.cmd(CMD.SLEEP_TIME, [2, 0, 0, 1], CMD.SLEEP_TIME);
    return decode.decodeSleep(resp);
  }

  /** Raw HE parameter query (wire 0x21 [5]=0x18 [6]=sub). Sub 4 is
   *  sensitivity, 9 is polling rate, 10 is anti-shake — not the same
   *  setting; see notes/16. */
  async heParam(sub) {
    const resp = await this.cmd(CMD.HE_PARAM, [0, 0, 0, 0x18, sub], CMD.HE_PARAM);
    return decode.decodeHeParam(resp);
  }

  /** Back-compat alias for heParam (the old name was too narrow). */
  async sensitivity(sub) {
    return this.heParam(sub);
  }

  /** Current polling/report rate (0x21 sub 9) — "Rate return" in the app. */
  async rate() {
    const resp = await this.cmd(
      CMD.HE_PARAM,
      [0, 0, 0, 0x18, HE_PARAM_SUB.RATE],
      CMD.HE_PARAM,
    );
    return decode.decodeRate(resp);
  }

  /**
   * Set polling/report rate. `code` is the vendor app's wire code:
   * 1=1K, 2=2K, 4=4K, 8=8K (the app labels these "1K".."8K").
   * The vendor setter is `01 21 00 00 00 18 09 01 <code>`; it does
   * not read a reply. We best-effort drain an ACK. Live behavior
   * (ACK timing, persistence) is TODO — notes/16.
   */
  async setRate(code) {
    if (!decode.RATE_HZ_BY_CODE[code]) {
      throw new Error("rate code must be 1, 2, 4, or 8 (1K/2K/4K/8K)");
    }
    await this.t.write(
      buildFrame(CMD.HE_PARAM, [0, 0, 0, 0x18, HE_PARAM_SUB.RATE, 1, code]),
    );
    await sleep(300);
    await this.drain(1, 500); // consume the setter ACK if the device sends one
    return { code, hz: decode.RATE_HZ_BY_CODE[code] };
  }

  /**
   * The app's keymap Download sequence, byte-for-byte as captured
   * (usb7/usb8.log — wire-validated, notes/11):
   *   0x18 seg[0] = the active profile's keymap (132 entries)
   *   0x18 seg[2] = pristine default keymap
   *   0x19 = macro-data list (10 slots × 256 B; zeros = unused)
   *   0x22 = DKS/SeniorKey store (40 slots × 50 B; zeros = unused)
   * Packet framing for all three: [2]=seg/idx, [3]=0, [4]=packet#,
   * [5]=chunk len, [6..]=chunk. 0x18 carries 14 entries (56 B) per
   * packet, last packet 6 entries (24 B).
   * Pacing: 400 ms on 0x18 (the app's Sleep(400)), 100 ms on the
   * banks (probe P1 — notes/12 — validates whether faster works).
   * Write-only; drains any device ACKs afterwards (probe P0).
   *
   * @param {Buffer} customMap 528 bytes (132 × 4-byte entries) —
   *   build with keymap.applyRemaps(stockKeymap(), overrides).
   */
  async uploadKeymap(customMap) {
    if (!Buffer.isBuffer(customMap) || customMap.length !== 132 * 4) {
      throw new Error("customMap must be 528 bytes (132 entries)");
    }
    const sendChunks = async (wire, seg, data, chunkSize, paceMs) => {
      for (let off = 0, pkt = 0; off < data.length; off += chunkSize, pkt++) {
        const chunk = data.subarray(off, Math.min(off + chunkSize, data.length));
        const p = Buffer.alloc(62);
        p[0] = seg; // frame[2]
        p[1] = 0; // frame[3]
        p[2] = pkt; // frame[4]
        p[3] = chunk.length; // frame[5]
        chunk.copy(p, 4); // frame[6..]
        await this.t.write(buildFrame(wire, p));
        await sleep(paceMs);
      }
    };
    await sendChunks(CMD.ONBOARD_DATA, 0, customMap, 14 * 4, 400);
    await sendChunks(CMD.ONBOARD_DATA, 2, stockKeymap(), 14 * 4, 400);
    for (let seg = 0; seg < 10; seg++) {
      await sendChunks(CMD.SENIOR_KEY, seg, Buffer.alloc(256), 58, 100);
    }
    for (let pkt = 0; pkt < 40; pkt++) {
      await sendChunks(CMD.KEYMAP_AUX, pkt, Buffer.alloc(50), 50, 100);
    }
    await this.drain();
  }

  /** Probe P1 variant (notes/12): 0x18 seg[0] only — tests whether the
   *  firmware commits the keymap without the pristine seg + banks. */
  async uploadKeymapMinimal(customMap) {
    if (!Buffer.isBuffer(customMap) || customMap.length !== 132 * 4) {
      throw new Error("customMap must be 528 bytes (132 entries)");
    }
    const CHUNK = 14 * 4;
    for (let off = 0, pkt = 0; off < customMap.length; off += CHUNK, pkt++) {
      const chunk = customMap.subarray(off, Math.min(off + CHUNK, customMap.length));
      const p = Buffer.alloc(62);
      p[0] = 0; // seg
      p[2] = pkt;
      p[3] = chunk.length;
      chunk.copy(p, 4);
      await this.t.write(buildFrame(CMD.ONBOARD_DATA, p));
      await sleep(400);
    }
    await this.drain();
  }

  /** Read and discard reports until one read times out (best-effort
   *  ACK drain after uploads; whether the device ACKs 0x18 is probe
   *  P0 — notes/12). Capped so a chatty device can't stall us. */
  async drain(maxReads = 150, timeoutMs = 100) {
    for (let i = 0; i < maxReads; i++) {
      try {
        await this.t.read(timeoutMs);
      } catch {
        return;
      }
    }
  }

  close() {
    this.t.close();
  }
}
