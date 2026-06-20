// Acceptance: bundle validator accepts the sample manifest and rejects a
// deliberately broken one; the emitted JSON Schema is an object schema
// (docs/cycles/cycle-0-contracts.md).

import { describe, it, expect } from 'vitest';
import {
  FORMAT_VERSION,
  validateBundleManifest,
  safeValidate,
  bundleManifestJsonSchema,
} from '../src/bundle.js';
import sample from './sample-manifest.json' with { type: 'json' };

describe('validateBundleManifest', () => {
  it('accepts the committed sample manifest and reports its formatVersion', () => {
    const manifest = validateBundleManifest(sample);
    expect(manifest.formatVersion).toBe(FORMAT_VERSION);
  });

  it('rejects a manifest missing the required formatVersion', () => {
    const broken = structuredClone(sample) as Record<string, unknown>;
    delete broken.formatVersion;

    expect(() => validateBundleManifest(broken)).toThrow();
    expect(safeValidate(broken).success).toBe(false);
  });

  it('rejects a manifest whose transparentIndex is the wrong type', () => {
    const broken = structuredClone(sample) as Record<string, unknown>;
    broken.transparentIndex = 'not-a-number';

    expect(() => validateBundleManifest(broken)).toThrow();
    expect(safeValidate(broken).success).toBe(false);
  });
});

describe('bundleManifestJsonSchema', () => {
  it('emits a JSON Schema object describing an object with properties', () => {
    const schema = bundleManifestJsonSchema();

    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
    expect((schema as { type?: unknown }).type).toBe('object');
    expect((schema as { properties?: unknown }).properties).toBeTypeOf('object');
  });
});
