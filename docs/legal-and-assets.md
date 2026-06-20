# Legal & assets — what you must supply

The engine is MIT. It ships **no** Microsoft or Lernout & Hauspie IP and **no** character files. To get the authentic experience you supply three categories of original components yourself. None of these are committed to the repo (see `.gitignore`).

## 1. Character files (`.acs`) — you bring your own
- **Your source `https://tmafe.com/packs` and `https://tmafe.com/classic-ms-agents/` is the right one.** TMAFE (The Microsoft Agent Fan ... community) is the de-facto archive and is fine to use. No need to look elsewhere.
- Grab the **original four** as canonical test fixtures: **Genie, Merlin, Peedy, Robby**. Genie is the Cycle 1 primary fixture.
- For format-coverage variety later, also pull a couple of oddballs (an Office assistant like Clippy/Rover, and any community character with lots of animations).
- These are Microsoft's copyrighted works. Use them at your discretion; we don't redistribute them. Store them locally under a gitignored `fixtures/raw/` path.

## 2. Speech runtime — for the authentic voice (Cycle 5+)
The authentic Genie voice is the **L&H TruVoice** synthesizer driven by the **Microsoft Speech API 4 (SAPI4)** runtime. Both are closed Win32 binaries — they cannot run natively in a browser, which is *why* the voice lives in a Wine-based service. You need two installers inside the Wine prefix:
- **`spchapi.exe`** — Microsoft Speech API 4.0 runtime.
- **`tv_enua.exe`** — L&H TruVoice American English TTS engine (this is the one that holds Genie's "Adult Male" voice and friends).

### Where to get them
- **TETYYS/SAPI4** (`github.com/TETYYS/SAPI4`) — a working reference that installs exactly these two into Wine and exposes TTS over HTTP. Start here; it documents the install commands and which files you need. We extend its approach to also capture the mouth/viseme timeline.
- **LouisGameDev/Microsoft-Sam-Mary-Mike-TruVoice-WSAPI4** — an archive of the Windows Speech API 4 SDK and the TruVoice voices, confirmed working under Wine.
- **Wayback Machine** for `tv_enua.exe` directly: `http://web.archive.org/web/20000816050308/http://activex.microsoft.com:80/activex/controls/agent2/tv_enua.exe`.

We do **not** need the Microsoft Agent runtime (`msagent.exe`) at all — we reimplement the character engine. Only the *speech* pieces are required, and only for the authentic-voice path.

## 3. Oracles for building/validating the parser (Cycle 1+)
Not shipped, not redistributed — local dev tools to validate our parser against ground truth:
- **DoubleAgent** (Cinnamon Software, GPL) — a full Agent-server reimplementation in C++ that *reads* `.acs`. **Read it to learn the exact byte layouts; do not copy its code** (GPL — we stay MIT). It is the format reference.
- **Lebeau MSAgent Decompiler** (`lebeausoftware.org`, closed, Windows/Wine) — extracts the original bitmaps/sounds and an ACD project from an `.acs`. This is our **validation oracle**: diff our decoded frames against its extracted bitmaps.

## Posture summary
- MIT engine + tooling: ours, shipped.
- `.acs` files, SAPI4/TruVoice binaries, Wine prefix, extracted Microsoft bitmaps/sounds: **never committed**, user-supplied, gitignored.
- This keeps the repo permissively licensable and clean for developers to adopt.
