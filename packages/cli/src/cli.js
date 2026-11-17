#!/usr/bin/env node
// m68ctl — configure the Womier M68 HE from Linux.
// Verified commands only (notes/09-session-flow.md).
import { M68Session, CMD, buildFrame, checkResponse, hexdump, ascii, EFFECT } from "@m68/protocol";
import { HidrawTransport } from "./hidraw.js";

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
  session                  full demo: every verified step, printed
`;

function out(obj) {
  console.log(obj);
}

function fail(msg) {
  console.error(`m68ctl: ${msg}`);
  process.exit(1);
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
