// Cycle 2 acceptance (docs/cycles/cycle-2-converter.md): the full parser decodes
// every .acs block, and acs2bundle's pure building blocks (sheet packing +
// manifest) round-trip losslessly.
//
// Group 1 parses a hand-built synthetic .acs (our own bytes, zero Microsoft IP)
// and asserts the IR against an independently-authored expectation table
// (syntheticExpected) — never against the parser's own output. This runs in CI
// with no fixture files present, which is the whole point of the synthetic.
//
// Group 2 exercises the sheet/manifest round-trip on the synthetic model in CI,
// then repeats the same checks against the real gitignored fixtures locally
// (skipped in CI when the .acs files are absent).

import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseAcs } from '../src/parse.js';
import type { ParsedCharacter } from '../src/parse.js';
import { packSheet, cropCell } from '../src/sheet.js';
import { buildManifest } from '../src/bundle-build.js';
import { decodeImageData } from '../src/rle.js';
import { FORMAT_VERSION } from '../src/bundle.js';
import { buildSyntheticAcs, rleEncodeLiterals, syntheticExpected } from './synthetic/build-acs.js';

// ---------------------------------------------------------------------------
// Group 1 — full parser against the synthetic fixture (CI).
// ---------------------------------------------------------------------------

describe('parseAcs decodes the synthetic .acs across every block', () => {
  const model = parseAcs(buildSyntheticAcs());

  it('decodes info: width, height, and name', () => {
    expect(model.info.width).toBe(syntheticExpected.width);
    expect(model.info.height).toBe(syntheticExpected.height);
    expect(model.info.name).toBe(syntheticExpected.name);
  });

  it('decodes the palette length and transparent index', () => {
    expect(model.palette.length).toBe(syntheticExpected.paletteLength);
    expect(model.transparentIndex).toBe(syntheticExpected.transparentIndex);
  });

  it('decodes every image at the expected dimensions', () => {
    expect(model.images.length).toBe(syntheticExpected.imageCount);
    for (const img of model.images) {
      expect(img.width).toBe(syntheticExpected.imageWidth);
      expect(img.height).toBe(syntheticExpected.imageHeight);
    }
  });

  it('decodes animation names in order', () => {
    expect(model.animations.map((a) => a.name)).toEqual([...syntheticExpected.animationNames]);
  });

  it('captures Greet returnAnimation, frame-0 branch + mouth, and frame-1 exitFrame', () => {
    const greet = model.animations[1]!;
    expect(greet.name).toBe('Greet');
    expect(greet.returnAnimation).toBe(syntheticExpected.greetReturnAnimation);

    const frame0 = greet.frames[0]!;
    expect(frame0.branches[0]).toEqual(syntheticExpected.greetFrame0Branch);
    expect(frame0.mouth).toBeDefined();

    const frame1 = greet.frames[1]!;
    expect(frame1.exitFrame).toBe(0);
  });

  it('decodes the state map', () => {
    expect(model.states).toEqual(syntheticExpected.states);
  });

  it('decodes the sound count', () => {
    expect(model.sounds.length).toBe(syntheticExpected.soundCount);
  });

  it('decodes balloon config', () => {
    expect(model.balloon.numLines).toBe(syntheticExpected.balloon.numLines);
    expect(model.balloon.charsPerLine).toBe(syntheticExpected.balloon.charsPerLine);
    expect(model.balloon.fontName).toBe(syntheticExpected.balloon.fontName);
    expect(model.balloon.fontHeight).toBe(syntheticExpected.balloon.fontHeight);
  });

  it('decodes voice config', () => {
    expect(model.voice.languageId).toBe(syntheticExpected.voice.languageId);
    expect(model.voice.speed).toBe(syntheticExpected.voice.speed);
    expect(model.voice.pitch).toBe(syntheticExpected.voice.pitch);
    expect(model.voice.engineModeId !== undefined).toBe(syntheticExpected.voice.hasEngineModeId);
  });

  it('decodes an RLE-compressed image identically to an uncompressed one', () => {
    // Image 0 is stored uncompressed, image 1 is the same pixels stored
    // RLE-compressed. Equal RGBA proves the RLE decode path end-to-end in CI.
    const a = model.images[0]!.rgba;
    const b = model.images[1]!.rgba;
    expect(b.length).toBe(a.length);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

// ---------------------------------------------------------------------------
// Group 2 — sheet packing + manifest round-trip (synthetic in CI, real gated).
// ---------------------------------------------------------------------------

/** First differing index, or -1 if the two byte arrays are equal. */
function firstDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/**
 * Run the full Cycle 2 round-trip on a parsed model: pack a sheet, prove every
 * image crops back byte-for-byte, every frame's image index is in range, and a
 * valid manifest builds. Asserts internally so callers just invoke it.
 */
function roundTrip(model: ParsedCharacter): void {
  const packed = packSheet(model.images);

  // Exact unique-image count: the atlas is parallel to images[], one cell each.
  expect(packed.atlas.length).toBe(model.images.length);

  // Every frame references a real image.
  for (const anim of model.animations) {
    for (const frame of anim.frames) {
      for (const fi of frame.images) {
        expect(fi.imageIndex).toBeGreaterThanOrEqual(0);
        expect(fi.imageIndex).toBeLessThan(model.images.length);
      }
    }
  }

  // Lossless round-trip: each non-empty cell crops back to the source pixels.
  for (let i = 0; i < model.images.length; i++) {
    const img = model.images[i]!;
    if (img.width <= 0 || img.height <= 0) continue;
    const cropped = cropCell(packed, packed.atlas[i]!);
    expect(cropped.length).toBe(img.rgba.length);
    // Byte-for-byte; report the first differing index (fast, no huge array clone).
    expect({ image: i, diffAt: firstDiff(cropped, img.rgba) }).toEqual({ image: i, diffAt: -1 });
  }

  // Manifest validates (zod inside buildManifest throws on any mismatch).
  const soundRefs = model.sounds.map((_, i) => ({ src: `audio/${i}.wav` }));
  const manifest = buildManifest(model, packed.atlas, 'sheet.png', soundRefs);
  expect(manifest.formatVersion).toBe(FORMAT_VERSION);
  expect(manifest.atlas.length).toBe(model.images.length);
}

describe('acs2bundle round-trip', () => {
  it('round-trips the synthetic model (CI)', () => {
    roundTrip(parseAcs(buildSyntheticAcs()));
  });

  it('decodes RLE literal-encoded byte arrays back to the originals (CI)', () => {
    const cases: Uint8Array[] = [
      Uint8Array.from([0]),
      Uint8Array.from([0xff]),
      Uint8Array.from([1, 2, 0, 0, 3, 0, 0, 0]),
      Uint8Array.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]),
      Uint8Array.from(Array.from({ length: 64 }, (_, i) => i * 3)),
    ];
    for (const x of cases) {
      const decoded = decodeImageData(rleEncodeLiterals(x), x.length);
      expect(decoded.length).toBe(x.length);
      expect(Array.from(decoded)).toEqual(Array.from(x));
    }
  });

  // Real fixtures: present locally, gitignored & absent in CI -> skipped there.
  const realFixtures = ['Genie', 'Merlin', 'Peedy', 'Robby'] as const;
  for (const charName of realFixtures) {
    const fileUrl = new URL(`../fixtures/raw/${charName}.acs`, import.meta.url);
    it.skipIf(!existsSync(fileUrl))(`round-trips the real ${charName}.acs`, () => {
      const bytes = readFileSync(fileUrl);
      const model = parseAcs(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      roundTrip(model);
    });
  }
});
