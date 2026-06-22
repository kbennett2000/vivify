# Where to get the voice components

The authentic voice needs three small files that **you supply yourself**. This is the friendly tour of
_what_ they are and _why_ you bring your own. For the exact, up-to-date list of where to download each one,
this page points you to **[Legal & assets](../legal-and-assets.md)**, which is the single source of truth
for sourcing.

New here? The **[authentic voice overview](overview.md)** explains the big picture first.

## Why _you_ supply them (and we don't)

The original character voice is **closed 1990s Microsoft / Lernout & Hauspie speech software**. It isn't
ours to give away — so vivify ships none of it, never bundles it, and never auto-downloads it. You bring
your own copies, once. That's also what keeps vivify itself free, open, and clean to share. (The full
posture is [ADR-0006](../decisions/0006-permissive-license-no-bundled-ip.md) and
[ADR-0027](../decisions/0027-voice-one-command-build.md).)

It's a one-time thing, and the files are free and findable — they're old, archived software, not something
you buy.

## The three files

| File | In plain terms | What it's for |
| --- | --- | --- |
| **`spchapi.exe`** | the SAPI 4 speech runtime | the engine that turns text into speech |
| **`tv_enua.exe`** | the L&H TruVoice voice (American English) | the actual voice — Genie's "voice", and friends |
| **`speech.h`** | the SAPI 4 SDK header | a small build-time file the voice helper compiles against |

The first two are the speech engine and its voice. The third, `speech.h`, is a developer header file used
only while the helper builds itself — it carries Microsoft's copyright, so it gets the **same treatment**
as the binaries: user-supplied, never committed, never auto-fetched.

They all go in one place — `services/voice-server/vendor/` — with `speech.h` in a `sdk/include/`
sub-folder. The **[setup page](setup.md)** shows how they fit in; your **install guide** shows exactly
where to drop them.

## Where to actually download them

We don't link the proprietary files directly here, on purpose. Instead,
**[Legal & assets → §2 "Speech runtime"](../legal-and-assets.md)** lists the community sources that are
known to work (and which file comes from where). Start there — it's kept current and explains each option.

> One handy fact: you do **not** need the old Microsoft Agent program itself (`msagent.exe`) — vivify
> reimplements the character engine. Only these _speech_ pieces are needed, and only for the authentic
> voice.

## Where to next

- **The authoritative source list** → **[Legal & assets](../legal-and-assets.md)**.
- **How the voice setup fits together** → **[Setting up the authentic voice](setup.md)**.
- **Do it on your computer** → **[Windows](../install/windows.md)** · **[macOS](../install/mac.md)** ·
  **[Linux](../install/linux.md)**.

---

← Back to the **[documentation home](../README.md)**
