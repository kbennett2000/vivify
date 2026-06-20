// .acs parser (Cycle 1 spike scope): header -> palette -> image list ->
// animation table. TTS/balloon/icon/states/names/sounds and per-frame mouth
// overlays are parsed only enough to skip them (Cycle 2). All layout per
// docs/cycles/cycle-1-findings.md.

import type {
  AnimationModel,
  CharacterInfo,
  FrameBranch,
  FrameImage,
  FrameModel,
  ImageModel,
  Rgb,
} from '@vivify/types';
import { BinaryReader } from './binary-reader.js';
import { decodeImageData } from './rle.js';
import { indexedByteSize, indicesToImageModel } from './image.js';

/** What the Cycle 1 spike decodes: the fidelity-bearing image + animation data. */
export interface ParsedCharacter {
  info: CharacterInfo;
  palette: Rgb[];
  transparentIndex: number;
  images: ImageModel[];
  animations: AnimationModel[];
}

const ACS_SIGNATURE = 0xabcdabc3;
const STYLE_TTS = 0x00000020;
const STYLE_BALLOON = 0x00000200;

interface Locator {
  offset: number;
  size: number;
}

export function parseAcs(input: ArrayBuffer | Uint8Array): ParsedCharacter {
  const r = new BinaryReader(input);

  const sig = r.u32();
  if (sig !== ACS_SIGNATURE) {
    throw new Error(
      `parseAcs: bad signature 0x${sig.toString(16).toUpperCase()} (expected 0xABCDABC3)`,
    );
  }

  // Four section locators: header, animation index, image index, audio index.
  const locators: Locator[] = [];
  for (let i = 0; i < 4; i++) locators.push({ offset: r.u32(), size: r.u32() });
  const headerLoc = locators[0]!;
  const animIndexLoc = locators[1]!;
  const imageIndexLoc = locators[2]!;

  // ---- header / character info (we need palette + color-key) ----
  r.seek(headerLoc.offset);
  r.u16(); // versionMinor
  r.u16(); // versionMajor
  r.u32(); // namesOffset
  r.u32(); // namesSize
  const guid = r.guid();
  const width = r.u16();
  const height = r.u16();
  const transparentIndex = r.u8();
  const style = r.u32();
  r.u32(); // unknown (== 0x00000002)
  if (style & STYLE_TTS) skipTts(r);
  if (style & STYLE_BALLOON) skipBalloon(r);
  const palette = readPalette(r);

  const info: CharacterInfo = { guid, width, height };
  const images = readImages(r, imageIndexLoc, palette, transparentIndex);
  const animations = readAnimations(r, animIndexLoc);

  return { info, palette, transparentIndex, images, animations };
}

// --- header sub-blocks we only skip in Cycle 1 ---

function skipTts(r: BinaryReader): void {
  r.skip(16); // engine GUID
  r.skip(16); // mode GUID
  r.i32(); // speed
  r.i16(); // pitch
  const hasLang = r.u8();
  if (hasLang) {
    r.u16(); // language id
    r.string(); // (unknown string)
    r.u16(); // gender
    r.u16(); // age
    r.string(); // style
  }
}

function skipBalloon(r: BinaryReader): void {
  r.u8(); // lines
  r.u8(); // chars per line
  r.skip(12); // fg, bg, border (3 x COLORREF)
  r.string(); // font name
  r.i32(); // font height
  r.u16(); // weight
  r.u16(); // strikeout
  r.u16(); // italic
}

function readPalette(r: BinaryReader): Rgb[] {
  const count = r.u32();
  const palette: Rgb[] = [];
  for (let i = 0; i < count; i++) {
    const b = r.u8();
    const g = r.u8();
    const red = r.u8();
    r.u8(); // reserved
    palette.push([red, g, b]);
  }
  return palette;
}

// --- images ---

function readImages(
  r: BinaryReader,
  loc: Locator,
  palette: Rgb[],
  transparentIndex: number,
): ImageModel[] {
  r.seek(loc.offset);
  const count = r.u32();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = r.u32();
    r.u32(); // size
    r.u32(); // checksum
    offsets.push(offset);
  }
  return offsets.map((off) => readImage(r, off, palette, transparentIndex));
}

function readImage(
  r: BinaryReader,
  offset: number,
  palette: Rgb[],
  transparentIndex: number,
): ImageModel {
  r.seek(offset);
  r.u8(); // unknown1 (0 => empty image)
  const width = r.u16();
  const height = r.u16();
  const compressed = r.u8();
  const dataLen = r.u32();
  const data = r.take(dataLen);

  if (width <= 0 || height <= 0) {
    return {
      width: Math.max(0, width),
      height: Math.max(0, height),
      rgba: new Uint8ClampedArray(0),
    };
  }

  const decodedSize = indexedByteSize(width, height);
  let indices: Uint8Array;
  if (compressed) {
    indices = decodeImageData(data, decodedSize);
  } else if (data.length >= decodedSize) {
    indices = data.subarray(0, decodedSize);
  } else {
    indices = new Uint8Array(decodedSize);
    indices.set(data);
  }
  return indicesToImageModel(indices, width, height, palette, transparentIndex);
}

// --- animations ---

function readAnimations(r: BinaryReader, loc: Locator): AnimationModel[] {
  r.seek(loc.offset);
  const count = r.u32();
  const entries: { name: string; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    const name = r.string();
    const offset = r.u32();
    r.u32(); // size
    entries.push({ name, offset });
  }
  return entries.map((e) => readAnimation(r, e.offset, e.name));
}

function readAnimation(r: BinaryReader, offset: number, indexName: string): AnimationModel {
  r.seek(offset);
  const blockName = r.string();
  const returnType = r.u8();
  const returnName = r.string();
  const frameCount = r.u16();

  const frames: FrameModel[] = [];
  for (let f = 0; f < frameCount; f++) frames.push(readFrame(r));

  const animation: AnimationModel = {
    name: indexName || blockName,
    transitionType: returnType,
    frames,
  };
  // returnType 1 = exit-branching, 2 = none; otherwise returnName names a return animation.
  if (returnType !== 1 && returnType !== 2 && returnName) {
    animation.returnAnimation = returnName;
  }
  return animation;
}

function readFrame(r: BinaryReader): FrameModel {
  const imageCount = r.u16();
  const images: FrameImage[] = [];
  for (let i = 0; i < imageCount; i++) {
    const imageIndex = r.u32();
    const x = r.i16();
    const y = r.i16();
    images.push({ imageIndex, x, y });
  }

  const soundNdx = r.i16();
  const duration = r.u16();
  const exitFrame = r.i16();

  const branchCount = r.u8();
  const branches: FrameBranch[] = [];
  for (let b = 0; b < branchCount; b++) {
    const packed = r.u32();
    branches.push({ frameIndex: packed & 0xffff, probability: (packed >>> 16) & 0xffff });
  }

  const overlayCount = r.u8();
  for (let o = 0; o < overlayCount; o++) r.skip(14); // mouth overlays (Cycle 1: skip)

  const frame: FrameModel = {
    images,
    durationMs: duration * 10, // .acs stores 1/100 s
    branches,
  };
  if (exitFrame >= 0) frame.exitFrame = exitFrame;
  if (soundNdx >= 0) frame.soundIndex = soundNdx;
  return frame;
}
