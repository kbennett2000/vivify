// Build a bundle manifest from a parsed CharacterModel + packed atlas (pure;
// browser-safe). The manifest is the IR minus pixel/WAV bytes: images -> atlas
// coords + sheet filename, sounds -> file refs. Validated against the Cycle 0
// zod schema before it is returned (throws on any mismatch).

import type { CharacterModel } from '@vivify/types';
import type { AtlasEntry } from './sheet.js';
import { FORMAT_VERSION, validateBundleManifest, type BundleManifest } from './bundle.js';

export interface SoundRef {
  src: string;
}

export function buildManifest(
  model: CharacterModel,
  atlas: AtlasEntry[],
  sheetName: string,
  soundRefs: SoundRef[],
): BundleManifest {
  const info =
    model.info.name !== undefined
      ? {
          guid: model.info.guid,
          name: model.info.name,
          width: model.info.width,
          height: model.info.height,
        }
      : { guid: model.info.guid, width: model.info.width, height: model.info.height };

  const manifest = {
    formatVersion: FORMAT_VERSION,
    info,
    palette: model.palette,
    transparentIndex: model.transparentIndex,
    sheet: sheetName,
    atlas,
    animations: model.animations,
    sounds: soundRefs,
    balloon: model.balloon,
    voice: model.voice,
    states: model.states,
  };

  // zod parse: enforces the schema (and the manifest<->IR type-sync guard lives in bundle.ts).
  return validateBundleManifest(manifest);
}
