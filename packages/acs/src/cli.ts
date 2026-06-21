// acs2bundle — converts a raw .acs into a web-ready vivify bundle:
//   <outDir>/sheet.png      packed transparent sprite-sheet of every unique image
//   <outDir>/manifest.json  the full CharacterModel minus pixels/WAVs (zod-validated)
//   <outDir>/audio/NNN.wav  extracted sounds
//
// Node-only (fs + pngjs). This is the ONLY .acs module that touches Node — the
// importable package entry (parse/sheet/bundle-build) stays browser-safe.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { parseAcs } from './parse.js';
import { packSheet } from './sheet.js';
import { buildManifest, type SoundRef } from './bundle-build.js';

export function convert(inputPath: string, outDir: string): void {
  const model = parseAcs(readFileSync(inputPath));
  const packed = packSheet(model.images);

  mkdirSync(outDir, { recursive: true });

  // sheet.png
  const png = new PNG({ width: packed.width, height: packed.height });
  png.data = Buffer.from(packed.rgba.buffer, packed.rgba.byteOffset, packed.rgba.byteLength);
  writeFileSync(join(outDir, 'sheet.png'), PNG.sync.write(png));

  // audio/NNN.wav
  const soundRefs: SoundRef[] = [];
  if (model.sounds.length > 0) {
    mkdirSync(join(outDir, 'audio'), { recursive: true });
    model.sounds.forEach((sound, i) => {
      const src = `audio/${String(i).padStart(3, '0')}.wav`;
      writeFileSync(join(outDir, src), Buffer.from(sound.wav));
      soundRefs.push({ src });
    });
  }

  // manifest.json (zod-validated inside buildManifest)
  const manifest = buildManifest(model, packed.atlas, 'sheet.png', soundRefs);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `acs2bundle: ${model.images.length} images, ${model.animations.length} animations, ` +
      `${model.sounds.length} sounds, sheet ${packed.width}x${packed.height} -> ${outDir}`,
  );
}

function main(argv: string[]): void {
  const input = argv[0];
  const outDir = argv[1];
  if (!input || !outDir) {
    console.error('usage: acs2bundle <input.acs> <outDir>');
    process.exit(1);
  }
  convert(input, outDir);
}

main(process.argv.slice(2));
