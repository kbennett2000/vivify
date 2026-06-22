# The authentic voice — overview

Your character can talk two ways. Out of the box, it uses your **browser's** built-in voice — that works
instantly, with nothing to install. But vivify can also give it its **real, original voice**: the actual
late-1990s synthesizer the Microsoft Agent characters spoke with. This page explains what that is, and why
it takes a little extra setup.

> 💾 **Remember when…** every program had _that_ slightly robotic voice reading text aloud? That voice was
> real software — and it still works. We just had to coax it into the modern web. (Skip this box; it
> changes no instruction.)

## The two voices

| | **Browser voice** (default) | **Authentic voice** (TruVoice) |
| --- | --- | --- |
| Sounds like | your computer's modern built-in voice | the **original** 1990s character voice |
| Lip-sync | approximate (a best guess) | exact — driven by the real engine's mouth data |
| Setup | none — it just works | a small one-time setup (Docker + three free files you supply) |
| Best for | "I just want to hear it talk" | "I want the _real_ thing" |

Neither is wrong. The browser voice means you **never hit a dead end** — a character can always speak. The
authentic voice is the enthusiast upgrade, and it's the one that sounds like you remember.

## What "the authentic voice" actually is

It's **L&H TruVoice**, the text-to-speech voice that shipped with Microsoft Agent, driven by **SAPI 4**
(Microsoft's Speech API, version 4). That's the genuine article — not a modern soundalike. When Genie
speaks in his real voice, you're hearing the same engine people heard in 1998.

## Why it needs a small "helper"

Here's the catch: TruVoice and SAPI 4 are **closed 1990s Windows programs**. They were never meant to run
inside a web browser, and they can't — a browser has no way to load that old Windows software directly.

So vivify does the next best thing: it runs that original software in a **small background helper** — a
little service on your own machine that knows how to speak in the real voice. When your character talks,
your browser quietly asks the helper for the audio (and the precise mouth movements for lip-sync), and
plays it back. You never interact with the helper directly; it just sits there and does the voice.

This "the authentic voice lives in a backend service" decision is recorded in
[ADR-0004](../decisions/0004-authentic-voice-requires-backend.md), for the curious.

## What you'll need

Three things, all free, and only for this authentic-voice path:

1. **Docker** — the one tool that runs the helper for you (it's also what runs the playground).
2. **Three small files you supply yourself** — the original speech software. vivify ships **none** of it
   (it's not ours to give away), so you bring your own copies, once.
3. About a minute of setup.

That's it. The playground and the browser voice need none of this.

## Where to next

- **How does it all fit together?** → **[Setting up the authentic voice](setup.md)** — the concepts and
  the one-command flow.
- **Where do those three files come from?** → **[Where to get the voice components](sourcing-components.md)**.
- **Just give me the steps for my computer.** → the platform guides:
  **[Windows](../install/windows.md)** · **[macOS](../install/mac.md)** · **[Linux](../install/linux.md)**
  (each has an optional "Tier 2 — authentic voice" section).
- **What's a `.acs`? SAPI? lip-sync?** → the **[Glossary](../glossary.md)**, every term in plain English.

---

← Back to the **[documentation home](../README.md)**
