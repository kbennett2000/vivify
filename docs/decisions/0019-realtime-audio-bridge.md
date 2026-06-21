# ADR-0019: Real-time audio bridge (CLSID_MMAudioDest, two-pass) + dummy Wine audio device
Status: Accepted · Date: 2026-06-21

## Context
ADR-0017 established — empirically, not by inference — that in file-audio mode (`CLSID_AudioDestFile`) the SAPI4 engine emits flat/sparse mouth data, and **deferred** the authentic fix (real-time audio) to its own cycle. Cycle 6 (now merged) fixed the consumer side: overlay sourcing from the current frame, plus the authentic `VoiceMouthOverlay(height, width)` mapping with `width` threaded through (ADR-0018). But on-screen the lip-sync tick still logged an identical `h`/`w`/`type` every tick with `timeMs` never advancing — the engine wasn't producing varied per-phoneme `Visual` events. Cycle 7 (`cycle-7-realtime-audio`) supplies that missing input: dense per-phoneme mouth data from the real engine.

## Decision
**1. Real-time audio via `CLSID_MMAudioDest`, run as two sequential passes.**
The bridge (`services/voice-server/bridge/sapi4-mouth.cpp`) now uses `CLSID_MMAudioDest` (real-time multimedia audio out) so the engine fires the full per-phoneme `Visual`/`TTSMOUTH` stream. Wiring follows the DoubleAgent oracle (read for API knowledge only, never copied): `CoCreateInstance(CLSID_MMAudioDest, NULL, CLSCTX_SERVER, IID_IUnknown, &audio)`, then `ITTSEnum::Select(modeGuid, &central, (LPUNKNOWN)audio)`.

`MMAudioDest` exposes **no** way to tee the rendered PCM — verified against the oracle, which never reads samples back. So the WAV cannot come from the real-time pass. The bridge therefore runs **two sequential synthesis passes**:
- **Pass A** — `CLSID_MMAudioDest`, for the dense mouth timeline (returned).
- **Pass B** — the existing `CLSID_AudioDestFile`, for the WAV (its sparse events discarded).

Same engine/voice/text gives a deterministic duration, so the Pass A timeline aligns to the Pass B WAV. A single-pass PCM-tee was **rejected as infeasible** per the oracle. Tradeoff accepted: two passes ≈ 2× synthesis cost, and the real-time pass runs at ~utterance-length wall-clock (within the 120s bridge timeout). The HTTP contract (`{ audioWavBase64, mouthTimeline }`) and the bridge CLI are **unchanged**. If Pass A's `MMAudioDest`/`Select` fails — the symptom of a missing audio device — the bridge logs the HRESULT and exits non-zero. It does **not** silently fall back to sparse data.

Per-viseme **timing** in real-time mode is the **wall-clock arrival** of each `Visual` callback relative to playback start (`GetTickCount()`, based at `AudioStart` with a first-viseme fallback) — **not** the callback's `qTimeStamp`, which does not advance per viseme in MMAudioDest mode (an initial attempt collapsed every event to one large constant). This matches the oracle, which ignores `Visual.qTimeStamp` and times visemes by the audio device's play position; querying `IAudio::PosnGet` per callback is the documented fallback if arrival times ever collapse (burst delivery). The bridge logs `events=N timeMs=[..] rawQ=[min..max] audioStart=yes|no`, surfaced by the server as a `[bridge] …` line on success.

**2. Dummy audio device under headless Wine: a PulseAudio null sink.**
`MMAudioDest` opens a `waveOut` device inside `Select()`, but the container has no sound card. We provide a PulseAudio null sink: the Dockerfile installs `pulseaudio` + `pulseaudio-utils`, points Wine's audio driver at pulse (`reg HKCU\Software\Wine\Drivers Audio=pulse`), ships a minimal pulse config (`services/voice-server/pulse-null.pa`: `module-native-protocol-unix` anon socket + `module-null-sink` as default), and an `entrypoint.sh` starts `pulseaudio --system` (root container) loading the null sink before the Node server. The per-request `xvfb-run -a wine` bridge inherits `PULSE_SERVER=unix:/tmp/pulse-socket`.

PulseAudio was chosen over a bare ALSA `null` PCM because ALSA-null is often not enumerated as a Wine `waveOut` device; ALSA-null is kept as a documented fallback. `snd-dummy` (kernel module) was **rejected** — it needs a privileged container.

## Consequences
- This is the authentic realization of the path ADR-0017 deferred. With Cycle 6 merged, the full lip-sync path is now authentic end-to-end: dense per-phoneme `Visual` events from the real engine, mapped through the ADR-0018 overlay sourcing, driving the character's mouth frames.
- The dummy audio device is the main **unverified** step — it can only be confirmed in a real Docker+Wine environment (no Wine in the dev sandbox), the same verify boundary as Cycle 5. The bridge's HRESULT log surfaces a missing/failed device loudly. Honest caveat: if PulseAudio system mode can't initialize in the container, the operator reports the HRESULT and we iterate (ALSA-null fallback, or a privileged container) rather than faking it.
- CI cannot cover the bridge (C++/Wine); the existing voice-server suite (server contract + CLI unchanged) still passes. Bridge density is **operator-verified**, not provable in CI.
- Relates to ADR-0017 (which deferred this fix), ADR-0015 (mouth-timeline capture from the SAPI4 sink), and ADR-0018 (overlay sourcing and the `VoiceMouthOverlay` mapping this data now drives).
