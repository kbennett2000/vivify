// GIF encoding for the docs-capture script. Takes a sequence of PNG buffers
// (element screenshots from Playwright), optionally downscales them, and writes
// an animated GIF — pure JS, no system ffmpeg. pngjs decodes each PNG to RGBA;
// gifenc quantizes to a 256-colour palette and encodes the frames.

import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
// gifenc ships a CommonJS build with no `exports` map, so Node's ESM loader can't
// reliably see its named exports — default-import the module and destructure.
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, length = width * height * 4
}

function decodePng(buffer: Buffer): RgbaFrame {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: Uint8Array.from(png.data) };
}

// Nearest-neighbour downscale so GIFs stay small. No-op if already within maxWidth.
function downscale(frame: RgbaFrame, maxWidth: number): RgbaFrame {
  if (frame.width <= maxWidth) return frame;
  const scale = maxWidth / frame.width;
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(frame.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(frame.width - 1, Math.floor(x / scale));
      const si = (sy * frame.width + sx) * 4;
      const di = (y * width + x) * 4;
      data[di] = frame.data[si] ?? 0;
      data[di + 1] = frame.data[si + 1] ?? 0;
      data[di + 2] = frame.data[si + 2] ?? 0;
      data[di + 3] = frame.data[si + 3] ?? 255;
    }
  }
  return { width, height, data };
}

export interface GifOptions {
  /** Delay between frames, in ms. */
  delayMs: number;
  /** Downscale frames wider than this (px). */
  maxWidth: number;
}

/** Encode PNG frame buffers into an animated GIF at `outPath`. */
export function encodeGif(pngFrames: Buffer[], outPath: string, opts: GifOptions): void {
  if (pngFrames.length === 0) throw new Error('encodeGif: no frames captured');
  const encoder = GIFEncoder();
  for (const buffer of pngFrames) {
    const frame = downscale(decodePng(buffer), opts.maxWidth);
    const palette = quantize(frame.data, 256);
    const indexed = applyPalette(frame.data, palette);
    encoder.writeFrame(indexed, frame.width, frame.height, { palette, delay: opts.delayMs });
  }
  encoder.finish();
  writeFileSync(outPath, encoder.bytes());
}
