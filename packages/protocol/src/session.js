// Session layer — verified protocol only (notes/09-session-flow.md).
//
// A Transport is any object with:
//   write(frame: Buffer): Promise<void>   — send one 64-byte frame
//   read(timeoutMs): Promise<Buffer>      — read one 64-byte report
//   close(): void
import { buildFrame, checkResponse } from "./frame.js";
import { CMD } from "./commands.js";
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

  async sensitivity(sub) {
    const resp = await this.cmd(CMD.HE_SENSITIVITY, [0, 0, 0, 0x18, sub], CMD.HE_SENSITIVITY);
    return decode.decodeSensitivity(resp);
  }

  close() {
    this.t.close();
  }
}
