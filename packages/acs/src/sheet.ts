// Sprite-sheet packer (pure; browser-safe). Packs every decoded image into one
// transparent RGBA atlas via simple shelf bin-packing. The atlas table is
// parallel to images[] (atlas[i] is image i's cell). Cells are copied verbatim
// with no intra-cell padding, so cropping atlas[i] from the sheet reproduces
// images[i] pixel-for-pixel (the Cycle 2 lossless round-trip; ADR-0009).

import type { ImageModel } from '@vivify/types';

export interface AtlasEntry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackedSheet {
  width: number;
  height: number;
  /** RGBA, transparent background (alpha 0 between/around cells). */
  rgba: Uint8ClampedArray;
  /** Placement of each image; parallel to the input images[]. */
  atlas: AtlasEntry[];
}

export interface PackOptions {
  /** Shelf wrap width in pixels (default 2048). */
  maxWidth?: number;
  /** Transparent gap between cells (default 1). */
  padding?: number;
}

export function packSheet(images: ImageModel[], opts: PackOptions = {}): PackedSheet {
  const maxWidth = opts.maxWidth ?? 2048;
  const padding = opts.padding ?? 1;

  // 1) Lay out cells (shelf packing).
  const atlas: AtlasEntry[] = new Array(images.length);
  let penX = 0;
  let shelfY = 0;
  let shelfH = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    if (img.width <= 0 || img.height <= 0) {
      atlas[i] = { x: 0, y: 0, w: 0, h: 0 };
      continue;
    }
    if (penX > 0 && penX + img.width > maxWidth) {
      penX = 0;
      shelfY += shelfH + padding;
      shelfH = 0;
    }
    atlas[i] = { x: penX, y: shelfY, w: img.width, h: img.height };
    penX += img.width + padding;
    if (img.height > shelfH) shelfH = img.height;
  }

  // 2) Sheet dimensions from the placements.
  let width = 1;
  let height = 1;
  for (const cell of atlas) {
    if (cell.w === 0 || cell.h === 0) continue;
    if (cell.x + cell.w > width) width = cell.x + cell.w;
    if (cell.y + cell.h > height) height = cell.y + cell.h;
  }

  // 3) Blit each image into its cell.
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const cell = atlas[i]!;
    if (cell.w === 0 || cell.h === 0) continue;
    for (let row = 0; row < img.height; row++) {
      const src = row * img.width * 4;
      const dst = ((cell.y + row) * width + cell.x) * 4;
      rgba.set(img.rgba.subarray(src, src + img.width * 4), dst);
    }
  }

  return { width, height, rgba, atlas };
}

/** Crop a cell back out of a packed sheet — the inverse of packing (for round-trip checks). */
export function cropCell(
  sheet: Pick<PackedSheet, 'width' | 'rgba'>,
  cell: AtlasEntry,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cell.w * cell.h * 4);
  for (let row = 0; row < cell.h; row++) {
    const src = ((cell.y + row) * sheet.width + cell.x) * 4;
    out.set(sheet.rgba.subarray(src, src + cell.w * 4), row * cell.w * 4);
  }
  return out;
}
