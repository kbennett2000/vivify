// The .acs image codec: a bit-stream LZ77 over 8-bit palette indices.
//
// This is our own TypeScript implementation of the algorithm DoubleAgent calls
// `DecodeData` (the format/algorithm is derived from reading the GPL oracle; no
// code is copied). See the "RLE image codec" section of
// docs/cycles/cycle-1-findings.md for the bit-level spec.

/** Read a little-endian u32 from `arr` at byte `p`, zero-padding past the end. */
function u32At(arr: Uint8Array, p: number): number {
  const b0 = p >= 0 && p < arr.length ? arr[p]! : 0;
  const b1 = p + 1 >= 0 && p + 1 < arr.length ? arr[p + 1]! : 0;
  const b2 = p + 2 >= 0 && p + 2 < arr.length ? arr[p + 2]! : 0;
  const b3 = p + 3 >= 0 && p + 3 < arr.length ? arr[p + 3]! : 0;
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

/**
 * Decode a compressed .acs image stream into exactly `targetSize` index bytes.
 * Throws if the stream is malformed (bad header / trailer).
 */
export function decodeImageData(src: Uint8Array, targetSize: number): Uint8Array {
  const out = new Uint8Array(targetSize);

  // Preconditions: leading 0x00, and a run of >=6 trailing 0xFF bytes.
  if (src.length <= 7 || src[0] !== 0) {
    throw new Error('decodeImageData: missing 0x00 header byte');
  }
  let tail = 1;
  for (; src[src.length - tail] === 0xff; tail++) {
    if (tail > 6) break;
  }
  if (tail < 6) {
    throw new Error('decodeImageData: missing 0xFF trailer');
  }

  let srcPos = 5; // skip the 5-byte header
  let bit = 0; // bit offset within the current 32-bit window
  let outPos = 0;

  while (srcPos < src.length && outPos < targetSize) {
    let quad = u32At(src, srcPos - 4);

    if (quad & (1 << (bit & 0xffff))) {
      // ---- back-reference: decode the copy distance ----
      let srcOffset = 1;
      if (quad & (1 << ((bit + 1) & 0xffff))) {
        if (quad & (1 << ((bit + 2) & 0xffff))) {
          if (quad & (1 << ((bit + 3) & 0xffff))) {
            quad = (quad >>> ((bit + 4) & 0xffff)) & 0x000fffff;
            if (quad === 0x000fffff) break; // end-of-image marker
            quad += 4673;
            bit += 24;
            srcOffset = 2;
          } else {
            quad = (quad >>> ((bit + 4) & 0xffff)) & 0x00000fff;
            quad += 577;
            bit += 16;
          }
        } else {
          quad = (quad >>> ((bit + 3) & 0xffff)) & 0x000001ff;
          quad += 65;
          bit += 12;
        }
      } else {
        quad = (quad >>> ((bit + 2) & 0xffff)) & 0x0000003f;
        quad += 1;
        bit += 8;
      }
      const distance = quad;

      srcPos += bit >> 3;
      bit &= 7;

      // ---- decode the run length (gamma-style code) ----
      const runBits = u32At(src, srcPos - 4);
      let runCount = 0;
      while (runBits & (1 << ((bit + runCount) & 0xffff))) {
        runCount++;
        if (runCount > 11) break;
      }
      let runLen = runBits >>> ((bit + runCount + 1) & 0xffff);
      runLen &= (1 << runCount) - 1;
      runLen += 1 << runCount;
      runLen += srcOffset;
      bit += runCount * 2 + 1;

      if (outPos + runLen > targetSize) break;
      if (outPos - distance < 0) break;
      for (; runLen > 0; runLen--) {
        out[outPos] = out[outPos - distance]!;
        outPos++;
      }
    } else {
      // ---- literal byte (1 flag bit + 8 data bits) ----
      const byte = (quad >>> ((bit + 1) & 0xffff)) & 0xff;
      bit += 9;
      out[outPos++] = byte;
    }

    srcPos += bit >> 3;
    bit &= 7;
  }

  return out;
}
