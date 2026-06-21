# sapi4-mouth — the SAPI4 TTS + mouth-capture bridge

`sapi4-mouth.cpp` is vivify's own (MIT) Windows console program that the voice
service runs under Wine. It speaks text with a SAPI4 voice (L&H TruVoice) and
writes a **WAV** plus a **mouth/viseme timeline JSON** (captured from the SAPI4
`ITTSNotifySinkW::Visual` / `TTSMOUTH` callback). See `../../docs/cycles/cycle-5-voice.md`.

## Status — UNVERIFIED
This was written from the documented SAPI4 low-level TTS API but has **not** been
compiled or run in vivify's dev sandbox (no Wine/SAPI4 there). It is the GO/NO-GO
artifact and must be built + validated in the Docker/Wine image. Spots needing
confirmation against the actual SAPI4 SDK headers are marked `// CONFIRM:` —
notably the `IAudioDest`/`IAudio` method set, the `Select`/`Register`/`TextData`
signatures, `TTSMOUTH` field names, and the SAPI4 GUIDs/CLSIDs.

## Build requirements (supplied by you — never committed)
- **SAPI4 SDK headers + import libs** (Microsoft Speech SDK 4.0): provide
  `ITTSEnumW`, `ITTSCentralW`, `ITTSAttributesW`, `ITTSNotifySinkW`, `IAudio(Dest)`,
  `TTSMODEINFOW`, `TTSMOUTH`, and the CLSID/IID symbols. Point the compiler's
  include/lib path at the SDK.
- A Windows C++ toolchain that targets Wine — **winegcc/MinGW** (used in the
  Dockerfile) or MSVC. SAPI4/TruVoice are **32-bit**, so build **32-bit**.

## Compile (inside the Docker image; example)
```
winegcc -m32 -municode -O2 -o sapi4-mouth.exe sapi4-mouth.cpp \
  -I"$SAPI4_SDK/include" -L"$SAPI4_SDK/lib" -lole32 -loleaut32 -luuid -lwinmm
```
(Adjust `-I/-L` to your SAPI4 SDK; add any SAPI4 import lib it requires.)

## Run
```
wine sapi4-mouth.exe --text-file in.txt --wav out.wav --timeline out.json \
  [--voice <modeGuid>] [--speed N] [--pitch N]
```
The Node service (`../src/server.ts`) invokes this per request under
`xvfb-run -a wine` and reads `out.wav` + `out.json`.
