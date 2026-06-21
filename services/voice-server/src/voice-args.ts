// Map a character's VoiceConfig (from the .acs TTS block) to CLI args for the
// SAPI4 bridge. Pure — unit-tested. The bridge interprets these (selects the
// TruVoice mode, sets rate/pitch); unknown/absent fields are simply omitted so
// the engine uses its defaults.

import type { VoiceConfig } from '@vivify/types';

export function voiceToBridgeArgs(voice: VoiceConfig): string[] {
  const args: string[] = [];
  if (voice.engineModeId && voice.engineModeId.length > 0) {
    args.push('--voice', voice.engineModeId);
  }
  if (typeof voice.speed === 'number' && Number.isFinite(voice.speed)) {
    args.push('--speed', String(Math.round(voice.speed)));
  }
  if (typeof voice.pitch === 'number' && Number.isFinite(voice.pitch)) {
    args.push('--pitch', String(Math.round(voice.pitch)));
  }
  return args;
}
