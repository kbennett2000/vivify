// As of Cycle 3 (docs/cycles/cycle-3-renderer.md), createAgent is the real loader
// + browser engine, replacing the Cycle 0 no-op stub. The DOM engine itself
// (VivifyAgent: canvas compositor + balloon) is validated via the local harness;
// its pure logic (playback/queue/wrap/states) is unit-tested in the sibling specs.
// Here we only assert the environment-independent loader behavior that runs
// before any DOM/render — namely that an invalid .acs source is rejected.

import { describe, it, expect } from 'vitest';
import { createAgent } from '../src/agent.js';

describe('createAgent (Cycle 3 loader)', () => {
  it('rejects a .acs source with a bad signature (loader runs before any DOM use)', async () => {
    const notAnAcs = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer;
    await expect(createAgent(notAnAcs)).rejects.toThrow(/signature/i);
  });
});
