# sapi4-mouth — the SAPI4 TTS + mouth-capture bridge

`sapi4-mouth.cpp` is vivify's own (MIT) Windows console program that the voice
service runs under Wine. It speaks text with a SAPI4 voice (L&H TruVoice) and
writes a **WAV** plus a **mouth/viseme timeline JSON** (captured from the SAPI4
`ITTSNotifySink::Visual` / `TTSMOUTH` callback). See `../../docs/cycles/cycle-5-voice.md`.

It is written against the **real** SAPI4 SDK header `<speech.h>`. The WAV is written
by SAPI4 itself via `CLSID_AudioDestFile` → `IAudioFile::Set(path)`; the voice is
selected via `CLSID_TTSEnumerator` → `ITTSEnum::Select`; mouth/viseme timing comes
from a registered `ITTSNotifySink`. Built **ANSI** (the interface macros resolve to
the `…A` forms). The API shapes were verified against `speech.h` itself and the SAPI4
usage in TETYYS/SAPI4 and DoubleAgent.

## You must supply: speech.h (Microsoft Speech SDK 4.0) — never committed
Drop the header at **`services/voice-server/vendor/sdk/include/speech.h`** (under the
gitignored `vendor/`; the Dockerfile sets `SAPI4_SDK=/opt/vendor/sdk` and `-I`s it). It
is MS IP, so it is **not** committed — same model as the engine installers.

Where to get it: the Microsoft Speech SDK 4.0 (the same source as the runtime; see
`../../docs/legal-and-assets.md`). A copy is also vendored in public projects such as
miranda-ng (`plugins/WinterSpeak/src/SAPI 4.0/Include/speech.h`). `<speech.h>` is
self-contained (it only needs the standard Windows headers); if your copy pulls in a
sibling SDK header, place that alongside it too.

## Build (inside the Docker image)
```
i686-w64-mingw32-g++ -O2 -static -static-libgcc -static-libstdc++ \
  -o sapi4-mouth.exe sapi4-mouth.cpp -I"$SAPI4_SDK/include" \
  -lole32 -loleaut32 -luuid -lwinmm
```
Static-linking is required: a dynamically-linked mingw C++ exe imports
`libstdc++-6.dll`/`libgcc_s_*.dll`/`libwinpthread-1.dll`, which aren't in the Wine
prefix → Wine fails to load it with `c0000135`. GUIDs come from `<initguid.h>`, so no
SAPI4 import lib is needed.

## Run
```
wine sapi4-mouth.exe --text-file in.txt --wav out.wav --timeline out.json \
  [--voice <modeGuid>] [--speed N] [--pitch N]
```
The Node service (`../src/server.ts`) invokes this per request under
`xvfb-run -a wine` and reads `out.wav` + `out.json`. `--voice` is a SAPI4 mode GUID
(`{…}`); if omitted/unparseable, the first enumerated voice is used.
