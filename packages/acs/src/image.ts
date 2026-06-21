// Indexed pixels -> RGBA. Applies the palette and the color-key (transparency
// index -> alpha 0). .acs image rows are stored bottom-up (DIB convention); we
// emit top-down RGBA for the IR. See docs/cycles/cycle-1-findings.md.

import type { ImageModel, Rgb } from '@vivify/types';

/** Row stride in bytes for an 8-bit indexed image, padded to a 4-byte multiple. */
export function rowStride(width: number): number {
  return (width + 3) & ~3;
}

/** Decoded byte count for an 8-bit indexed image of the given dimensions. */
export function indexedByteSize(width: number, height: number): number {
  return rowStride(width) * height;
}

export function indicesToImageModel(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: Rgb[],
  transparentIndex: number,
): ImageModel {
  const stride = rowStride(width);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * stride; // bottom-up -> top-down
    for (let x = 0; x < width; x++) {
      const idx = indices[srcRow + x] ?? 0;
      const rgb = palette[idx] ?? ([0, 0, 0] as Rgb);
      const o = (y * width + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = idx === transparentIndex ? 0 : 255;
    }
  }
  return { width, height, rgba };
}
