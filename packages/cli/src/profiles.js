// Profile store for m68ctl — the CLI's working copy of the app's 3
// profile XMLs (0-based: CLI 0/1/2 = the app's profiles 1/2/3).
//
// Profiles are an XML concept only (notes/12, P2-verified): the
// device has no profile register and holds whatever keymap was last
// uploaded. The store keeps, per profile, the keymap remap overrides
// ({slot: targetKeyCode}) — the compiled form of the profile's
// `<keyEvent>` items. `profile import/export` bridges to the app's
// per-profile XML files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROFILE_COUNT = 3;
export const STORE_PATH = path.join(os.homedir(), ".m68", "profiles.json");

export function emptyStore() {
  return {
    current: 0,
    profiles: Array.from({ length: PROFILE_COUNT }, () => ({ keymap: {} })),
  };
}

export function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!s || !Array.isArray(s.profiles)) return emptyStore();
    while (s.profiles.length < PROFILE_COUNT) s.profiles.push({ keymap: {} });
    s.profiles = s.profiles.slice(0, PROFILE_COUNT).map((p) => ({
      keymap: p?.keymap && typeof p.keymap === "object" ? p.keymap : {},
    }));
    if (!Number.isInteger(s.current) || s.current < 0 || s.current >= PROFILE_COUNT) {
      s.current = 0;
    }
    return s;
  } catch {
    return emptyStore();
  }
}

export function saveStore(s) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2) + "\n");
}

/**
 * Pull `--profile N` out of a flat args array.
 * Returns { profile: number|null (defaults to the store's current),
 *            args: remaining args }.
 */
export function takeProfile(args, store) {
  const rest = [];
  let profile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile") {
      if (args[i + 1] === undefined) throw new Error("--profile needs a value (0-2)");
      profile = parseInt(args[i + 1], 10);
      i++;
    } else {
      rest.push(args[i]);
    }
  }
  if (profile !== null && (!Number.isInteger(profile) || profile < 0 || profile >= PROFILE_COUNT)) {
    throw new Error(`--profile must be 0-${PROFILE_COUNT - 1}`);
  }
  return { profile: profile ?? store.current, args: rest };
}
