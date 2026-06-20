// Acceptance: StubTtsProvider.speak() returns { audio: empty, mouthTimeline: [] }
// (docs/cycles/cycle-0-contracts.md).

import { describe, it, expect } from 'vitest';
import { StubTtsProvider } from '../src/provider.js';
import type { VoiceConfig } from '@vivify/types';

describe('StubTtsProvider (Cycle 0 stub)', () => {
  it('resolves to empty audio and an empty mouth timeline', async () => {
    const provider = new StubTtsProvider();

    const result = await provider.speak('hello', {} as VoiceConfig);

    expect(result.audio).toBeInstanceOf(ArrayBuffer);
    expect(result.audio.byteLength).toBe(0);
    expect(result.mouthTimeline).toEqual([]);
  });
});
