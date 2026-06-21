// .acs parser — full format (Cycle 2). Populates the complete CharacterModel IR
// (@vivify/types): header/palette/images/animations (Cycle 1) plus voice (TTS),
// balloon, state→animation map, character name, embedded sounds, and per-frame
// mouth overlays. Pure / browser-safe (no Node APIs). Layout per
// docs/cycles/cycle-2-converter.md (and cycle-1-findings.md).

import type {
  AnimationModel,
  BalloonConfig,
  CharacterInfo,
  CharacterModel,
  FrameBranch,
  FrameImage,
  FrameModel,
  FrameMouthOverlay,
  ImageModel,
  Rgb,
  SoundModel,
  VoiceConfig,
} from '@vivify/types';
import { BinaryReader } from './binary-reader.js';
import { decodeImageData } from './rle.js';
import { indexedByteSize, indicesToImageModel } from './image.js';

/** Alias for the full IR the parser now produces. */
export type ParsedCharacter = CharacterModel;

const ACS_SIGNATURE = 0xabcdabc3;
const STYLE_TTS = 0x00000020;
const STYLE_BALLOON = 0x00000200;
const GUID_NULL = '{00000000-0000-0000-0000-000000000000}';

interface Locator {
  offset: number;
  size: number;
}

export function parseAcs(input: ArrayBuffer | Uint8Array): CharacterModel {
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
  const soundIndexLoc = locators[3]!;

  // ---- header / character block ----
  r.seek(headerLoc.offset);
  r.u16(); // versionMinor
  r.u16(); // versionMajor
  const namesOffset = r.u32(); // absolute file offset of the names block
  r.u32(); // namesSize
  const guid = r.guid();
  const width = r.u16();
  const height = r.u16();
  const transparentIndex = r.u8();
  const style = r.u32();
  r.u32(); // unknown (== 0x00000002)

  const voice: VoiceConfig = style & STYLE_TTS ? readVoice(r) : {};
  const balloon: BalloonConfig = style & STYLE_BALLOON ? readBalloon(r) : defaultBalloon();
  const palette = readPalette(r);
  skipIcon(r);
  const states = readStates(r);
  const name = readCharacterName(r, namesOffset);

  const info: CharacterInfo = { guid, width, height };
  if (name) info.name = name;

  const images = readImages(r, imageIndexLoc, palette, transparentIndex);
  const animations = readAnimations(r, animIndexLoc);
  const sounds = readSounds(r, soundIndexLoc);

  return { info, palette, transparentIndex, images, animations, sounds, balloon, voice, states };
}

// --- header sub-blocks ---

/** A COLORREF stored as B,G,R,reserved (4 bytes) → Rgb. */
function readColorRef(r: BinaryReader): Rgb {
  const b = r.u8();
  const g = r.u8();
  const red = r.u8();
  r.u8(); // reserved
  return [red, g, b];
}

function readBalloon(r: BinaryReader): BalloonConfig {
  const numLines = r.u8();
  const charsPerLine = r.u8();
  const fg = readColorRef(r);
  const bg = readColorRef(r);
  const border = readColorRef(r);
  const fontName = r.string();
  const fontHeight = Math.abs(r.i32());
  r.u16(); // weight
  r.u16(); // strikeout
  r.u16(); // italic
  return { numLines, charsPerLine, fontName, fontHeight, fg, bg, border };
}

function defaultBalloon(): BalloonConfig {
  return {
    numLines: 0,
    charsPerLine: 0,
    fontName: '',
    fontHeight: 0,
    fg: [0, 0, 0],
    bg: [255, 255, 255],
    border: [0, 0, 0],
  };
}

function readPalette(r: BinaryReader): Rgb[] {
  const count = r.u32();
  const palette: Rgb[] = [];
  for (let i = 0; i < count; i++) palette.push(readColorRef(r));
  return palette;
}

function skipIcon(r: BinaryReader): void {
  const hasIcon = r.u8();
  if (hasIcon) {
    const maskSize = r.u32();
    r.skip(maskSize);
    const colorSize = r.u32();
    r.skip(colorSize);
  }
}

function readStates(r: BinaryReader): Record<string, string[]> {
  const states: Record<string, string[]> = {};
  const stateCount = r.u16();
  for (let i = 0; i < stateCount; i++) {
    const name = r.string();
    const gestureCount = r.u16();
    const gestures: string[] = [];
    for (let g = 0; g < gestureCount; g++) gestures.push(r.string());
    states[name] = gestures;
  }
  return states;
}

function readCharacterName(r: BinaryReader, namesOffset: number): string | undefined {
  if (!namesOffset) return undefined;
  r.seek(namesOffset);
  const nameCount = r.u16();
  let chosen: string | undefined;
  for (let i = 0; i < nameCount; i++) {
    r.u16(); // language id
    const name = r.string();
    r.string(); // desc1
    r.string(); // desc2
    if (name && chosen === undefined) chosen = name;
  }
  return chosen;
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
    // High 16 bits are a 0–100 percentage per the format; clamp to stay graceful
    // on malformed data and within the bundle schema's 0–100 bound.
    const probability = Math.min(100, (packed >>> 16) & 0xffff);
    branches.push({ frameIndex: packed & 0xffff, probability });
  }

  // Mouth overlays (lip-sync): structured per ADR-0010 (Cycle 6). Each 14-byte
  // record is a mouth-shape image (imageIndex) the engine composites at (x,y).
  const overlayCount = r.u8();
  const overlays: FrameMouthOverlay[] = [];
  for (let o = 0; o < overlayCount; o++) {
    const type = r.u8();
    const replaceFlag = r.u8() !== 0;
    const imageIndex = r.u16();
    r.u8(); // unknown
    const rgnFlag = r.u8();
    const x = r.i16();
    const y = r.i16();
    const scaleX = r.i16();
    const scaleY = r.i16();
    overlays.push({ type, replaceFlag, imageIndex, x, y, rgnFlag, scaleX, scaleY });
  }

  const frame: FrameModel = {
    images,
    durationMs: duration * 10, // .acs stores 1/100 s
    branches,
  };
  if (exitFrame >= 0) frame.exitFrame = exitFrame;
  if (soundNdx >= 0) frame.soundIndex = soundNdx;
  if (overlays.length > 0) frame.mouth = { overlays };
  return frame;
}

// --- sounds ---

function readSounds(r: BinaryReader, loc: Locator): SoundModel[] {
  if (!loc.size) return [];
  r.seek(loc.offset);
  const count = r.u32();
  const refs: { offset: number; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    const offset = r.u32();
    const size = r.u32();
    r.u32(); // checksum
    refs.push({ offset, size });
  }
  return refs.map((ref) => {
    r.seek(ref.offset);
    const bytes = r.take(ref.size).slice(); // copy out of the file buffer
    return { wav: bytes.buffer };
  });
}

// TTS / voice. Mode GUID -> engineModeId; gender preserved as raw.genderCode
// (the SAPI gender enum mapping is confirmed in the voice cycle); engine GUID and
// other unmodeled fields kept under raw.
function readVoice(r: BinaryReader): VoiceConfig {
  const engineGuid = r.guid();
  const modeGuid = r.guid();
  const speed = r.i32();
  const pitch = r.i16();

  const raw: Record<string, unknown> = { engineGuid };
  const voice: VoiceConfig = { speed, pitch, raw };
  if (modeGuid !== GUID_NULL) voice.engineModeId = modeGuid;

  const hasLang = r.u8();
  if (hasLang) {
    voice.languageId = r.u16();
    raw.langString = r.string();
    raw.genderCode = r.u16();
    raw.age = r.u16();
    raw.styleString = r.string();
  }
  return voice;
}
