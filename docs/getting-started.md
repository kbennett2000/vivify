# Getting started

Want a cartoon character moving and talking in your web browser? You can have one on screen in **about a
minute**, and you do **not** need to be a programmer. This page shows you the shape of it, then points you
to a step-by-step guide for your exact computer.

Take a breath — this is the easy part. 🙂

> 💾 **Remember when…** you'd pop in a CD-ROM and a little assistant would wave hello? That's the feeling
> we're bringing back. (You can skip this box — it changes nothing.)

## First, the simplest path

There are two levels, and **you only need the first** to see a character come to life:

- **Level 1 — see it run.** A character on screen, talking with your browser's own built-in voice. Quick
  and easy. _(This page.)_
- **Level 2 — the real 1990s voice.** The authentic original voice, with a little extra one-time setup.
  Totally optional — come back for it later. → **[The authentic voice](voice/overview.md)**

## What "Level 1" looks like

Just four small beats — and the per-OS guide walks you through each one with no steps skipped:

1. **Install Docker.** It's one free app that runs everything for you, so you don't have to install a pile
   of separate pieces by hand. (Don't worry about what it _is_ — just install it like any other app.)
2. **Get the vivify project** onto your computer (a download, or `git clone` if you know what that is).
3. **Run one command** in a terminal, from the project folder:
   ```
   docker compose up mash
   ```
   The first time, it builds things and takes a few minutes — that's normal. Leave it running.
4. **Open your browser to [http://localhost:8090](http://localhost:8090)**, drag a character file (a
   `.acs` file) onto the page, click an animation to play it, type a sentence, and hit **Speak**.

**That's it — it's alive!** 🎉 The character moves, shows its little speech balloon, and talks.

> You supply your own `.acs` character files — vivify ships none. The
> **[Characters](characters.md)** page explains what they are and where to get them. It's quick.

## Now do it on your computer (the real steps)

Each guide is written for a total beginner, with every step spelled out. Pick yours:

- 🪟 **[Install on Windows](install/windows.md)**
- 🍎 **[Install on macOS](install/mac.md)**
- 🐧 **[Install on Linux](install/linux.md)**

## Where to go next

- **Curious what this even is?** → **[What is this?](what-is-this.md)** — Microsoft Agent explained from
  scratch, zero knowledge assumed.
- **Want the real, original voice?** → **[The authentic voice](voice/overview.md)** — what it is and the
  one-time setup.
- **Which characters can I use?** → **[Characters](characters.md)**.
- **Hit a snag?** → **[Troubleshooting](troubleshooting.md)**, or the **[FAQ](faq.md)**.
- **Hit a word you didn't know?** → the **[Glossary](glossary.md)**, plain English for every term.
- **You're a developer?** → **[For developers](developers/overview.md)** — embed vivify in your own app.

---

← Back to the **[documentation home](README.md)**
