import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// MASH demo — showcase + dogfood of the @vivify/core public API (vanilla TS; ADR-0013).
// Resolve the workspace packages to their TS source so `pnpm --filter mash dev` works
// with no prebuild and gives HMR on engine edits. This is a dev-resolution convenience;
// the app still uses only @vivify/core's public entry (it never imports internals).
const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@vivify/core': src('../../packages/core/src/index.ts'),
      '@vivify/acs': src('../../packages/acs/src/index.ts'),
      '@vivify/types': src('../../packages/types/src/index.ts'),
      '@vivify/voice-truvoice': src('../../packages/voice-truvoice/src/index.ts'),
    },
  },
});
