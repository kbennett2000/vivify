// Synthetic .acs builder — hand-constructs a tiny but COMPLETE .acs-format byte
// buffer (our own bytes; zero Microsoft IP; safe to commit). It is the inverse of
// the parser and exercises every block, so CI can run the full parser without the
// gitignored real character files. Built in-memory (no committed *.acs file).
//
// Layout per docs/cycles/cycle-2-converter.md. Little-endian throughout.

const SIG = 0xabcdabc3;
const STYLE_TTS = 0x20;
const STYLE_BALLOON = 0x200;

/** Little-endian byte writer (inverse of BinaryReader), with backpatch support. */
class AcsWriter {
  private buf: number[] = [];
  get pos(): number {
    return this.buf.length;
  }
  u8(v: number): void {
    this.buf.push(v & 0xff);
  }
  u16(v: number): void {
    this.u8(v);
    this.u8(v >> 8);
  }
  u32(v: number): void {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  i16(v: number): void {
    this.u16(v & 0xffff);
  }
  i32(v: number): void {
    this.u32(v >>> 0);
  }
  raw(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.u8(bytes[i]!);
  }
  guidZero(): void {
    for (let i = 0; i < 16; i++) this.u8(0);
  }
  /** A non-null GUID (bytes 1..16) so engineModeId is populated. */
  guidNonNull(): void {
    for (let i = 0; i < 16; i++) this.u8(i + 1);
  }
  /** Length-prefixed UTF-16LE string + NUL terminator (when non-empty). */
  str(s: string): void {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    if (s.length > 0) this.u16(0);
  }
  patchU32(at: number, v: number): void {
    this.buf[at] = v & 0xff;
    this.buf[at + 1] = (v >> 8) & 0xff;
    this.buf[at + 2] = (v >> 16) & 0xff;
    this.buf[at + 3] = (v >>> 24) & 0xff;
  }
  build(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

/**
 * Literal-only encoder for the .acs bit-stream LZ codec — produces a compressed
 * stream that `decodeImageData` reads back to exactly `bytes` (every byte a
 * literal: flag bit 0 + 8 data bits, LSB-first; byte[0]=0 sentinel; 0xFF trailer).
 * Test-only (the shipped converter never encodes). Exercises the RLE decode in CI.
 */
export function rleEncodeLiterals(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0]; // sentinel; the bit-stream begins at byte index 1
  let cur = 0;
  let nbits = 0;
  const pushBit = (b: number): void => {
    cur |= (b & 1) << nbits;
    nbits++;
    if (nbits === 8) {
      out.push(cur);
      cur = 0;
      nbits = 0;
    }
  };
  for (const byte of bytes) {
    pushBit(0); // literal flag
    for (let i = 0; i < 8; i++) pushBit((byte >> i) & 1);
  }
  if (nbits > 0) out.push(cur);
  for (let i = 0; i < 8; i++) out.push(0xff); // >=6 0xFF trailer
  return Uint8Array.from(out);
}

// Two 2x2 images share these indexed pixels (stride = (2+3)&~3 = 4, height 2 = 8 bytes,
// bottom-up). Index 0 = transparent. Image 0 is stored uncompressed, image 1 compressed —
// so a test can assert both decode to identical RGBA.
const IMG_W = 2;
const IMG_H = 2;
// Indexed pixels: stride = (2+3)&~3 = 4, height 2 = 8 bytes (bottom-up).
const IMG_INDICES = Uint8Array.from([1, 2, 0, 0, 3, 0, 0, 0]);

// A tiny (non-functional but well-formed) RIFF/WAVE byte blob for the one sound.
const WAV = Uint8Array.from([
  0x52,
  0x49,
  0x46,
  0x46,
  0x04,
  0x00,
  0x00,
  0x00,
  0x57,
  0x41,
  0x56,
  0x45, // "RIFF"....."WAVE"
]);

function writeImageBlock(w: AcsWriter, compressed: boolean): { offset: number; size: number } {
  const offset = w.pos;
  w.u8(1); // unknown1 (>0)
  w.u16(IMG_W);
  w.u16(IMG_H);
  w.u8(compressed ? 1 : 0);
  const data = compressed ? rleEncodeLiterals(IMG_INDICES) : IMG_INDICES;
  w.u32(data.length);
  w.raw(data);
  return { offset, size: w.pos - offset };
}

interface FrameSpec {
  images: { idx: number; x: number; y: number }[];
  sound: number;
  duration: number;
  exitFrame: number;
  branches: { frameNdx: number; prob: number }[];
  overlays: { type: number; replace: number; imageNdx: number; x: number; y: number }[];
}

function writeFrame(w: AcsWriter, f: FrameSpec): void {
  w.u16(f.images.length);
  for (const im of f.images) {
    w.u32(im.idx);
    w.i16(im.x);
    w.i16(im.y);
  }
  w.i16(f.sound);
  w.u16(f.duration);
  w.i16(f.exitFrame);
  w.u8(f.branches.length);
  for (const b of f.branches) w.u32((b.frameNdx & 0xffff) | ((b.prob & 0xffff) << 16));
  w.u8(f.overlays.length);
  for (const o of f.overlays) {
    w.u8(o.type);
    w.u8(o.replace);
    w.u16(o.imageNdx);
    w.u8(0); // unknown
    w.u8(0); // rgnFlag
    w.i16(o.x);
    w.i16(o.y);
    w.i16(0); // s.x
    w.i16(0); // s.y
  }
}

function writeAnimationBlock(
  w: AcsWriter,
  name: string,
  returnType: number,
  returnName: string,
  frames: FrameSpec[],
): { offset: number; size: number } {
  const offset = w.pos;
  w.str(name);
  w.u8(returnType);
  w.str(returnName);
  w.u16(frames.length);
  for (const f of frames) writeFrame(w, f);
  return { offset, size: w.pos - offset };
}

/** What `parseAcs(buildSyntheticAcs())` is expected to yield (for test assertions). */
export const syntheticExpected = {
  width: 32,
  height: 32,
  transparentIndex: 0,
  paletteLength: 4,
  name: 'Test',
  imageCount: 2,
  imageWidth: IMG_W,
  imageHeight: IMG_H,
  animationNames: ['Show', 'Greet'],
  greetReturnAnimation: 'Show',
  states: { Showing: ['Show'], Speaking: ['Show', 'Greet'] },
  soundCount: 1,
  balloon: { numLines: 3, charsPerLine: 20, fontName: 'Tahoma', fontHeight: 12 },
  voice: { languageId: 0x409, speed: 150, pitch: 100, hasEngineModeId: true },
  greetFrame0Branch: { frameIndex: 1, probability: 100 },
} as const;

export function buildSyntheticAcs(): Uint8Array {
  const w = new AcsWriter();

  w.u32(SIG);
  // Reserve four locators {offset,size}; patch after the sections are laid out.
  const locAt: number[] = [];
  for (let i = 0; i < 4; i++) {
    locAt.push(w.pos);
    w.u32(0);
    w.u32(0);
  }

  // --- images + image index ---
  const img0 = writeImageBlock(w, false);
  const img1 = writeImageBlock(w, true);
  const imageIndexStart = w.pos;
  w.u32(2);
  for (const im of [img0, img1]) {
    w.u32(im.offset);
    w.u32(im.size);
    w.u32(0); // checksum
  }
  const imageIndexSize = w.pos - imageIndexStart;

  // --- animations + animation index ---
  const show = writeAnimationBlock(w, 'Show', 2 /* none */, '', [
    {
      images: [{ idx: 0, x: 0, y: 0 }],
      sound: -1,
      duration: 10,
      exitFrame: -1,
      branches: [],
      overlays: [],
    },
  ]);
  const greet = writeAnimationBlock(w, 'Greet', 0 /* named return */, 'Show', [
    {
      images: [{ idx: 1, x: 0, y: 0 }],
      sound: 0,
      duration: 20,
      exitFrame: -1,
      branches: [{ frameNdx: 1, prob: 100 }],
      overlays: [{ type: 1, replace: 1, imageNdx: 0, x: 1, y: 2 }],
    },
    {
      images: [{ idx: 0, x: 0, y: 0 }],
      sound: -1,
      duration: 20,
      exitFrame: 0,
      branches: [],
      overlays: [],
    },
  ]);
  const animIndexStart = w.pos;
  w.u32(2);
  for (const [name, a] of [
    ['Show', show],
    ['Greet', greet],
  ] as const) {
    w.str(name);
    w.u32(a.offset);
    w.u32(a.size);
  }
  const animIndexSize = w.pos - animIndexStart;

  // --- sounds + sound index ---
  const soundOffset = w.pos;
  w.raw(WAV);
  const soundSize = w.pos - soundOffset;
  const soundIndexStart = w.pos;
  w.u32(1);
  w.u32(soundOffset);
  w.u32(soundSize);
  w.u32(0); // checksum
  const soundIndexSize = w.pos - soundIndexStart;

  // --- header / character block ---
  const headerStart = w.pos;
  w.u16(0); // versionMinor
  w.u16(2); // versionMajor
  const namesOffsetAt = w.pos;
  w.u32(0); // namesOffset (patched below, absolute)
  const namesSizeAt = w.pos;
  w.u32(0); // namesSize (patched)
  w.guidZero();
  w.u16(32); // width
  w.u16(32); // height
  w.u8(0); // transparency index
  w.u32(STYLE_TTS | STYLE_BALLOON);
  w.u32(2); // unknown
  // TTS block
  w.guidZero(); // engine GUID
  w.guidNonNull(); // mode GUID -> engineModeId
  w.i32(150); // speed
  w.i16(100); // pitch
  w.u8(1); // hasLang
  w.u16(0x409); // language id
  w.str('x'); // unknown string
  w.u16(1); // gender code
  w.u16(0); // age
  w.str('style'); // style string
  // Balloon block
  w.u8(3); // numLines
  w.u8(20); // charsPerLine
  w.raw([0, 0, 0, 0]); // fg  (B,G,R,_)
  w.raw([255, 255, 255, 0]); // bg
  w.raw([0, 0, 0, 0]); // border
  w.str('Tahoma'); // font name
  w.i32(12); // font height
  w.u16(400); // weight
  w.u16(0); // strikeout
  w.u16(0); // italic
  // Palette (4 entries: B,G,R,_)
  w.u32(4);
  w.raw([0, 0, 0, 0]); // index 0 -> black (transparent)
  w.raw([0, 0, 255, 0]); // index 1 -> red
  w.raw([0, 255, 0, 0]); // index 2 -> green
  w.raw([255, 0, 0, 0]); // index 3 -> blue
  // Icon (none)
  w.u8(0);
  // States
  w.u16(2);
  w.str('Showing');
  w.u16(1);
  w.str('Show');
  w.str('Speaking');
  w.u16(2);
  w.str('Show');
  w.str('Greet');
  // Names (record absolute offset)
  const namesOffset = w.pos;
  w.u16(1);
  w.u16(0x409);
  w.str('Test');
  w.str('desc1');
  w.str('desc2');
  const namesSize = w.pos - namesOffset;
  const headerSize = w.pos - headerStart;

  w.patchU32(namesOffsetAt, namesOffset);
  w.patchU32(namesSizeAt, namesSize);

  // --- patch the four locators: header, anim index, image index, sound index ---
  const sections = [
    { off: headerStart, size: headerSize },
    { off: animIndexStart, size: animIndexSize },
    { off: imageIndexStart, size: imageIndexSize },
    { off: soundIndexStart, size: soundIndexSize },
  ];
  sections.forEach((s, i) => {
    w.patchU32(locAt[i]!, s.off);
    w.patchU32(locAt[i]! + 4, s.size);
  });

  return w.build();
}
