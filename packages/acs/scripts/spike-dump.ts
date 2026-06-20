// Cycle 1 spike dumper. Decodes a raw .acs and writes, under scripts/out/<char>/:
//   img/NNNN.png      every decoded unique image
//   animations.json   the parsed animation table (names + per-frame refs/offsets/durations)
//   summary.json      { imageCount, animationCount, width, height, paletteSize, transparentIndex }
// and, if an animation name is given, anim/<name>/NN.png composited frames.
//
// Usage: pnpm --filter @vivify/acs spike <path/to/Character.acs> [AnimationName]
// Output is gitignored (scripts/out/). Never commit decoded MS assets.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { PNG } from 'pngjs';
import type { ImageModel } from '@vivify/types';
import { parseAcs } from '../src/parse.js';

function writePng(path: string, width: number, height: number, rgba: Uint8ClampedArray): void {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  writeFileSync(path, PNG.sync.write(png));
}

function blit(
  dst: Uint8ClampedArray,
  dw: number,
  dh: number,
  img: ImageModel,
  ox: number,
  oy: number,
): void {
  for (let y = 0; y < img.height; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= dh) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= dw) continue;
      const s = (y * img.width + x) * 4;
      if ((img.rgba[s + 3] ?? 0) === 0) continue; // transparent pixel
      const d = (ty * dw + tx) * 4;
      dst[d] = img.rgba[s] ?? 0;
      dst[d + 1] = img.rgba[s + 1] ?? 0;
      dst[d + 2] = img.rgba[s + 2] ?? 0;
      dst[d + 3] = 255;
    }
  }
}

function main(): void {
  const file = process.argv[2];
  const animName = process.argv[3];
  if (!file) {
    console.error('usage: tsx scripts/spike-dump.ts <file.acs> [AnimationName]');
    process.exit(1);
  }

  const char = basename(file, extname(file)).toLowerCase();
  const outDir = join('scripts', 'out', char);
  mkdirSync(join(outDir, 'img'), { recursive: true });

  const parsed = parseAcs(readFileSync(file));

  parsed.images.forEach((img, i) => {
    if (img.width > 0 && img.height > 0) {
      writePng(
        join(outDir, 'img', `${String(i).padStart(4, '0')}.png`),
        img.width,
        img.height,
        img.rgba,
      );
    }
  });

  writeFileSync(join(outDir, 'animations.json'), JSON.stringify(parsed.animations, null, 2));
  writeFileSync(
    join(outDir, 'summary.json'),
    JSON.stringify(
      {
        imageCount: parsed.images.length,
        animationCount: parsed.animations.length,
        width: parsed.info.width,
        height: parsed.info.height,
        paletteSize: parsed.palette.length,
        transparentIndex: parsed.transparentIndex,
      },
      null,
      2,
    ),
  );

  if (animName) {
    const anim = parsed.animations.find((a) => a.name.toLowerCase() === animName.toLowerCase());
    if (!anim) {
      console.error(
        `animation "${animName}" not found. Names: ${parsed.animations.map((a) => a.name).join(', ')}`,
      );
    } else {
      const dir = join(outDir, 'anim', anim.name);
      mkdirSync(dir, { recursive: true });
      const cw = parsed.info.width;
      const ch = parsed.info.height;
      anim.frames.forEach((frame, fi) => {
        const canvas = new Uint8ClampedArray(cw * ch * 4);
        for (const ref of frame.images) {
          const img = parsed.images[ref.imageIndex];
          if (img && img.width > 0 && img.height > 0) blit(canvas, cw, ch, img, ref.x, ref.y);
        }
        writePng(join(dir, `${String(fi).padStart(2, '0')}.png`), cw, ch, canvas);
      });
      console.log(`composited ${anim.frames.length} frames of "${anim.name}" -> ${dir}`);
    }
  }

  console.log(
    `${char}: ${parsed.images.length} images, ${parsed.animations.length} animations, ` +
      `palette ${parsed.palette.length}, transparent #${parsed.transparentIndex} -> ${outDir}`,
  );
}

main();
