# Golden fixtures — Microsoft's published animation lists

`genie-animations.json` and `merlin-animations.json` are the **complete animation-name sets** for
the Genie and Merlin characters, transcribed verbatim (case- and underscore-exact) from
Microsoft's own published documentation:

- Genie: <https://learn.microsoft.com/en-us/windows/win32/lwef/microsoft-agent-animations-for-genie-character>
- Merlin: <https://learn.microsoft.com/en-us/windows/win32/lwef/microsoft-agent-animations-for-merlin-character>

These are the **independent oracle** for Cycle 1 acceptance #1: the `@vivify/acs` decoder's parsed
animation-name set for each character must equal the corresponding list here, exactly. The list is
Microsoft's spec — not derived from our decoder or any reimplementation.

This is factual interface data (a list of names), not character artwork or binaries, so it is safe
to commit (cf. ADR-0006, which forbids committing `.acs` files and extracted bitmaps/audio).

Genie = 76 animations, Merlin = 73.
