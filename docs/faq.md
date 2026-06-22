# FAQ

Short answers to the questions people ask most. Each one links to a fuller page if you want the detail.

## What is this, exactly?

It brings back the little animated characters that lived on the Windows desktop in the late 1990s — Genie,
Merlin, Clippy, and friends — and runs them right in your web browser. They move, gesture, talk out loud,
and show a comic-style speech balloon. → **[What is this?](what-is-this.md)** tells the whole story from
scratch.

## Do I need to be a programmer?

**No.** To see a character on screen and hear it talk, you install one free app (Docker), run a single
command, and open a web page. That's it. → **[Getting started](getting-started.md)**.

## Is this legal?

The vivify **software** is free and open-source (MIT) and ships **no** Microsoft files and **no**
characters. The character files and the original voice software are their owners' — so vivify never
includes or redistributes them; **you supply your own copies**. That split is exactly what keeps it clean
and shareable. → the full posture is in **[Legal & assets](legal-and-assets.md)**.

## Why is there no sound? / Why do I need extra files for the voice?

There are two voices. Out of the box, characters use your **browser's** built-in voice — that needs
nothing. The **authentic** original voice is closed 1990s Windows speech software that can't run inside a
browser, so it runs in a small helper you set up once (with a few free files you supply). If you hear
nothing, you're almost certainly missing that helper — or just haven't enabled it. → **[The authentic
voice](voice/overview.md)**, and **[Troubleshooting → No sound](troubleshooting.md)**.

## Which characters work?

Any Microsoft Agent character file (a `.acs` file) — Genie, Merlin, Peedy, Robby, Clippy, and the many
characters fans made. You bring your own; vivify ships none. → **[Characters](characters.md)** explains
what they are and where to find them.

## What platforms does it run on?

The characters run in any modern **web browser**. The setup (Docker) works on **Windows, macOS, and
Linux** — there's a hand-held guide for each. → **[Getting started](getting-started.md)**.

## Is my data sent anywhere?

No. The playground runs entirely in your browser. Even the authentic voice talks only to a helper on
**your own machine** (`localhost`) — nothing is sent to vivify or any third party.

## Why is the very first thing I say a little slow or slightly clipped?

Only with the authentic voice, and only the **first time** for a brand-new sentence: the engine takes a
moment to generate it, and its very first instant can be ever-so-slightly clipped. Say the same line again
and it's **instant** (the helper remembers every line it has spoken). Totally normal — more in
**[Troubleshooting](troubleshooting.md)**.

## Can I put a character in my own website or app?

Yes — that's a core goal. The engine is a framework-agnostic library you can drop into React, Vue, Svelte,
or plain JavaScript, with a talking character in about ten lines. → **[For
developers](developers/overview.md)**.

## Where do I go when something breaks?

→ **[Troubleshooting](troubleshooting.md)** — common hiccups and friendly fixes.

---

← Back to the **[documentation home](README.md)**
