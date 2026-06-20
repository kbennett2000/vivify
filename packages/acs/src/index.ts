// @vivify/acs — the .acs parser + acs2bundle CLI. Same module runs in Node
// (convert ahead-of-time) and in the browser (drop a raw .acs and it runs).
//
// Cycle 0: the on-disk bundle schema + zod validator + emitted JSON Schema are
// defined here. The parser and CLI follow in Cycles 1–2.

export const name = '@vivify/acs';

export {
  FORMAT_VERSION,
  BundleManifestSchema,
  validateBundleManifest,
  safeValidate,
  bundleManifestJsonSchema,
} from './bundle.js';
export type { BundleManifest } from './bundle.js';
