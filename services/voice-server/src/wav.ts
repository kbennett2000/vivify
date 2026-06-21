// Cycle 11 — single-pass audio. The bridge no longer writes a WAV; instead the server
// records raw PCM from the PulseAudio null-sink monitor (`parec`) during the one real-time
// synthesis pass. These pure helpers turn that raw PCM into a valid RIFF/WAVE the browser
// can decode, and align it to the mouth timeline (timeline t≈0 = first audible sample) by
// trimming leading silence. Pure + unit-tested — no Wine/PulseAudio needed.

export interface PcmFormat {
  /** Samples per second (the rate `parec` captured at; we pin the null sink to match). */
  rate: number;
  /** Channel count. */
  channels: number;
  /** Bits per sample (PCM). */
  bits: number;
}

export const DEFAULT_PCM_FORMAT: PcmFormat = { rate: 44100, channels: 1, bits: 16 };

/** Wrap raw little-endian PCM in a canonical 44-byte RIFF/WAVE (PCM) container. */
export function wrapPcmToWav(pcm: Buffer, format: PcmFormat = DEFAULT_PCM_FORMAT): Buffer {
  const { rate, channels, bits } = format;
  const blockAlign = (channels * bits) >> 3;
  const byteRate = rate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4); // file size − 8
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface WavView {
  channels: number;
  bits: number;
  /** Byte offset of the audio data within the buffer. */
  dataStart: number;
  /** Byte length of the audio data. */
  dataLength: number;
}

/**
 * Locate the `fmt `/`data` chunks of a RIFF/WAVE buffer (chunk-walking, not assuming a fixed
 * 44-byte header). Returns null if it isn't a parseable PCM WAV.
 */
function parseWav(wav: Buffer): WavView | null {
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null;
  let channels = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= wav.length) {
      channels = wav.readUInt16LE(body + 2);
      bits = wav.readUInt16LE(body + 14);
    } else if (id === 'data') {
      const dataLength = Math.min(size, wav.length - body);
      if (channels === 0 || bits === 0) return null;
      return { channels, bits, dataStart: body, dataLength };
    }
    offset = body + size + (size & 1); // chunks are word-aligned
  }
  return null;
}

export interface TrimOptions {
  /**
   * Absolute 16-bit amplitude below which a sample counts as silence (default 150). The null-sink
   * monitor is DIGITAL silence (zeros) when idle, so a low threshold catches a soft opening
   * consonant without false-triggering on silence. (Was 512 ≈ −36 dBFS, which detected the onset
   * late on soft openings and let the lead-in shave the first consonant — Cycle 11 clip fix.)
   */
  threshold?: number;
  /** Consecutive non-silent frames required to mark the audio onset (default 3) — rejects a lone spike. */
  minRun?: number;
  /**
   * Keep this many ms of audio BEFORE the detected onset (default 80) so a soft leading consonant
   * isn't shaved. A small lead-in is imperceptible for sync and aligns WAV t≈0 with the timeline's
   * first viseme far more safely than trimming flush to the first loud sample.
   */
  leadInMs?: number;
}

/**
 * Trim leading silence from a 16-bit PCM WAV so the first audible sample sits at the start —
 * aligning the audio's t=0 with the mouth timeline's t≈0 (the first viseme). Returns a new
 * valid WAV with the header lengths rewritten. If the format isn't 16-bit PCM or nothing is
 * audible, the input is returned (or a zero-data WAV for all-silence) rather than corrupting it.
 * Only LEADING silence is trimmed; trailing audio is preserved.
 */
export function trimLeadingSilence(wav: Buffer, opts: TrimOptions = {}): Buffer {
  // Clamp to ≥ 0 so a stray negative operator env value (VIVIFY_TRIM_*) can't INVERT the lead-in
  // and shave into real speech — the exact over-trim this guard exists to prevent.
  const threshold = Math.max(0, opts.threshold ?? 150);
  const minRun = Math.max(1, opts.minRun ?? 3);
  const leadInMs = Math.max(0, opts.leadInMs ?? 80);
  const view = parseWav(wav);
  if (!view || view.bits !== 16) return wav; // only 16-bit PCM is trimmable here

  const frame = (view.channels * view.bits) >> 3; // bytes per frame (all channels)
  const dataEnd = view.dataStart + view.dataLength;

  // Find the first frame with a run of `minRun` consecutive audible frames.
  let onset = -1;
  let run = 0;
  for (let pos = view.dataStart; pos + frame <= dataEnd; pos += frame) {
    let audible = false;
    for (let c = 0; c < view.channels; c++) {
      if (Math.abs(wav.readInt16LE(pos + c * 2)) > threshold) {
        audible = true;
        break;
      }
    }
    if (audible) {
      if (run === 0) onset = pos; // candidate start of this audible run
      if (++run >= minRun) break;
    } else {
      run = 0;
      onset = -1;
    }
  }

  const rate = rateOf(wav);
  const fmt: PcmFormat = { rate, channels: view.channels, bits: view.bits };
  if (onset < 0) return wrapPcmToWav(Buffer.alloc(0), fmt); // all silence

  // Keep a small lead-in before the onset so a soft attack isn't clipped (leadInMs is a
  // whole number of frames, preserving alignment). Clamp to the start of the data.
  const leadInBytes = Math.round((leadInMs / 1000) * rate) * frame;
  const start = Math.max(view.dataStart, onset - leadInBytes);
  if (start === view.dataStart) return wav; // nothing to trim once the lead-in is kept
  return wrapPcmToWav(wav.subarray(start, dataEnd), fmt);
}

/**
 * Audio duration of a PCM WAV in milliseconds (data bytes ÷ byte-rate). Used to diagnose clipping:
 * compare against the mouth timeline's span — a WAV much shorter than the timeline means audio is
 * missing from the capture. Returns 0 for an unparseable/empty WAV.
 */
export function wavDurationMs(wav: Buffer): number {
  const view = parseWav(wav);
  if (!view) return 0;
  const blockAlign = (view.channels * view.bits) >> 3;
  const byteRate = rateOf(wav) * blockAlign;
  return byteRate > 0 ? Math.round((view.dataLength / byteRate) * 1000) : 0;
}

/** Read the sample rate from a WAV's fmt chunk (falls back to the default rate). */
function rateOf(wav: Buffer): number {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 8 + 16 <= wav.length) return wav.readUInt32LE(offset + 8 + 4);
    offset += 8 + size + (size & 1);
  }
  return DEFAULT_PCM_FORMAT.rate;
}
