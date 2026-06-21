// Pure helpers for the MASH demo (no DOM, no engine) — unit-tested in CI.
// Built-in characters are LOCAL ONLY: bundles live under the gitignored
// public/characters/ dir and are listed in public/characters/index.json. The
// committed/deployed app ships none (IP gate); upload is the out-of-the-box path.

export interface BuiltinCharacter {
  id: string;
  label: string;
}

/**
 * Parse/normalize the optional public/characters/index.json into a clean list.
 * Tolerant of junk (returns [] for anything unexpected). Ids are restricted to a
 * safe charset so they can't escape the /characters/<id>/ path.
 */
export function parseBuiltinIndex(data: unknown): BuiltinCharacter[] {
  if (!Array.isArray(data)) return [];
  const out: BuiltinCharacter[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
    const label = typeof record.label === 'string' && record.label.length > 0 ? record.label : id;
    out.push({ id, label });
  }
  return out;
}

/** Web path to a built-in bundle's manifest (served from public/characters/). */
export function builtinManifestUrl(id: string): string {
  return `/characters/${encodeURIComponent(id)}/manifest.json`;
}

/** UI guard: does this look like a .acs upload (by extension)? */
export function isAcsFile(file: { name: string }): boolean {
  return /\.acs$/i.test(file.name);
}

/** Default voice server URL when none is configured (the local voice container, Cycle 9). */
export const DEFAULT_VOICE_SERVER_URL = 'http://localhost:8080';

/**
 * Resolve the initial "Voice server URL" value. A configured value (e.g. the build-time
 * `VITE_VOICE_SERVER_URL`) wins after trimming; anything blank/whitespace/undefined falls
 * back to the local voice service so sound works out of the box when its container is up
 * (Cycle 9). The field stays runtime-editable, and clearing it goes silent.
 */
export function resolveVoiceServerUrl(raw: string | undefined): string {
  return raw?.trim() || DEFAULT_VOICE_SERVER_URL;
}
