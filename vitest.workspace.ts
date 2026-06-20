import { defineWorkspace } from 'vitest/config';

// Each package/app runs its own vitest via `pnpm -r test`. This workspace file
// lets a root `vitest` invocation discover tests across all workspace projects.
export default defineWorkspace(['packages/*', 'services/*', 'apps/*']);
