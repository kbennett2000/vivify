# Setting up the authentic voice

This page explains **how the authentic voice fits together** — the handful of pieces and how they talk to
each other — so the actual setup makes sense. When you're ready for the click-by-click steps on _your_
computer, this page hands you off to your platform's guide; it doesn't repeat them here.

New to the whole idea? Start with **[The authentic voice — overview](overview.md)** first.

## How the pieces fit together

There are just two moving parts, and they both run on your own machine via **Docker**:

- **The playground (MASH)** — the web app you load in your browser at **`http://localhost:8090`**.
- **The voice helper** — a small background service at **`http://localhost:8080`** that runs the original
  speech software and knows how to speak in the real voice.

When you click **Speak**, the magic is quietly ordinary: **your browser** sends the line of text to the
voice helper, and the helper sends back the audio plus the exact mouth movements for lip-sync. The
character plays it. (The call goes browser → helper, not container-to-container — which is why both just
publish their address on your machine.)

You don't configure any of this by hand. The playground's **"Voice server URL"** field is **pre-filled**
with `http://localhost:8080`, so sound just works the moment the helper is running. Clear that field and
the character goes **silent** — a handy escape hatch, never a dead end.

## What the helper needs: three files you supply

The voice helper runs genuine closed 1990s speech software, and **vivify ships none of it**. You drop
**three** files into one folder — `services/voice-server/vendor/` — once:

| File | What it is | Goes at |
| --- | --- | --- |
| `spchapi.exe` | the SAPI 4 speech runtime | `services/voice-server/vendor/spchapi.exe` |
| `tv_enua.exe` | the L&H TruVoice voice (Genie & friends) | `services/voice-server/vendor/tv_enua.exe` |
| `speech.h` | the SAPI 4 SDK header the helper compiles against | `services/voice-server/vendor/sdk/include/speech.h` |

Where these come from is its own page: **[Where to get the voice components](sourcing-components.md)**.
(If the build ever stops complaining that `speech.h` is missing, it's that third file in the
`sdk/include/` sub-folder — the build message names the exact spot.)

## One command runs it all

Once the three files are in place, the whole thing — playground **and** voice — comes up with a single
command from the project folder:

```bash
docker compose up
```

**Docker is the only tool you need on your computer.** The voice helper compiles itself _inside_ its own
Docker image, so there's no programming toolchain to install (that's [ADR-0027](../decisions/0027-voice-one-command-build.md)).
The first build is slower because it sets up the speech engine; after that it's cached and quick. To run
**just** the silent playground without any of the voice files, use `docker compose up mash` instead.

## Two things that are normal (so they don't surprise you)

- **Repeats are instant.** The helper remembers every line it has spoken (a disk cache, kept between
  restarts), so saying the same sentence again comes back immediately — no waiting.
- **A brand-new line may clip its very first instant.** The first time the helper speaks a sentence it has
  never said, the opening moment can be ever-so-slightly clipped. It's minor, it won't happen when you
  repeat that line, and the helper warms itself up at startup to keep it small. Totally normal.

## Now do it on your computer

The step-by-step — install Docker, get the project, drop the files, run it — lives in your platform's
install guide, under its **"Tier 2 — the authentic voice"** section:

- 🪟 **[Install on Windows](../install/windows.md)**
- 🍎 **[Install on macOS](../install/mac.md)**
- 🐧 **[Install on Linux](../install/linux.md)**

## Where to next

- **What is this voice, really?** → **[The authentic voice — overview](overview.md)**.
- **Where do the three files come from?** → **[Where to get the voice components](sourcing-components.md)**.
- **The legal/IP details** → **[Legal & assets](../legal-and-assets.md)**.

---

← Back to the **[documentation home](../README.md)**
