// Cycle 5 acceptance (docs/cycles/cycle-5-voice.md → "What is verified where",
// CI bullet): "VoiceConfig→args". voiceToBridgeArgs is the pure mapping from a
// character's VoiceConfig to the SAPI4 bridge CLI args. These assert the exact
// arg arrays for the contract — full config, empty, partial, rounding, and the
// omission rules for absent / non-finite / empty fields.

import { describe, it, expect } from 'vitest';
import type { VoiceConfig } from '@vivify/types';
import { voiceToBridgeArgs } from '../src/voice-args.js';

describe('voiceToBridgeArgs', () => {
  it('maps engineModeId + speed + pitch to the full arg array, in order', () => {
    const voice: VoiceConfig = { engineModeId: 'GENIE-MODE-GUID', speed: 157, pitch: 100 };
    expect(voiceToBridgeArgs(voice)).toEqual([
      '--voice',
      'GENIE-MODE-GUID',
      '--speed',
      '157',
      '--pitch',
      '100',
    ]);
  });

  it('returns [] for an empty VoiceConfig (engine uses its defaults)', () => {
    expect(voiceToBridgeArgs({})).toEqual([]);
  });

  it('emits only the fields present (speed only)', () => {
    expect(voiceToBridgeArgs({ speed: 200 })).toEqual(['--speed', '200']);
  });

  it('emits only the fields present (pitch only)', () => {
    expect(voiceToBridgeArgs({ pitch: 80 })).toEqual(['--pitch', '80']);
  });

  it('emits only the fields present (engineModeId only)', () => {
    expect(voiceToBridgeArgs({ engineModeId: 'X' })).toEqual(['--voice', 'X']);
  });

  it('rounds speed and pitch to the nearest integer', () => {
    expect(voiceToBridgeArgs({ speed: 156.7, pitch: 99.4 })).toEqual([
      '--speed',
      '157',
      '--pitch',
      '99',
    ]);
  });

  it('rounds half-up (e.g. 100.5 → 101)', () => {
    expect(voiceToBridgeArgs({ speed: 100.5 })).toEqual(['--speed', '101']);
  });

  it('omits an empty-string engineModeId', () => {
    expect(voiceToBridgeArgs({ engineModeId: '', speed: 150 })).toEqual(['--speed', '150']);
  });

  it('omits non-finite speed / pitch (NaN, Infinity)', () => {
    expect(voiceToBridgeArgs({ speed: NaN, pitch: Infinity })).toEqual([]);
  });

  it('keeps a finite field while dropping a non-finite sibling', () => {
    expect(voiceToBridgeArgs({ speed: 120, pitch: NaN })).toEqual(['--speed', '120']);
  });

  it('ignores fields not part of the bridge CLI (gender/languageId/raw)', () => {
    const voice: VoiceConfig = {
      engineModeId: 'M',
      gender: 'male',
      languageId: 1033,
      raw: { extra: 1 },
    };
    expect(voiceToBridgeArgs(voice)).toEqual(['--voice', 'M']);
  });
});
