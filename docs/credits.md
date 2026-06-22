# Credits

vivify stands on a lot of shoulders, and we're grateful for every one of them. This revival wouldn't exist
without the people who made the originals, the people who reverse-engineered the formats, and the people
who kept the files and the know-how alive for decades.

## The originals

- **The Microsoft Agent team.** They created the characters and the technology this project lovingly
  revives. Genie, Merlin, Peedy, Robby, Clippy, and the whole desktop-assistant era are theirs.
- **Lernout & Hauspie**, for the **TruVoice** text-to-speech engine that gave the characters their
  distinctive voices.

## Format references

Figuring out exactly how a `.acs` file is laid out — down to the byte — would have been far harder without
these. We studied them as references; vivify's parser is written from scratch.

- **[DoubleAgent](https://github.com/CinnamonSoftware/DoubleAgent)** (Cinnamon Software) — an open
  reimplementation of the Agent server that reads `.acs` files. Our ground-truth reference for the format.
- **Lebeau's MSAgent Decompiler** — extracts the original bitmaps and sounds from a `.acs`. We use it as a
  validation oracle: decode a character with vivify, then check it against what the decompiler extracts.

## Proof it could be done

- **[clippy.js](https://www.smore.com/clippy-js)** — showed the world that these characters could live
  again in a web browser. It blazed the trail; vivify aims for full-fidelity faithfulness on top of that
  inspiration.

## The authentic voice

- **[TETYYS/SAPI4](https://github.com/TETYYS/SAPI4)** — charted the path for running the vintage SAPI4 +
  TruVoice speech software under Wine and exposing it over HTTP. vivify extends that approach to also
  capture the mouth/lip-sync timing.

## Keeping it alive

- **TMAFE** (The Microsoft Agent Fan community) — for archiving and preserving the character files all
  these years, so there's anything left to revive at all.

---

A note on ownership: the characters, the speech engine, and related assets belong to their respective
owners. vivify ships **none** of them — you supply your own copies. See **[Legal &
assets](legal-and-assets.md)** for the details.

---

← Back to the **[documentation home](README.md)**
