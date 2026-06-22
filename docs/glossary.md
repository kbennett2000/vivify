# Glossary

Every technical term vivify's docs use, in plain English. New to all this? Read
**[What is this?](what-is-this.md)** first, then keep this page handy.

### Microsoft Agent

The late-1990s Microsoft technology that put animated cartoon characters on the Windows desktop — they
moved, talked, and showed a speech bubble. Microsoft retired it and removed it from Windows starting with
Windows 7. vivify is a faithful, browser-based revival. (Full story: [What is this?](what-is-this.md).)

### Character (or "agent")

One of those animated personalities — Genie, Merlin, Clippy, and so on. In vivify, you load a character and
then tell it to show itself, play animations, and speak.

### `.acs` file

The single file that holds one character — all of its pictures, animations, sounds, and settings bundled
together. (`.acs` stands for "Agent Character Storage.") It's Microsoft's format; **you supply your own**
`.acs` files (see [Legal & assets](legal-and-assets.md)) — vivify ships none.

### Animation

A named sequence the character can play — like `Greet`, `Wave`, or `Think`. Each character comes with its
own list of animations built into its `.acs` file.

### Frame

A single still picture in an animation. Play frames in sequence, at the right speed, and the character
appears to move — exactly like a flip-book.

### Sprite sheet

A single big image that packs many of a character's frames together in a grid. It's an efficient way to
store and load lots of small pictures at once.

### Speech balloon

The comic-strip-style bubble that shows the character's words while it talks. vivify draws each character's
balloon in its original style.

### Text-to-speech (TTS)

Software that reads written words aloud in a synthesized voice. When a vivify character "speaks," TTS is
what turns your text into sound.

### SAPI / SAPI4

The **Speech API** — Microsoft's system for text-to-speech on Windows. **SAPI4** is the specific
(mid-1990s) version the original characters used. It's old Windows software, which is why the authentic
voice needs a small helper to run today (see [The authentic voice](voice/overview.md)).

### TruVoice

The specific text-to-speech engine (made by a company called Lernout & Hauspie) that produced the classic
character voices — including Genie's. It's the "authentic" voice vivify can use.

### Lip-sync (and "viseme")

**Lip-sync** is the character's mouth moving in time with the words it speaks. A **viseme** is the mouth
shape for a particular speech sound — the visual counterpart of a sound you hear. vivify lines these up so
the mouth matches the audio.

### Bundle

A web-ready version of a character that vivify can load quickly in a browser. vivify can run a raw `.acs`
file directly, or a pre-converted bundle (made with the `acs2bundle` tool — see
[Character bundles](developers/bundles.md)).

### Provider (and "fallback voice")

A **provider** is the source of a character's speech. vivify has two: the **authentic** provider (the real
TruVoice voice, via the helper service) and a **fallback** provider that uses your **browser's own
built-in voice**. The fallback means a character can talk with nothing extra installed; the authentic voice
is an optional upgrade.

### Wine

Free software that lets old Windows programs run on macOS and Linux. vivify uses it behind the scenes to
run the vintage Windows speech software for the authentic voice. (You don't interact with it directly.)

### Docker

A free tool that packages a program with everything it needs so it runs the same on any computer, with one
command. vivify uses it to run the voice helper (and the playground) without you having to install a pile
of parts by hand.

---

← Back to the **[documentation home](README.md)**
