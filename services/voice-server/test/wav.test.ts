// Cycle 11 acceptance (docs/cycles/cycle-11-latency-singlepass.md → "What is
// verified where", CI bullet): "`wrapPcmToWav` + `trimLeadingSilence` unit tests".
// These are pure-function tests — no Wine, no PulseAudio, no child process. They
// assert against REAL bytes constructed in the test (RIFF/WAVE structure, fmt math,
// chunk sizes, and the leading-silence-trim alignment mechanism), never against the
// function's own output echoed back.

import { describe, it, expect } from 'vitest';
import { wrapPcmToWav, trimLeadingSilence, DEFAULT_PCM_FORMAT } from '../src/wav.js';

/** Build a little-endian s16 PCM buffer from sample values. */
function pcm16(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

describe('wrapPcmToWav', () => {
  it('prepends a 44-byte canonical RIFF/WAVE header for the default mono/44100/16 format', () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); // 8 known data bytes
    const wav = wrapPcmToWav(pcm); // default format

    expect(wav.length).toBe(44 + 8);

    // Container tags.
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.toString('ascii', 36, 40)).toBe('data');

    // RIFF chunk size = 36 + dataLen.
    expect(wav.readUInt32LE(4)).toBe(36 + 8);

    // fmt chunk: size 16, PCM=1, then the default format's fields.
    expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1); // audioFormat = PCM
    expect(wav.readUInt16LE(22)).toBe(DEFAULT_PCM_FORMAT.channels); // 1
    expect(wav.readUInt32LE(24)).toBe(DEFAULT_PCM_FORMAT.rate); // 44100
    // byteRate = rate * channels * bits/8 = 44100 * 1 * 2 = 88200.
    expect(wav.readUInt32LE(28)).toBe(44100 * 1 * (16 / 8));
    // blockAlign = channels * bits/8 = 1 * 2 = 2.
    expect(wav.readUInt16LE(32)).toBe(1 * (16 / 8));
    expect(wav.readUInt16LE(34)).toBe(DEFAULT_PCM_FORMAT.bits); // 16

    // data chunk size = pcm length, and the bytes follow verbatim.
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it('computes byteRate/blockAlign for a custom stereo/22050/16 format', () => {
    const pcm = Buffer.alloc(16); // 16 data bytes
    const format = { rate: 22050, channels: 2, bits: 16 };
    const wav = wrapPcmToWav(pcm, format);

    expect(wav.readUInt16LE(22)).toBe(2); // channels
    expect(wav.readUInt32LE(24)).toBe(22050); // sampleRate
    // byteRate = 22050 * 2 * (16/8) = 88200.
    expect(wav.readUInt32LE(28)).toBe(22050 * 2 * (16 / 8));
    // blockAlign = 2 * (16/8) = 4.
    expect(wav.readUInt16LE(32)).toBe(2 * (16 / 8));
    expect(wav.readUInt16LE(34)).toBe(16);
    // Sizes track the data length, independent of format.
    expect(wav.readUInt32LE(4)).toBe(36 + 16);
    expect(wav.readUInt32LE(40)).toBe(16);
  });
});

describe('trimLeadingSilence', () => {
  it('removes leading silent frames so the first sample is the audible onset', () => {
    // 5 silent frames (value 0) then 8 loud frames (value 8000), 16-bit mono.
    const silentFrames = 5;
    const loudFrames = 8;
    const samples = [
      ...Array<number>(silentFrames).fill(0),
      ...Array<number>(loudFrames).fill(8000),
    ];
    const wav = wrapPcmToWav(pcm16(samples));

    const trimmed = trimLeadingSilence(wav);

    // Still a valid RIFF/WAVE.
    expect(trimmed.toString('ascii', 0, 4)).toBe('RIFF');
    expect(trimmed.toString('ascii', 8, 12)).toBe('WAVE');

    // Only the audible portion remains: 8 frames * 2 bytes = 16 data bytes.
    const expectedData = loudFrames * 2;
    expect(trimmed.readUInt32LE(40)).toBe(expectedData); // data chunk size rewritten
    expect(trimmed.readUInt32LE(4)).toBe(36 + expectedData); // RIFF size rewritten
    expect(trimmed.length).toBe(44 + expectedData);

    // The first sample after the header is now the loud onset, not silence.
    expect(trimmed.readInt16LE(44)).toBe(8000);
  });

  it('requires a run: a lone spike in silence is not the onset, the sustained tone is', () => {
    // silence(5), one loud spike(1), silence(5), sustained tone(6). With the default
    // minRun=4, the lone spike is rejected; onset is the sustained run.
    const samples = [
      ...Array<number>(5).fill(0),
      8000, // lone spike — must NOT be treated as onset
      ...Array<number>(5).fill(0),
      ...Array<number>(6).fill(8000), // sustained tone — the real onset
    ];
    const wav = wrapPcmToWav(pcm16(samples));

    const trimmed = trimLeadingSilence(wav);

    // Trimmed to the sustained tone only: 6 frames * 2 bytes.
    expect(trimmed.readUInt32LE(40)).toBe(6 * 2);
    expect(trimmed.length).toBe(44 + 6 * 2);
    // First sample is the start of the sustained run.
    expect(trimmed.readInt16LE(44)).toBe(8000);
    // The spike (at original frame 5) is gone — there is no surviving isolated sample.
    expect(trimmed.subarray(44).length).toBe(6 * 2);
  });

  it('returns a header-only WAV (length 44, data 0) for all-silence input', () => {
    const wav = wrapPcmToWav(pcm16([0, 0, 0, 0, 0, 0, 0, 0]));
    const trimmed = trimLeadingSilence(wav);

    expect(trimmed.length).toBe(44);
    expect(trimmed.readUInt32LE(40)).toBe(0); // data chunk size
    expect(trimmed.readUInt32LE(4)).toBe(36); // RIFF size = 36 + 0
    expect(trimmed.toString('ascii', 0, 4)).toBe('RIFF');
    expect(trimmed.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('returns audio that already starts audible unchanged', () => {
    // A run of loud frames from the very first sample — nothing to trim.
    const wav = wrapPcmToWav(pcm16([8000, 8000, 8000, 8000, 8000, 8000]));
    const trimmed = trimLeadingSilence(wav);

    expect(trimmed.length).toBe(wav.length);
    expect(trimmed.equals(wav)).toBe(true);
  });
});
