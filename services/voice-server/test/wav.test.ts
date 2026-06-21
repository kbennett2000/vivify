// Cycle 11 acceptance (docs/cycles/cycle-11-latency-singlepass.md → "What is
// verified where", CI bullet): "`wrapPcmToWav` + `trimLeadingSilence` unit tests".
// These are pure-function tests — no Wine, no PulseAudio, no child process. They
// assert against REAL bytes constructed in the test (RIFF/WAVE structure, fmt math,
// chunk sizes, and the leading-silence-trim alignment mechanism), never against the
// function's own output echoed back.

import { describe, it, expect } from 'vitest';
import { wrapPcmToWav, trimLeadingSilence, wavDurationMs, DEFAULT_PCM_FORMAT } from '../src/wav.js';

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
  // NOTE (Cycle 11 fix): the DEFAULT leadInMs is now 40, which at 44100 Hz is
  // round(0.040 * 44100) = 1764 frames of lead-in kept before the onset. The
  // flush-to-onset behavior these first tests assert therefore requires an explicit
  // `leadInMs: 0`; otherwise the tiny (few-frame) leading silence here is well inside
  // the lead-in window and nothing would be trimmed. The lead-in guard itself gets its
  // own dedicated tests further down (with a rate that makes the ms→frame math exact).

  it('with leadInMs:0, removes leading silent frames so the first sample is the audible onset', () => {
    // 5 silent frames (value 0) then 8 loud frames (value 8000), 16-bit mono.
    const silentFrames = 5;
    const loudFrames = 8;
    const samples = [
      ...Array<number>(silentFrames).fill(0),
      ...Array<number>(loudFrames).fill(8000),
    ];
    const wav = wrapPcmToWav(pcm16(samples));

    const trimmed = trimLeadingSilence(wav, { leadInMs: 0 });

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

  it('with leadInMs:0, requires a run: a lone spike in silence is not the onset, the sustained tone is', () => {
    // silence(5), one loud spike(1), silence(5), sustained tone(6). With the default
    // minRun=4, the lone spike is rejected; onset is the sustained run.
    const samples = [
      ...Array<number>(5).fill(0),
      8000, // lone spike — must NOT be treated as onset
      ...Array<number>(5).fill(0),
      ...Array<number>(6).fill(8000), // sustained tone — the real onset
    ];
    const wav = wrapPcmToWav(pcm16(samples));

    const trimmed = trimLeadingSilence(wav, { leadInMs: 0 });

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

  it('returns audio that already starts audible unchanged (default opts)', () => {
    // A run of loud frames from the very first sample — nothing to trim regardless of
    // the lead-in, so the default opts return the input verbatim.
    const wav = wrapPcmToWav(pcm16([8000, 8000, 8000, 8000, 8000, 8000]));
    const trimmed = trimLeadingSilence(wav);

    expect(trimmed.length).toBe(wav.length);
    expect(trimmed.equals(wav)).toBe(true);
  });

  describe('leadInMs guard (keeps frames before the onset so a soft attack is not clipped)', () => {
    // Build a 16-bit mono WAV at rate 1000 so the ms→frames math is exact:
    // 1000 frames/sec ⇒ 1ms = 1 frame, so leadInMs=40 ⇒ 40 frames = 80 bytes.
    const RATE = 1000;
    const FMT = { rate: RATE, channels: 1, bits: 16 };

    /** silentFrames of 0 then toneFrames of 8000, wrapped at RATE. */
    function silenceThenTone(silentFrames: number, toneFrames: number): Buffer {
      const samples = [
        ...Array<number>(silentFrames).fill(0),
        ...Array<number>(toneFrames).fill(8000),
      ];
      return wrapPcmToWav(pcm16(samples), FMT);
    }

    it('keeps exactly leadInMs worth of frames before the onset', () => {
      // 200 silent frames then a sustained tone. onset frame index = 200.
      // leadInMs=40 @1000Hz ⇒ 40 frames lead-in ⇒ start frame = 200 − 40 = 160.
      // Surviving frames = totalFrames − 160 = (totalFrames − 200 + 40).
      const silentFrames = 200;
      const toneFrames = 500;
      const totalFrames = silentFrames + toneFrames;
      const wav = silenceThenTone(silentFrames, toneFrames);

      const trimmed = trimLeadingSilence(wav, { leadInMs: 40 });

      // Valid RIFF/WAVE with the sample rate preserved.
      expect(trimmed.toString('ascii', 0, 4)).toBe('RIFF');
      expect(trimmed.toString('ascii', 8, 12)).toBe('WAVE');
      expect(trimmed.readUInt32LE(24)).toBe(RATE); // fmt sampleRate preserved

      // 40 of the 200 silent frames are kept ⇒ data length = (totalFrames − 200 + 40) * 2.
      const expectedFrames = totalFrames - silentFrames + 40; // = totalFrames − 160
      const expectedData = expectedFrames * 2;
      expect(trimmed.readUInt32LE(40)).toBe(expectedData); // data chunk size
      expect(trimmed.readUInt32LE(4)).toBe(36 + expectedData); // RIFF size
      expect(trimmed.length).toBe(44 + expectedData);

      // The first kept sample is from the silence (start frame 160 < onset 200): value 0,
      // and the onset tone appears exactly 40 frames (80 bytes) in.
      expect(trimmed.readInt16LE(44)).toBe(0); // start of the kept lead-in
      expect(trimmed.readInt16LE(44 + 40 * 2)).toBe(8000); // onset, 40 frames later
    });

    it('leadInMs:0 reproduces flush-to-onset (no lead-in)', () => {
      const silentFrames = 200;
      const toneFrames = 500;
      const wav = silenceThenTone(silentFrames, toneFrames);

      const trimmed = trimLeadingSilence(wav, { leadInMs: 0 });

      // All leading silence removed: only the audible portion remains.
      const expectedData = toneFrames * 2;
      expect(trimmed.readUInt32LE(40)).toBe(expectedData);
      expect(trimmed.length).toBe(44 + expectedData);
      expect(trimmed.readInt16LE(44)).toBe(8000); // first sample is the onset
    });

    it('clamps the lead-in at the data start and returns the input unchanged when nothing is trimmed', () => {
      // onset at frame 10 with leadInMs=40 (⇒ 40 frames) would put the start at frame
      // −30, which clamps to 0. Since the start lands at the data start, nothing is
      // trimmed and the function returns the input buffer verbatim.
      const silentFrames = 10;
      const toneFrames = 500;
      const wav = silenceThenTone(silentFrames, toneFrames);

      const trimmed = trimLeadingSilence(wav, { leadInMs: 40 });

      expect(trimmed.length).toBe(wav.length);
      expect(trimmed.equals(wav)).toBe(true);
    });
  });
});

describe('wavDurationMs (Cycle 11 follow-up clip diagnostic)', () => {
  it('computes ms from data bytes ÷ byteRate for a known format (rate 1000, mono, 16-bit)', () => {
    // 1000 frames at rate 1000 mono/16-bit = 2000 data bytes; byteRate = 1000*1*2 = 2000.
    // 2000 / 2000 = 1.000s ⇒ 1000ms — a hand-computed value, not the function echoed back.
    const FMT = { rate: 1000, channels: 1, bits: 16 };
    const wav = wrapPcmToWav(Buffer.alloc(1000 * 2), FMT);
    expect(wavDurationMs(wav)).toBe(1000);
  });

  it('computes ms at 44100/mono/16-bit from an exact byte count', () => {
    // byteRate = 44100 * 1 * 2 = 88200 bytes/s. Pick 44100 data bytes ⇒ 44100/88200 = 0.5s.
    // round(0.5 * 1000) = 500ms.
    const wav = wrapPcmToWav(Buffer.alloc(44100), DEFAULT_PCM_FORMAT);
    expect(wavDurationMs(wav)).toBe(500);
  });

  it('rounds to the nearest ms for a non-integer duration', () => {
    // rate 1000 mono/16-bit ⇒ byteRate 2000. 7 frames = 14 data bytes ⇒ 14/2000 = 0.007s
    // = 7ms exactly; use 3 bytes-worth-of-frames instead: 5 frames = 10 bytes ⇒ 5ms. To
    // exercise rounding, rate 3000 mono/16-bit ⇒ byteRate 6000; 1000 data bytes ⇒
    // 1000/6000 = 0.16666…s ⇒ round(166.66) = 167ms.
    const FMT = { rate: 3000, channels: 1, bits: 16 };
    const wav = wrapPcmToWav(Buffer.alloc(1000), FMT);
    expect(wavDurationMs(wav)).toBe(167);
  });

  it('returns 0 for a header-only (empty-data) WAV', () => {
    const wav = wrapPcmToWav(Buffer.alloc(0)); // 44-byte header, no samples
    expect(wav.length).toBe(44);
    expect(wavDurationMs(wav)).toBe(0);
  });

  it('returns 0 for a non-WAV buffer', () => {
    expect(wavDurationMs(Buffer.from('not a wav at all, just bytes'))).toBe(0);
    expect(wavDurationMs(Buffer.alloc(0))).toBe(0);
  });
});
