// The on-disk bundle (the serialized superset IR + packed-asset references).
//
// A bundle is: manifest.json (this schema) + sheet.png (packed atlas of all
// unique images) + audio/*.wav (extracted sounds). The manifest is everything
// in @vivify/types' CharacterModel MINUS pixel data, plus a sprite-atlas
// coordinate table and audio file references. See docs/cycles/cycle-0-contracts.md.
//
// This zod schema is the source of truth for the manifest; the JSON Schema is
// generated from it. Compile-time guards below keep the shared sub-shapes
// (animations, frames, balloon, voice) in lock-step with the @vivify/types IR.

import { z } from 'zod';
import type {
  AnimationModel,
  BalloonConfig,
  FrameBranch,
  FrameImage,
  FrameModel,
  MouthOverlay,
  VoiceConfig,
} from '@vivify/types';

/** Bumped whenever the on-disk manifest shape changes incompatibly. */
export const FORMAT_VERSION = 1 as const;

const Int = z.number().int();
const Channel = Int.min(0).max(255);
/** RGB triple, each channel 0–255. */
const RgbSchema = z.tuple([Channel, Channel, Channel]);

const MouthOverlaySchema = z.object({
  raw: z.record(z.string(), z.unknown()).optional(),
});

const FrameImageSchema = z.object({
  imageIndex: Int.min(0),
  x: Int,
  y: Int,
});

const FrameBranchSchema = z.object({
  frameIndex: Int.min(0),
  probability: z.number().min(0).max(100),
});

const FrameSchema = z.object({
  images: z.array(FrameImageSchema),
  durationMs: z.number().min(0),
  branches: z.array(FrameBranchSchema),
  exitFrame: Int.min(0).optional(),
  soundIndex: Int.min(0).optional(),
  mouth: MouthOverlaySchema.optional(),
});

const AnimationSchema = z.object({
  name: z.string(),
  transitionType: Int,
  returnAnimation: z.string().optional(),
  frames: z.array(FrameSchema),
});

const BalloonSchema = z.object({
  numLines: Int.min(0),
  charsPerLine: Int.min(0),
  fontName: z.string(),
  fontHeight: z.number().min(0),
  fg: RgbSchema,
  bg: RgbSchema,
  border: RgbSchema,
});

const VoiceSchema = z.object({
  engineModeId: z.string().optional(),
  languageId: Int.optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  speed: z.number().optional(),
  pitch: z.number().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

/** A single image's placement in the packed sprite sheet, indexed by imageIndex. */
const AtlasEntrySchema = z.object({
  x: Int.min(0),
  y: Int.min(0),
  w: Int.min(0),
  h: Int.min(0),
});

/** A reference to an extracted sound file within the bundle's audio/ directory. */
const SoundRefSchema = z.object({
  src: z.string(),
});

// Unknown keys are STRIPPED, not rejected (zod's default). This is intentional:
// a manifest written by a newer toolchain may carry fields an older validator
// doesn't model, and `formatVersion` is the gate for incompatible changes. A
// "broken" manifest is therefore one with a missing/mistyped *known* field, not
// one with extra keys.
//
// NOTE (Cycle 1+): cross-field invariants are NOT enforced here yet —
// transparentIndex < palette.length, atlas.length === image count, and every
// soundIndex/imageIndex in range are parser-emit guarantees and belong in a
// `.superRefine` once the parser exists.
export const BundleManifestSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  info: z.object({
    guid: z.string(),
    name: z.string().optional(),
    width: Int.min(0),
    height: Int.min(0),
  }),
  palette: z.array(RgbSchema).max(256),
  transparentIndex: Int.min(0),
  /** Filename of the packed atlas image within the bundle (e.g. "sheet.png"). */
  sheet: z.string(),
  /** Atlas coordinates, parallel to the original images[] ordering. */
  atlas: z.array(AtlasEntrySchema),
  animations: z.array(AnimationSchema),
  sounds: z.array(SoundRefSchema),
  balloon: BalloonSchema,
  voice: VoiceSchema,
  states: z.record(z.string(), z.array(z.string())),
});

export type BundleManifest = z.infer<typeof BundleManifestSchema>;

/** Parse and validate a manifest. Throws a ZodError if `data` is not a valid manifest. */
export function validateBundleManifest(data: unknown): BundleManifest {
  return BundleManifestSchema.parse(data);
}

/** Non-throwing validation; returns zod's SafeParse result. */
export function safeValidate(data: unknown) {
  return BundleManifestSchema.safeParse(data);
}

/** Emit the manifest's JSON Schema (generated from the zod schema). */
export function bundleManifestJsonSchema() {
  return z.toJSONSchema(BundleManifestSchema);
}

// --- Compile-time guards: keep the manifest's shared sub-shapes in lock-step ---
// with the core IR. If any field is added/removed/retyped on one side without
// the other, one of these assertions fails to typecheck.
//
// Two checks are needed and neither subsumes the other:
//  - MutuallyAssignable catches a *retyped* field (incl. retyped optionals,
//    since `T | undefined` is not assignable across differing T).
//  - SameKeys catches an *added or dropped* field — including OPTIONAL ones,
//    which MutuallyAssignable misses (absence of `k?: T` is assignable both ways).
// Guards are applied at every nested IR sub-shape the schema mirrors, so a
// dropped optional deep inside a frame (e.g. `exitFrame`) is still caught.
type Assert<T extends true> = T;
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : false) : false;
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;
type InSync<S, T> =
  MutuallyAssignable<S, T> extends true ? (SameKeys<S, T> extends true ? true : false) : false;

type _AnimationInSync = Assert<InSync<z.infer<typeof AnimationSchema>, AnimationModel>>;
type _FrameInSync = Assert<InSync<z.infer<typeof FrameSchema>, FrameModel>>;
type _FrameImageInSync = Assert<InSync<z.infer<typeof FrameImageSchema>, FrameImage>>;
type _FrameBranchInSync = Assert<InSync<z.infer<typeof FrameBranchSchema>, FrameBranch>>;
type _MouthInSync = Assert<InSync<z.infer<typeof MouthOverlaySchema>, MouthOverlay>>;
type _BalloonInSync = Assert<InSync<z.infer<typeof BalloonSchema>, BalloonConfig>>;
type _VoiceInSync = Assert<InSync<z.infer<typeof VoiceSchema>, VoiceConfig>>;
