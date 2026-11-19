#!/usr/bin/env node
// m68ctl — configure the Womier M68 HE from Linux.
// Verified commands only (notes/09-session-flow.md).
import { M68Session, CMD, buildFrame, checkResponse, hexdump, ascii, EFFECT, keymap } from "@m68/protocol";
import { HidrawTransport } from "./hidraw.js";
import { loadStore, saveStore, takeProfile, PROFILE_COUNT } from "./profiles.js";

const USAGE = `m68ctl — Womier M68 HE configurator (Linux)

usage: m68ctl <command> [args]

  info                     device info: model, firmware, build date, serial
  sn                       serial number
  light modes              available light modes (named)
  light static <RRGGBB>    static color — one commit frame, persists
  light neon [opts]        Neon — brightness/speed sliders + full-color
  light breath [opts]      Breath — same controls as Neon
  light wave [opts]        Wave — same + direction
  light twinkle [opts]     Twinkle — same controls as Neon
  light radar [opts]       Radar — same + direction: clockwise|
  light autoripple [opts]  Auto Ripple — same controls as Neon
  light ripple [opts]       Ripple — same controls as Neon
  light striation [opts]   Striation — same + direction: clockwise|
  light aurora [opts]      Aurora — same + direction: inward|outward
  light reactive [opts]    Reactive — same controls as Neon
  light cross [opts]       Cross — same controls as Neon
  light fireworks [opts]   Fireworks — same controls as Neon
  light speedrespond [opts] Speed Respond — same + direction: up|down
  light custom [opts]      Custom — brightness + fg only (pattern is
                           whatever the device has stored)
    --brightness <0-4>       brightness, 5 steps like the app
                             (default 4 = full; 0 = dark)
    --speed <0-4>            speed, 5 steps like the app: 0 = slowest,
                             4 = fastest (default 3)
    --fg <RRGGBB>            foreground color (default ff0000)
    --bg <RRGGBB>            background color (default 000000)
    --full-color             cycle fg/bg automatically (default off)
    --direction <name>       wave: left|right|up|down|inward|outward;
                             radar, striation: clockwise|counter-clockwise
                             radar: clockwise|counter-clockwise
                             (default right)
  light mode <id|name>     switch mode (keeps current color)
  light off                lights off (Static with brightness 0)
  light config             current light config register
  side config              side light config register (raw)
  side modes               side light modes
  sleep                    sleep time (raw)
  sensitivity [sub]        HE sensitivity (sub 4|9|10, default: all)
  layout                   custom layout support flags (raw)
  keymap show              current keymap grid + remaps for a profile
  keymap set KEY=TARGET ..  remap keys: e.g. keymap set PageUp=PrintScreen
  keymap reset             clear all remaps for a profile
  keymap upload            push a profile's keymap to the board (the
                           app's Download sequence, wire-verified)
  profile list             profiles 0-2 and their remaps
  profile use <0-2>        set the current profile (default for commands)
  profile current          print the current profile index
  profile import <file>    merge a profile XML's <keyEvent> remaps
  profile export <file>    write a profile's remaps as <keyEvent> XML
  session                  full demo: every verified step, printed

  --profile <0-2> applies to the keymap and profile commands only
  (0-based: CLI 0/1/2 = the app's profiles 1/2/3; default = current
  profile, "profile use" to change). Profiles are an XML concept —
  the board has no profile register and holds whatever keymap was
  last uploaded (notes/12).
`;

function out(obj) {
  console.log(obj);
}

function fail(msg) {
  console.error(`m68ctl: ${msg}`);
  process.exit(1);
}

// --- keymap/profile helpers ---

const ALIASES = {
  prtsc: "PrintScreen", printscreen: "PrintScreen",
  pgup: "PageUp", pageup: "PageUp", pgdn: "PageDown", pagedown: "PageDown",
  ins: "Insert", del: "Delete", bsp: "Backspace", esc: "Esc",
  lshift: "LeftShift", rshift: "RightShift", lctrl: "LeftCtrl",
  lalt: "LeftAlt", ralt: "RightAlt", lwin: "LeftGui", rwin: "RightGui",
  up: "Up", down: "Down", left: "Left", right: "Right", space: "Space",
};
// media targets (operateType 3) — "media:N" where N = the app's
// media id 0-15; the wire byte comes from keymap.MEDIA_WIRE (notes/14)
const MEDIA_ALIASES = {
  "vol+": 0, volup: 0, "vol-": 1, voldown: 1, vol: 0, mute: 2,
  "play/pause": 3, playpause: 3, play: 3, pause: 3,
  next: 4, nexttrack: 4, prev: 5, previous: 5, prevtrack: 5, stop: 6,
  player: 8, media: 8, calc: 9, calculator: 9, computer: 10, mycomputer: 10,
  browser: 11, web: 11, email: 12, mail: 12, "brt+": 13, "brt-": 14,
  brightnessup: 13, brightnessdown: 14, search: 15,
};
// mouse targets (operateType 4) — "mouse:N". Names chosen to not
// collide with the arrow-key aliases (Left/Right remain keys).
const MOUSE_ALIASES = {
  leftclick: 0, middleclick: 1, centerclick: 1, rightclick: 2,
  scrollup: 3, scrolldown: 4, wheelup: 3, wheeldown: 4,
  forward: 5, backward: 6, sniper: 7,
};

/** Name/alias → HID keycode (targets); also accepts 0x-hex or decimal.
 *  Media/mouse names → "media:N" / "mouse:N" strings. */
function parseTarget(s) {
  const mname = MEDIA_ALIASES[s.toLowerCase()];
  if (mname !== undefined) return `media:${mname}`;
  const moname = MOUSE_ALIASES[s.toLowerCase()];
  if (moname !== undefined) return `mouse:${moname}`;
  const name = ALIASES[s.toLowerCase()] ?? s;
  const kc = keymap.keycodeFromName(name);
  if (kc !== undefined) return kc;
  const hex = s.match(/^0x([0-9a-f]+)$/i);
  if (hex) return parseInt(hex[1], 16);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return undefined;
}

/** Physical-key name/alias → matrix slot. */
function slotFromName(s) {
  const name = ALIASES[s.toLowerCase()] ?? s;
  const lc = name.toLowerCase();
  for (const [slot, kc] of keymap.PHYSICAL_KEYS) {
    if ((keymap.KEY_NAME[kc] ?? "").toLowerCase() === lc) return slot;
  }
  return undefined;
}

async function withSession(fn) {
  const t = new HidrawTransport();
  const s = new M68Session(t);
  try {
    await s.handshake();
    return await fn(s);
  } finally {
    s.close();
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case "info": {
      await withSession(async (s) => {
        out({
          ...s.info,
          buildDate: s.buildDate?.date?.toISOString() ?? s.buildDate?.raw ?? null,
          serial: (await s.serial()).hex,
        });
      });
      break;
    }

    case "sn": {
      await withSession(async (s) => out((await s.serial()).hex));
      break;
    }

    case "light": {
      const sub = args[0];
      if (sub === "modes") {
        await withSession(async (s) => {
          const list = await s.lightModeList();
          out({
            modes: list.ids.map((id) => ({
              id: id.toString(16).padStart(2, "0"),
              name: EFFECT[id] ?? "?",
            })),
          });
        });
      } else if (sub === "config") {
        await withSession(async (s) => {
          const c = await s.lightConfig();
          out({ ...c, modeName: EFFECT[c.mode] ?? "?" });
        });
      } else if (sub === "static") {
        const rgb = Buffer.from(args[1] ?? "ff0000", "hex");
        if (rgb.length !== 3) fail("light static <RRGGBB>");
        await withSession(async (s) => {
          await s.commitLightMode(0x00, 0x04, 0x03, [rgb[0], rgb[1], rgb[2]]);
          out({ mode: "00", name: "Static", rgb: rgb.toString("hex"), set: true });
        });
      } else if (["neon", "breath", "wave", "twinkle", "radar", "autoripple", "ripple", "striation", "aurora", "reactive", "cross", "fireworks", "speedrespond"].includes(sub)) {
        // Wire ids (all app-register-verified): Neon=0x03, Breath=0x01,
        // Wave=0x02, Twinkle=0x09, Radar=0x04, Auto Ripple=0x0e,
        // Ripple=0x08, Striation=0x0f, Aurora=0x07, Reactive=0x06,
        // Cross=0x0b, Fireworks=0x10, Speed Respond=0x0c. Controls:
        // brightness/speed, fg/bg, full-color. DIRECTION where the app
        // exposes it (values mapped by the .ui button order,
        // app-register-verified):
        //   wave:   left=1 right=0 up=2 down=3 inward=5 outward=4
        //   radar:  clockwise=6 counter-clockwise=7
        //   striation: clockwise=6 counter-clockwise=7
        //   aurora: inward=5 outward=4
        //   speedrespond: up=2 down=3
        // Cross/Fireworks: no direction UI (row hidden); the app
        // commits the stored default (cross=0, fireworks=4).
        // Modes without a direction UI commit the app's stored default
        // (FUN_004a2cb0): neon/breath/twinkle/wave=0, radar=6,
        // autoripple=4, ripple=4, cross=0, fireworks=4.
        const MODES = { neon: 0x03, breath: 0x01, wave: 0x02, twinkle: 0x09, radar: 0x04, autoripple: 0x0e, ripple: 0x08, striation: 0x0f, aurora: 0x07, reactive: 0x06, cross: 0x0b, fireworks: 0x10, speedrespond: 0x0c };
        const DIRECTION_MAP = {
          wave: { left: 1, right: 0, up: 2, down: 3, inward: 5, outward: 4 },
          radar: { clockwise: 6, "counter-clockwise": 7 },
          striation: { clockwise: 6, "counter-clockwise": 7 },
          aurora: { inward: 5, outward: 4 },
          speedrespond: { up: 2, down: 3 },
        };
        const DIRECTION_DEFAULT = { neon: 0, breath: 0, twinkle: 0, wave: 0, radar: 6, autoripple: 4, ripple: 4, fireworks: 4 };
        const modeId = MODES[sub];
        const name = sub[0].toUpperCase() + sub.slice(1);
        const opts = { brightness: 4, speed: 3, fg: "ff0000", bg: "000000", fullColor: false, direction: 0 };
        for (let i = 1; i < args.length; i += 2) {
          const key = args[i];
          if (key === "--full-color") {
            opts.fullColor = true;
            i -= 1; // flag takes no value
            continue;
          }
          const val = args[i + 1];
          if (val === undefined) fail(`light ${sub}: ${key} needs a value`);
          if (key === "--brightness") opts.brightness = parseInt(val, 10);
          else if (key === "--speed") opts.speed = parseInt(val, 10);
          else if (key === "--fg") opts.fg = val;
          else if (key === "--bg") opts.bg = val;
          else if (key === "--direction" && DIRECTION_MAP[sub]) {
            const d = DIRECTION_MAP[sub][val.toLowerCase()];
            if (d === undefined) {
              fail(`light ${sub}: --direction must be ${Object.keys(DIRECTION_MAP[sub]).join("|")}`);
            }
            opts.direction = d;
          }
          else fail(`light ${sub}: unknown option ${key}`);
        }
        const range = (n, key, max) => {
          if (!Number.isInteger(n) || n < 0 || n > max) fail(`light ${sub}: ${key} must be 0-${max}`);
          return n;
        };
        const hex3 = (s, key) => {
          const b = Buffer.from(s, "hex");
          if (b.length !== 3) fail(`light ${sub}: ${key} must be RRGGBB`);
          return [b[0], b[1], b[2]];
        };
        const fg = hex3(opts.fg, "--fg");
        const bg = hex3(opts.bg, "--bg");
        await withSession(async (s) => {
          await s.commitLightEffect({
            mode: modeId,
            brightness: range(opts.brightness, "--brightness", 4),
            speed: range(opts.speed, "--speed", 4),
            fg, bg,
            direction: DIRECTION_MAP[sub] ? opts.direction : DIRECTION_DEFAULT[sub],
            fullColor: opts.fullColor,
          });
          out({
            mode: modeId.toString(16).padStart(2, "0"),
            name,
            brightness: opts.brightness,
            speed: opts.speed,
            fg: opts.fg,
            bg: opts.bg,
            direction: DIRECTION_MAP[sub] ? opts.direction : undefined,
            fullColor: opts.fullColor,
            set: true,
          });
        });
      } else if (sub === "custom") {
        // Custom = mode 0x0a on the wire (app-register-verified:
        // `0a 02 02 00 00 ff 00 00 00 00 00 01`). The app's UI only
        // exposes brightness + fg; speed/bg/full-color keep the
        // profile's stored values (observed: speed=2, fullColor=1 —
        // the app's defaults for a new Custom record, FUN_004a2cb0).
        // The active pattern (alphabet / WASD+Arrows / custom3/4/5) is
        // NOT selected by this commit — it lives in the device's
        // stored custom layer, uploaded by the app as profile XML via
        // the 0x18 onboard-data path (not yet implemented here).
        const opts = { brightness: 2, fg: "ff0000" };
        for (let i = 1; i < args.length; i += 2) {
          const key = args[i];
          const val = args[i + 1];
          if (val === undefined) fail(`light custom: ${key} needs a value`);
          if (key === "--brightness") opts.brightness = parseInt(val, 10);
          else if (key === "--fg") opts.fg = val;
          else fail(`light custom: unknown option ${key}`);
        }
        if (!Number.isInteger(opts.brightness) || opts.brightness < 0 || opts.brightness > 4) {
          fail("light custom: --brightness must be 0-4");
        }
        const b = Buffer.from(opts.fg, "hex");
        if (b.length !== 3) fail("light custom: --fg must be RRGGBB");
        await withSession(async (s) => {
          await s.commitLightEffect({
            mode: 0x0a,
            brightness: opts.brightness,
            speed: 2,
            fg: [b[0], b[1], b[2]],
            bg: [0, 0, 0],
            direction: 0,
            fullColor: true,
          });
          out({
            mode: "0a",
            name: "Custom",
            brightness: opts.brightness,
            fg: opts.fg,
            note: "pattern = whatever the device has stored (alphabet/WASD/custom3-5 selection needs the XML upload)",
            set: true,
          });
        });
      } else if (sub === "custom-stream") {
        // Stream a custom-light pattern from a profile XML via wire 0x0f
        // (the app's live-preview path — usb6.log-verified). The custom
        // layer lives in device RAM: shows while this process streams,
        // lost on power cycle (same as the app).
        //   light custom-stream --xml <file> [--index 0-4] [--color RRGGBB]
        //                     [--brightness 0-4]
        const opts = { index: 0, color: null, brightness: 4 };
        for (let i = 1; i < args.length; i += 2) {
          const key = args[i];
          const val = args[i + 1];
          if (val === undefined) fail(`light custom-stream: ${key} needs a value`);
          if (key === "--xml") opts.xml = val;
          else if (key === "--index") opts.index = parseInt(val, 10);
          else if (key === "--color") opts.color = val;
          else if (key === "--brightness") opts.brightness = parseInt(val, 10);
          else fail(`light custom-stream: unknown option ${key}`);
        }
        if (!opts.xml) fail("light custom-stream --xml <profile.xml>");
        const fs = await import("node:fs");
        const { decode } = await import("@m68/protocol");
        const xmlText = fs.readFileSync(opts.xml, "utf8");
        const items = decode.parseCustomLed(xmlText, opts.index);
        if (!items || items.length === 0) fail(`no customLed index ${opts.index} in ${opts.xml}`);
        let colorOverride = null;
        if (opts.color) {
          const cb = Buffer.from(opts.color, "hex");
          if (cb.length !== 3) fail("light custom-stream: --color must be RRGGBB");
          colorOverride = [cb[0], cb[1], cb[2]];
        }
        const grid = Buffer.alloc(396); // 132 slots × RGB, slot = row*22+col
        for (const it of items) {
          const rgb = colorOverride ?? it.rgb;
          const s = (it.row * 22 + it.col) * 3;
          grid[s] = rgb[0]; grid[s + 1] = rgb[1]; grid[s + 2] = rgb[2];
        }
        await withSession(async (s) => {
          await s.commitLightEffect({
            mode: 0x0a,
            brightness: opts.brightness,
            speed: 2,
            fg: colorOverride ?? [255, 255, 255],
            bg: [0, 0, 0],
            direction: 0,
            fullColor: true,
          });
          out({ streaming: true, items: items.length, color: colorOverride, note: "RAM-only; Ctrl-C to stop" });
          await s.streamGrid(grid, { preamble: true });
          for (;;) {
            await new Promise((r) => setTimeout(r, 1200));
            await s.streamGrid(grid);
          }
        });
      } else if (sub === "mode") {
        const name = (args[1] ?? "").toLowerCase();
        const named = Object.entries(EFFECT).find(([, n]) => n.toLowerCase() === name);
        const id = named ? Number(named[0]) : parseInt(args[1], 16);
        if (Number.isNaN(id)) fail("light mode <id|name>");
        await withSession(async (s) => {
          await s.commitLightMode(id, 0x04, 0x03);
          out({ mode: id.toString(16), name: EFFECT[id] ?? "?", set: true });
        });
      } else if (sub === "off") {
        // no dedicated off mode — dark = Static with brightness 0
        await withSession(async (s) => {
          await s.commitLightMode(0x00, 0x00, 0x03);
          out({ mode: "00", brightness: 0, off: true });
        });
      } else {
        fail("light: unknown subcommand (modes|config|static|neon|breath|wave|twinkle|radar|autoripple|ripple|striation|aurora|reactive|cross|fireworks|speedrespond|custom|custom-stream|mode|off)");
      }
      break;
    }

    case "side": {
      const sub = args[0];
      if (sub === "modes") {
        await withSession(async (s) => out(await s.sideModeList()));
      } else if (sub === "config") {
        await withSession(async (s) => out(await s.sideConfig()));
      } else {
        fail("side: unknown subcommand (modes|config)");
      }
      break;
    }

    case "sleep": {
      await withSession(async (s) => out(await s.sleepTime()));
      break;
    }

    case "sensitivity": {
      const subs = args.length ? [parseInt(args[0], 16)] : [4, 9, 10];
      await withSession(async (s) => {
        for (const sub of subs) {
          out({ sub, ...(await s.sensitivity(sub)) });
        }
      });
      break;
    }

    case "layout": {
      await withSession(async (s) => out(await s.customLayoutSupport()));
      break;
    }

    case "keymap": {
      const store = loadStore();
      const sub = args[0];
      const { profile, args: rest } = takeProfile(args.slice(1), store);
      if (sub === "show") {
        const map = keymap.applyRemaps(keymap.stockKeymap(), store.profiles[profile].keymap);
        const stock = keymap.stockKeymap();
        const remaps = [];
        for (let r = 0; r < keymap.MATRIX_ROWS; r++) {
          const cells = [];
          for (let c = 0; c < keymap.MATRIX_COLS; c++) {
            const slot = r * keymap.MATRIX_COLS + c;
            if (slot === keymap.FN_SLOT) { cells.push("Fn"); continue; }
            const marker = map[slot * 4];
            const kc = map[slot * 4 + 1];
            if (!marker && !kc) { cells.push("·"); continue; }
            const name = keymap.entryLabel(marker, kc);
            if (marker !== stock[slot * 4] || kc !== stock[slot * 4 + 1]) {
              cells.push(`${name}←${keymap.SLOT_NAME[slot]}`);
              remaps.push(`${keymap.SLOT_NAME[slot]} -> ${name}`);
            } else {
              cells.push(name);
            }
          }
          console.log(cells.join(" "));
        }
        out({ profile, remaps: remaps.length ? remaps : "(stock)" });
      } else if (sub === "set") {
        const uploadFlag = rest.includes("--upload");
        const pairs = rest.filter((p) => p !== "--upload");
        if (!pairs.length) fail("keymap set KEY=TARGET ... (e.g. keymap set PageUp=PrintScreen)");
        const overrides = {};
        for (const pair of pairs) {
          const [k, t] = pair.split("=");
          if (!k || !t) fail(`keymap set: bad pair "${pair}" (want KEY=TARGET)`);
          const slot = slotFromName(k);
          if (slot === undefined) fail(`keymap set: unknown key "${k}" (physical keys only)`);
          const target = parseTarget(t);
          if (target === undefined) fail(`keymap set: unknown target "${t}"`);
          if (typeof target === "string") {
            const [kind, val] = target.split(":");
            const id = Number(val);
            if (kind === "media" && !(id in keymap.MEDIA_WIRE)) fail(`keymap set: bad media id in "${t}"`);
            if (kind === "mouse" && !(id in keymap.MOUSE_NAMES)) fail(`keymap set: bad mouse id in "${t}"`);
          } else if (target < 0 || target > 0xff) {
            fail(`keymap set: bad target keycode in "${t}"`);
          }
          overrides[slot] = target;
        }
        const changed = [];
        for (const [slot, target] of Object.entries(overrides)) {
          const old = store.profiles[profile].keymap[slot];
          store.profiles[profile].keymap[slot] = target;
          changed.push(
            `${keymap.SLOT_NAME[slot]} -> ${keymap.targetLabel(target)}` +
            (old !== undefined ? ` (was ${keymap.targetLabel(old)})` : "")
          );
        }
        saveStore(store);
        if (uploadFlag) {
          await withSession(async (s) => {
            const map = keymap.applyRemaps(keymap.stockKeymap(), store.profiles[profile].keymap);
            await s.uploadKeymap(map);
            out({ profile, uploaded: true, changed, note: "full Download sequence (0x18+0x19+0x22)" });
          });
        } else {
          out({ profile, stored: true, changed, note: "use `keymap upload` to push to the board" });
        }
      } else if (sub === "reset") {
        const n = Object.keys(store.profiles[profile].keymap).length;
        store.profiles[profile].keymap = {};
        saveStore(store);
        out({ profile, reset: true, cleared: n });
      } else if (sub === "upload") {
        const minimal = rest.includes("--minimal"); // probe P1: seg[0] only
        await withSession(async (s) => {
          const map = keymap.applyRemaps(keymap.stockKeymap(), store.profiles[profile].keymap);
          if (minimal) {
            await s.uploadKeymapMinimal(map);
          } else {
            await s.uploadKeymap(map);
          }
          const n = Object.keys(store.profiles[profile].keymap).length;
          out({ profile, uploaded: true, remaps: n, note: minimal ? "PROBE: 0x18 seg[0] only" : "full Download sequence (0x18+0x19+0x22)" });
        });
      } else {
        fail("keymap: unknown subcommand (show|set|reset|upload)");
      }
      break;
    }

    case "profile": {
      const store = loadStore();
      const sub = args[0];
      if (sub === "list") {
        for (let i = 0; i < PROFILE_COUNT; i++) {
          const remaps = Object.entries(store.profiles[i].keymap).map(
            ([slot, kc]) => `${keymap.SLOT_NAME[slot]} -> ${keymap.targetLabel(kc)}`
          );
          console.log(`  profile ${i}${i === store.current ? " *" : ""}: remaps=${remaps.length ? remaps.join(", ") : "(none)"}`);
        }
        out({ current: store.current });
      } else if (sub === "use") {
        const n = parseInt(args[1], 10);
        if (!Number.isInteger(n) || n < 0 || n >= PROFILE_COUNT) fail(`profile use <0-${PROFILE_COUNT - 1}>`);
        store.current = n;
        saveStore(store);
        out({ current: n });
      } else if (sub === "current") {
        out({ current: store.current });
      } else if (sub === "import" || sub === "export") {
        // Profiles are an XML concept (the app's per-profile XML
        // files). import: merge the file's <keyEvent> items
        // (operateType 0, non-identity) into the profile's remaps.
        // export: write the profile's remaps as an app-shaped
        // <keyEvent> section (best-effort — the app's loader may
        // want the full file; use the app's own XML as a template).
        const { profile, args: rest } = takeProfile(args.slice(1), store);
        const file = rest[0];
        if (!file) fail(`profile ${sub} <file.xml>`);
        const fs = await import("node:fs");
        if (sub === "import") {
          const xml = fs.readFileSync(file, "utf8");
          const keyEvent = xml.match(/<keyEvent>([\s\S]*?)<\/keyEvent>/);
          if (!keyEvent) fail(`${file}: no <keyEvent> section`);
          const items = [...keyEvent[1].matchAll(/<item\s+[^>]*\/>/g)].map((m) => m[0]);
          let added = 0, skipped = 0;
          for (const it of items) {
            const kc = it.match(/keyCode="(-?\d+)"/)?.[1];
            const op = it.match(/operateType="(\d+)"/)?.[1];
            const val = it.match(/Value="(-?\d+)"/)?.[1];
            if (op !== "0" || kc === undefined || val === undefined) { skipped++; continue; }
            const slot = keymap.PHYSICAL_KEYS.find(([, k]) => k === Number(kc))?.[0];
            if (slot === undefined) { skipped++; continue; }
            if (Number(val) === Number(kc)) { skipped++; continue; } // identity item = no-op
            store.profiles[profile].keymap[slot] = Number(val);
            added++;
          }
          saveStore(store);
          out({ profile, imported: true, added, skipped, note: "remaps merged into the profile" });
        } else {
          const items = Object.entries(store.profiles[profile].keymap).map(([slot, kc]) => {
            const keyCode = keymap.stockKeymap()[slot * 4 + 1];
            const keyChar = keymap.KEY_NAME[kc] ?? `0x${kc.toString(16)}`;
            return `<item keyCode="${keyCode}" keyChar="${keyChar}" operateType="0" repeatNum="1" mode="1" Value="${kc}"/>`;
          });
          const xml = `<?xml version="1.0" encoding="UTF-8" ?>\n<Parameters profileIndex="${profile + 1}">\n<config index="${profile + 1}" name="Profile${profile + 1}" proFileAppName="" proFileAppIco="">\n<keyEvent>\n${items.map((i) => "    " + i).join("\n")}\n</keyEvent>\n</config>\n</Parameters>\n`;
          fs.writeFileSync(file, xml);
          out({ profile, exported: true, file, items: items.length, note: "app-shaped <keyEvent> section; best-effort" });
        }
      } else {
        fail("profile: unknown subcommand (list|use|current|import|export)");
      }
      break;
    }

    case "session": {
      // full verified session, printing every step + response
      const t = new HidrawTransport();
      const s = new M68Session(t);
      try {
        console.log("== 1. device info (0x0D) ==");
        const info = await s.handshake();
        console.log(`   ${JSON.stringify(info.info)}`);
        console.log(`   build date: ${info.buildDate?.raw ?? "n/a"}`);
        console.log("== 2. serial (0x15) ==");
        console.log(`   ${(await s.serial()).hex}`);
        console.log("== 3. mode list (0x0A) ==");
        const modes = await s.lightModeList();
        for (const [i, id] of modes.ids.entries()) {
          console.log(`   ${String(i).padStart(2)}. ${id.toString(16).padStart(2, "0")} ${EFFECT[id] ?? "?"}`);
        }
        console.log("== 4. light config (0x07) ==");
        console.log(`   ${JSON.stringify(await s.lightConfig())}`);
        console.log("== 5. HE sensitivity (0x21) ==");
        for (const sub of [4, 9, 10]) console.log(`   ${JSON.stringify(await s.sensitivity(sub))}`);
      } finally {
        s.close();
      }
      break;
    }

    default:
      fail(`unknown command "${cmd}"`);
  }
}

main().catch((e) => fail(e.message));
