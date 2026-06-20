// Cycle 1 acceptance (docs/cycles/cycle-1-*.md):
//   #1 GO/NO-GO — decoded animation names match Microsoft's published list
//      EXACTLY (set + spelling, case- and underscore-sensitive). The golden
//      arrays are the independent oracle; we never assert against the decoder's
//      own output captured as a mock.
//   #2 Structural pixel-decode sanity — palette/color-key/dimensions are
//      well-formed, images decode to real content, and a multi-frame animation
//      composites coherently. NOT byte-exact (deferred to Cycle 2).
//
// The real .acs files are gitignored, so they are ABSENT in CI. Tests that
// parse them are skipped (with a printed reason) when the fixture is missing,
// so CI stays green; they run fully locally where the fixtures exist.

import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseAcs } from '../src/parse.js';
import type { ParsedCharacter } from '../src/parse.js';
import genieGolden from './golden/genie-animations.json' with { type: 'json' };
import merlinGolden from './golden/merlin-animations.json' with { type: 'json' };

interface Fixture {
  name: string;
  fileUrl: URL;
  golden: readonly string[];
  goldenCount: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'Genie',
    fileUrl: new URL('../fixtures/raw/Genie.acs', import.meta.url),
    golden: genieGolden,
    goldenCount: 76,
  },
  {
    name: 'Merlin',
    fileUrl: new URL('../fixtures/raw/Merlin.acs', import.meta.url),
    golden: merlinGolden,
    goldenCount: 73,
  },
];

function readFixture(url: URL): Uint8Array {
  // Copy into a tightly-fitting Uint8Array so the buffer has no slack/offset.
  const buf = readFileSync(url);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

for (const fixture of FIXTURES) {
  const present = existsSync(fixture.fileUrl);
  const skipReason =
    `SKIP ${fixture.name}: fixture absent at ${fixture.fileUrl.pathname} ` +
    `(gitignored .acs — runs locally, skipped in CI)`;

  describe(`${fixture.name}.acs (Cycle 1 acceptance)`, () => {
    if (!present) {
      console.warn(skipReason);
    }

    // Parse once per fixture; reuse across the structural assertions.
    let parsed: ParsedCharacter;
    if (present) {
      parsed = parseAcs(readFixture(fixture.fileUrl));
    }

    // --- Acceptance #1: GO/NO-GO — exact name match vs Microsoft's list ---
    it.skipIf(!present)(
      "decodes animation names matching Microsoft's published list, exactly",
      () => {
        const decoded = parsed.animations.map((a) => a.name).sort();
        const expected = [...fixture.golden].sort();

        // Sanity: golden is the count the spec recorded for this character.
        expect(expected).toHaveLength(fixture.goldenCount);

        // The GO/NO-GO: exact set + spelling, case- and underscore-sensitive.
        expect(decoded).toEqual(expected);
      },
    );

    // --- Acceptance #2: structural pixel-decode sanity (NOT byte-exact) ---
    it.skipIf(!present)('decodes a 256-entry palette and the color-key index', () => {
      expect(parsed.palette).toHaveLength(256);
      expect(parsed.transparentIndex).toBe(10);
    });

    it.skipIf(!present)('reports the canonical 128x128 character dimensions', () => {
      expect(parsed.info.width).toBe(128);
      expect(parsed.info.height).toBe(128);
    });

    it.skipIf(!present)('decodes a plausible number of images', () => {
      // Plausible, not exact — exact counts are deferred to Cycle 2.
      expect(parsed.images.length).toBeGreaterThan(100);
    });

    it.skipIf(!present)('decodes at least one image with real opaque content', () => {
      const hasContent = parsed.images.some(
        (img) => img.width > 0 && img.height > 0 && imageHasOpaquePixel(img),
      );
      expect(hasContent).toBe(true);
    });

    it.skipIf(!present)('composites the multi-frame Greet animation coherently', () => {
      const greet = parsed.animations.find((a) => a.name.toLowerCase() === 'greet');
      expect(greet, 'Greet animation should exist').toBeDefined();
      expect(greet!.frames.length).toBeGreaterThanOrEqual(2);

      // Every referenced image index across Greet's frames must be in range.
      const referenced = greet!.frames.flatMap((f) => f.images.map((i) => i.imageIndex));
      expect(referenced.length).toBeGreaterThan(0);
      for (const idx of referenced) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(parsed.images.length);
      }

      // At least one image Greet references actually carries opaque content.
      const anyOpaque = referenced.some((idx) => {
        const img = parsed.images[idx]!;
        return img.width > 0 && img.height > 0 && imageHasOpaquePixel(img);
      });
      expect(anyOpaque).toBe(true);
    });
  });
}

/** True if any pixel in the RGBA buffer has a non-zero alpha channel. */
function imageHasOpaquePixel(img: { rgba: Uint8ClampedArray }): boolean {
  const { rgba } = img;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! > 0) return true;
  }
  return false;
}
