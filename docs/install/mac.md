# Install vivify on macOS

Welcome! 👋 This guide takes you from a fresh Mac to a cartoon character moving and talking in your web
browser. No experience needed — we'll explain every step, and you can stop after the easy part.

There are **two tiers**, and you can do just the first:

- **Tier 1 — See it run.** A character on screen, talking with your browser's built-in voice. Quick and
  easy.
- **Tier 2 — The authentic voice.** The original 1990s character voice. A little more setup, totally
  optional.

> New to all of this? The 60-second overview is **[What is this?](../what-is-this.md)**. Stuck on a word?
> The **[Glossary](../glossary.md)** explains every term in plain English.

> 📸 _Screenshots for every step are coming in a later update — for now the steps are written out in full._

---

## Tier 1 — See it run

This uses your **browser's built-in voice**. It's the easy on-ramp — not a lesser version — and it needs no
special files.

### Step 1 — Install Docker Desktop

**Docker** is a free app that runs vivify for you, so you don't have to install a pile of separate pieces by
hand. On Mac it's called **Docker Desktop**.

1. Go to the official guide: **[Install Docker Desktop on
   Mac](https://docs.docker.com/desktop/setup/install/mac-install/)**.
2. Download the right build for your Mac:
   - **Apple Silicon** (M1/M2/M3/M4 — most Macs since 2020) → the **Apple chip** download.
   - **Intel** (older Macs) → the **Intel chip** download.
   - Not sure? Click the **Apple menu** (top-left corner) → **About This Mac**: "Chip" = Apple Silicon,
     "Processor" = Intel.
3. Open the downloaded `.dmg` and drag **Docker** into **Applications**. Launch it and leave it running.
   You'll see a little **whale icon** 🐳 in the menu bar when it's ready.

_Saw a scary-looking technical message during install? Totally normal — just follow Docker's prompts._

**Check it's working:** open a terminal (next step) and run `docker --version`. If it prints a version
number, you're good.

### Step 2 — Get the vivify project

You need a copy of the project on your Mac. Two ways — pick whichever sounds easier:

- **Easy (no tools):** on the project's GitHub page, click the green **`< > Code`** button → **Download
  ZIP**. Double-click the downloaded file to unzip it. You'll get a folder named `vivify` (or similar).
- **If you have Git:** `git clone <the repo URL>`.

Now **open a terminal** in that folder:

1. Press **⌘ + Space** (Spotlight), type **Terminal**, and press Return.
2. Move into the project folder with `cd`. For example, if it's in your Downloads:
   ```bash
   cd ~/Downloads/vivify
   ```
   _(Tip: type `cd ` then drag the folder onto the Terminal window to paste its path.)_

### Step 3 — Start it

In that terminal, run:

```bash
docker compose up mash
```

The **first** time, Docker builds everything — this can take a few minutes. (After that it's cached and
starts fast.) When you see it settle and keep running, it's ready. Leave this window open.

### Step 4 — Open it and say hello

1. Open your web browser to **http://localhost:8090**.
2. You'll need a character file (a `.acs` file). vivify ships none — see **[where to get
   one](../legal-and-assets.md)** (and the **[Characters](../characters.md)** page, _coming soon_). Drag
   the `.acs` file onto the page.
3. Click any animation in the list to play it. Type a sentence and click **Speak**.

**That's it — it's alive!** 🎉 The character moves, shows its speech balloon, and talks using your
browser's voice.

> To stop it: go back to the Terminal and press **Control + C**.

---

## Tier 2 — The authentic TruVoice voice _(optional)_

Want to hear the character's **real** 1990s voice instead of your browser's? That's this tier.

### Why you need to supply a few files

The original voice comes from closed 1990s Microsoft / Lernout & Hauspie speech software. It's not ours to
give away, so vivify can't include it — **you supply your own copies**, once. (This is also why vivify
stays free and clean to share.)

### Step 1 — Drop in three files

vivify looks for these in the folder **`services/voice-server/vendor/`** inside the project:

| File | What it is |
| --- | --- |
| `spchapi.exe` | The Microsoft SAPI 4 speech runtime |
| `tv_enua.exe` | The L&H TruVoice voice (Genie & friends) |
| `sdk/include/speech.h` | The SAPI 4 SDK header (goes in `vendor/sdk/include/`) |

**Where to find them:** see **[Legal & assets](../legal-and-assets.md)** — it lists the sources. _(We don't
link the files here, on purpose.)_

So the finished layout is:

```
services/voice-server/vendor/
  spchapi.exe
  tv_enua.exe
  sdk/include/speech.h
```

### Step 2 — One command

In your Terminal, in the project folder:

```bash
docker compose up
```

(That's the same command as before, **without** `mash` — it now starts both the demo _and_ the voice.) The
first build is slower because it sets up the voice engine; after that it's cached.

Then open **http://localhost:8090** as before. The voice connection is pre-filled for you
(`http://localhost:8080`), so just upload your `.acs`, type, and click **Speak** — and you'll hear the
authentic voice, with the mouth moving in time. 🪄

**Good to know:**

- **Docker is the only tool you need** — no programming tools to install.
- The **first time** you speak a brand-new sentence, it takes a few seconds to generate. The **same**
  sentence again is instant (vivify remembers it).
- A brand-new sentence may clip its very first instant slightly — minor, and it won't happen on a repeat.
- If the build stops with a message about **`speech.h` missing**, it means that file isn't in
  `services/voice-server/vendor/sdk/include/` yet — the message tells you the exact spot.

---

## Trouble?

- **[Troubleshooting](../troubleshooting.md)** — common hiccups and fixes _(coming soon)_.
- **[FAQ](../faq.md)** — "Is this legal?", "Why no sound?", "Which characters work?" _(coming soon)_.
- **[Glossary](../glossary.md)** — every term, in plain English.

---

**Other platforms:** [Windows](windows.md) · [Linux](linux.md)

← Back to the **[documentation home](../README.md)** · [main README](../../README.md)
