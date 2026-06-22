# Troubleshooting

Something not working? Don't worry — almost every snag here is common, harmless, and quick to fix. Find
your symptom below.

> **A friendly heads-up about "scary" messages.** Build tools print a _lot_ of text, some of it in alarming
> red. That's normal — it doesn't mean you broke anything. The few messages that actually need your
> attention are listed below, in plain English.

## No sound when I click Speak

The character moves and shows its balloon, but you hear nothing. Work down this list:

- **You're on the browser voice and your system is muted / volume down.** The default voice is your
  browser's own — check your volume.
- **You wanted the _authentic_ voice but only started the demo.** The authentic voice needs its helper
  running. Make sure you ran **`docker compose up`** (both parts), not `docker compose up mash` (the demo
  only). → **[Setting up the authentic voice](voice/setup.md)**.
- **The "Voice server URL" field is empty.** In the playground, that field should read
  `http://localhost:8080`. If it's blank, the character speaks **silently** on purpose — type that address
  back in. If MASH says _"Couldn't reach the voice server… — clear the field to speak silently,"_ the
  helper isn't running or isn't reachable (see the line above).
- **You haven't supplied the voice files yet.** The authentic voice needs three files you provide once. →
  **[Where to get the voice components](voice/sourcing-components.md)**.

Just want sound _now_? Clear the URL field is the opposite of what you want — instead, leave the browser
voice on (no helper needed) and you'll always hear _something_.

## A character won't load

- **"Please choose a `.acs` character file."** You picked a file that isn't a `.acs`. Microsoft Agent
  characters are `.acs` files — grab one as described on the **[Characters](characters.md)** page.
- **"Couldn't load _name_: …"** The file is a `.acs` but vivify couldn't read it — it may be corrupted or
  an unusual variant. Try a different character (Genie is a reliable first test), and see
  **[Characters](characters.md)** for known-good sources.
- **Nothing happens at all.** Make sure the page actually loaded at **http://localhost:8090** and the
  command from your install guide is still running in its terminal window.

## Docker won't start, or the page won't open

- **"Docker isn't running."** Start Docker Desktop (Windows/macOS) and wait for its whale icon to settle,
  then run the command again. On Linux, make sure the Docker service is up.
- **`http://localhost:8090` won't open.** The command needs to be **running** (leave that terminal open).
  If it exited, scroll up for a message and re-run it.
- **"Port is already allocated" / "address already in use."** Something else is using **8090** (the
  playground) or **8080** (the voice helper). Close whatever's using it, or map a different host port —
  e.g. `docker compose up` after changing `"8090:8090"` to `"9000:8090"` in `docker-compose.yml`, then open
  `http://localhost:9000`. The full per-OS steps are in your **[install guide](README.md)**.

## A "FATAL" message stopped the build (authentic voice)

This only happens on the **authentic-voice** setup, and it's the build telling you a supplied file isn't
in place yet. It's helpful, not broken — it names the exact fix:

- **`FATAL: speech.h missing — drop the … header at services/voice-server/vendor/sdk/include/speech.h`** —
  put that one file at exactly that path and build again.
- **`FATAL: SAPI4 Speech.dll not installed`** or **`TruVoice tv_enua.dll not installed`** — the speech
  runtime files (`spchapi.exe` / `tv_enua.exe`) aren't in `services/voice-server/vendor/` yet.

All three files and where to get them are on **[Where to get the voice components](voice/sourcing-components.md)**
and **[Legal & assets](legal-and-assets.md)**.

## The first build is taking forever

The first `docker compose up` builds everything — for the authentic voice it sets up the speech engine,
which takes a few minutes. **This is one-time.** After that it's cached and starts quickly. Grab a coffee;
it's working.

> 💾 **Remember when…** installing anything meant a progress bar and a sandwich? Same energy. It'll finish.

## Linux: "permission denied" running Docker

On Linux you may need to run Docker with `sudo` (e.g. `sudo docker compose up`), or add your user to the
`docker` group so you don't have to. The **[Linux install guide](install/linux.md)** has the exact
post-install steps.

## Still stuck?

- Re-read your platform's guide — every step is spelled out: **[Windows](install/windows.md)** ·
  **[macOS](install/mac.md)** · **[Linux](install/linux.md)**.
- Check the **[FAQ](faq.md)** for the "why" behind a behavior.
- Unsure what a word means? → the **[Glossary](glossary.md)**.

---

← Back to the **[documentation home](README.md)**
