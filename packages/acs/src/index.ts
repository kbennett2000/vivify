// @vivify/acs — the .acs parser + acs2bundle CLI. Same module runs in Node
// (convert ahead-of-time) and in the browser (drop a raw .acs and it runs).
//
// Cycle 0: the on-disk bundle schema + zod validator + emitted JSON Schema.
// Cycle 1: the .acs image + animation-table decoder (parseAcs). The acs2bundle
// CLI and full-format coverage follow in Cycle 2.

export const name = '@vivify/acs';

export {
  FORMAT_VERSION,
  BundleManifestSchema,
  validateBundleManifest,
  safeValidate,
  bundleManifestJsonSchema,
} from './bundle.js';
export type { BundleManifest } from './bundle.js';

export { parseAcs } from './parse.js';
export type { ParsedCharacter } from './parse.js';
export { BinaryReader } from './binary-reader.js';
export { decodeImageData } from './rle.js';
export { indicesToImageModel, rowStride, indexedByteSize } from './image.js';
