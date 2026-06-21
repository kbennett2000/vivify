// Load a CharacterModel for rendering, from either a raw .acs ArrayBuffer
// (parseAcs runtime path) or a CharacterBundleRef (fetch manifest.json + sheet.png,
// crop atlas cells). Both yield a CharacterModel with images[].rgba so the
// compositor only deals with pixels. Browser path (fetch + canvas PNG decode);
// validated via the harness. See ADR-0012.

import type { CharacterModel, ImageModel } from '@vivify/types';
import { parseAcs, cropCell, type BundleManifest } from '@vivify/acs';
import type { CharacterBundleRef } from './types.js';

export async function loadCharacter(
  source: ArrayBuffer | CharacterBundleRef,
): Promise<CharacterModel> {
  if (source instanceof ArrayBuffer) return parseAcs(source);
  return loadBundle(source);
}

async function loadBundle(ref: CharacterBundleRef): Promise<CharacterModel> {
  const manifestRes = await fetch(ref.manifestUrl);
  const manifest = (await manifestRes.json()) as BundleManifest;
  const sheetUrl = new URL(manifest.sheet, ref.manifestUrl).href;
  const sheet = await decodePng(sheetUrl);

  const images: ImageModel[] = manifest.atlas.map((cell) => {
    if (cell.w === 0 || cell.h === 0) {
      return { width: cell.w, height: cell.h, rgba: new Uint8ClampedArray(0) };
    }
    return { width: cell.w, height: cell.h, rgba: cropCell(sheet, cell) };
  });

  return {
    info: manifest.info,
    palette: manifest.palette,
    transparentIndex: manifest.transparentIndex,
    images,
    sounds: [], // bundle audio is file-referenced; not needed for silent rendering
    animations: manifest.animations,
    balloon: manifest.balloon,
    voice: manifest.voice,
    states: manifest.states,
  };
}

async function decodePng(url: string): Promise<{ width: number; rgba: Uint8ClampedArray }> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('loadBundle: 2D canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  return { width: bitmap.width, rgba: data };
}
