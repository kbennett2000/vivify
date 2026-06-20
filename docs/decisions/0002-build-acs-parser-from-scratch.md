# ADR-0002: Build the .acs parser from scratch
Status: Accepted · Date: 2026-06-20

## Context
There is no clean, permissively-licensed `.acs` → usable-asset parser to depend on. The format is fully reverse-engineered: DoubleAgent (GPL C++) reads it, and Lebeau's MSAgent Decompiler extracts from it.

## Decision
Write our own parser in TypeScript. Use DoubleAgent's reader and Lebeau's decompiler as **format oracles** — read DoubleAgent to learn byte layouts, validate output against Lebeau's extracted bitmaps. Do **not** copy DoubleAgent's code (GPL; we ship MIT).

## Consequences
- Full control, MIT-clean, runs in Node and the browser.
- Bears the cost of implementing the RLE image codec and animation tables ourselves.
- Every format claim must be validated against an oracle, never assumed. Byte offsets are never trusted from memory — derive from oracle + hexdump.
