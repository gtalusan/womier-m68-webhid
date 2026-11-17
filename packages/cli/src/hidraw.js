// Linux hidraw transport for the M68 HE vendor interface.
// Zero native deps — /dev/hidrawN is just a file. Requires the udev
// rule from tools/99-m68.rules (or root).
import fs from "node:fs";
import { VID, PID } from "@m68/protocol";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Find the hidraw node of the vendor interface (HID_PHYS .../input2). */
export function findHidraw() {
  let dir;
  try {
    dir = fs.readdirSync("/sys/class/hidraw");
  } catch {
    throw new Error("no /sys/class/hidraw — not Linux or no HID devices");
  }
  for (const name of dir.sort()) {
    if (!name.startsWith("hidraw")) continue;
    const uePath = `/sys/class/hidraw/${name}/device/uevent`;
    let uevent;
    try {
      uevent = fs.readFileSync(uePath, "utf8");
    } catch {
      continue;
    }
    if (!uevent.includes(`00000416`)) continue; // VID 0416 zero-padded
    if (!uevent.includes(`00007372`)) continue; // PID 7372
    const phys = uevent.split("\n").find((l) => l.startsWith("HID_PHYS="));
    if (phys && phys.slice("HID_PHYS=".length).endsWith("/input2")) {
      return `/dev/${name}`;
    }
  }
  throw new Error(
    `M68 HE vendor interface not found (VID ${VID.toString(16)} PID ${PID.toString(16)}) — plugged in?`
  );
}

export class HidrawTransport {
  constructor(path = findHidraw()) {
    this.path = path;
    this.fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
  }

  async write(frame) {
    const buf = Buffer.from(frame);
    if (buf.length !== 64) {
      throw new Error(`refusing to write ${buf.length}-byte frame (must be 64)`);
    }
    // Retry on EAGAIN: the firmware should poll promptly when healthy.
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        fs.writeSync(this.fd, buf);
        return;
      } catch (e) {
        if (e.code === "EAGAIN" && Date.now() < deadline) {
          await sleep(50);
          continue;
        }
        if (e.code === "ETIMEDOUT" || e.code === "EAGAIN") {
          throw new Error(
            "device not accepting writes (firmware wedged?) — replug the keyboard"
          );
        }
        throw e;
      }
    }
  }

  async read(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const buf = Buffer.alloc(64);
        const n = fs.readSync(this.fd, buf, 0, 64, null);
        return buf.subarray(0, n);
      } catch (e) {
        if (e.code === "EAGAIN") {
          if (Date.now() >= deadline) {
            throw new Error(`no response within ${timeoutMs} ms`);
          }
          await sleep(25);
          continue;
        }
        throw e;
      }
    }
  }

  close() {
    try {
      fs.closeSync(this.fd);
    } catch {}
  }
}
