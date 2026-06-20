# Cycle 2 — full parser + `acs2bundle` converter

## Goal
Generalize the Cycle 1 spike decoder to the **complete `.acs` format**, populate the full
`CharacterModel` IR (`@vivify/types`), and ship **`acs2bundle`**: `.acs` → web-ready bundle
(packed transparent sprite-sheet PNG + `manifest.json` validating the Cycle 0 zod schema +
extracted audio). Enforce the pixel grading deferred in ADR-0009. Seal the CI gap with committable
synthetic fixtures. The parser runs unchanged in Node and the browser.

## Format — the complete layout
> Derived by reading DoubleAgent's reader source (`oracle/double-agent/Core/*.cpp`, GPL, gitignored,
> never committed) and confirmed against the real fixtures. Our own words; no code copied. All
> little-endian. Cycle 1 covered the header, palette, image index/blocks, RLE, and the
> animation/frame table — see `cycle-1-findings.md`. This doc adds the rest.

### File header (offset 0)
`u32 signature = 0xABCDABC3`, then four `LOCATOR { u32 offset; u32 size }`:
`[0]` character/header block, `[1]` animation (gesture) index, `[2]` image index, `[3]` **audio
(sound) index**.

### Header/character block (locator[0]) — full sequence
`u16 verMinor`, `u16 verMajor`, `u32 namesOffset` (absolute; subtract the block offset → relative),
`u32 namesSize`, `GUID`, `u16 width`, `u16 height`, `u8 transparencyIndex`, `u32 style`
(`Tts=0x20`, `Balloon=0x200`, …), `u32` unknown(=2), then in order:
- **TTS block** if `style & Tts`: `GUID engine`, `GUID mode`, `i32 speed`, `i16 pitch`, `u8 hasLang`;
  if `hasLang`: `u16 langID`, `String`, `u16 gender`, `u16 age`, `String style`.
- **Balloon block** if `style & Balloon`: `u8 numLines`, `u8 charsPerLine`, `u32 fg`, `u32 bg`,
  `u32 border` (each BGRX/`COLORREF`), `String fontName`, `i32 fontHeight`, `u16 weight`,
  `u16 strikeout`, `u16 italic`.
- **Palette**: `u32 count` + `count × {u8 B,u8 G,u8 R,u8 _}` (≤256).
- **Icon**: `u8 hasIcon`; if set, two DIB blobs each `u32 blobSize` + `blobSize` bytes (mask, then
  color). Skipped by size (not interpreted).
- **States** (until `namesOffset`): `u16 stateCount` + per state `{ String name; u16 gestureCount;
  String gestureName[gestureCount] }` → `states: Record<stateName, animationName[]>`.
- **Names** (at `namesOffset`): `u16 nameCount` + per `{ u16 langID; String name; String desc1;
  String desc2 }`. `info.name` = the default/first entry's `name`.

### Strings, image index/blocks, animation/frame table, RLE
Unchanged from Cycle 1 (`cycle-1-findings.md`): `String = u32 charLen + UTF-16LE + NUL`; image index =
`u32 count` + `{offset,size,checksum}` (3×u32); image block = `u8 _,u16 w,u16 h,u8 compressed,
u32 dataLen, data`; animation index (locator[1]) = `u32 count` + `{String name,u32 offset,u32 size}`;
FRAME = `u16 imageCount` + images`{u32 idx,i16 x,i16 y}` + `i16 sound` + `u16 duration(1/100s)` +
`i16 exitFrame` + `u8 branchCount` + branches(`u32` = lo16 frameNdx, hi16 probability) + `u8
overlayCount` + overlays(14 bytes each).

### Frame mouth overlays (now captured)
Per-frame overlay = `u8 type`, `u8 replaceFlag`, `u16 imageNdx`, `u8 _`, `u8 rgnFlag`, `i16 offX`,
`i16 offY`, `i16 _`, `i16 _` (14 bytes). Stored losslessly into `FrameModel.mouth.raw.overlays`
(see ADR-0010 — structured lip-sync modeling is Cycle 6).

### Audio (sound) index (locator[3]) + sound blocks
Sound index = `u32 count` + `{u32 offset, u32 size, u32 checksum}` per sound. Each sound block is
**`size` raw bytes = the WAV file** (RIFF) verbatim → `SoundModel.wav`.

## The bundle (on-disk, web-ready)
`acs2bundle <in.acs> <outDir>` writes a versioned bundle (`formatVersion` from the Cycle 0 schema):
- **`sheet.png`** — one transparent PNG packing every unique decoded image (shelf bin-packing).
- **`manifest.json`** — the full `CharacterModel` minus pixel/WAV bytes: `info`, `palette`,
  `transparentIndex`, `sheet` (filename), `atlas[{x,y,w,h}]` (parallel to `images[]`), `animations`,
  `sounds[{src}]` (refs into `audio/`), `balloon`, `voice`, `states`. **Must pass
  `validateBundleManifest` (zod)** before write.
- **`audio/NNN.wav`** — extracted sounds.

## The parser is isomorphic
`parseAcs(ArrayBuffer)` (+ `binary-reader`/`rle`/`image`) has zero Node dependencies → it is the
in-browser runtime loader path. The Node-only pieces (`pngjs` encode, `fs`) live solely in the CLI;
the importable package entry stays browser-safe.

## Validation (no external runtime oracle — ADR-0009 gate)
The format was proven correct in Cycle 1 against Microsoft's published spec (names exact-match). This
cycle's pixel gate is **internal consistency + visual**, per ADR-0009:
- **Exact unique-image count**: `atlas.length === images.length`; every frame `imageIndex` in range.
- **Lossless sprite-sheet round-trip**: decode → pack → crop each atlas cell from the packed sheet →
  **pixel-for-pixel equal** to the decoded image (all images, all fixtures).
- **Composited-from-bundle**: rebuild animations by cropping atlas cells per the manifest → PNGs to
  gitignored `scripts/out/` for local visual review (never committed — ADR-0006).
- **Synthetic fixtures** (committed, zero MS IP): an in-memory `.acs`-format builder exercising every
  block (incl. a compressed image via a literal-only RLE test encoder) so **CI** runs the parser end
  to end. Real `.acs` tests are `skipIf`-gated (local only).

Run end-to-end on the present fixtures: **Genie, Merlin, Peedy, Robby**.

## Acceptance
- Genie + Merlin (+ Peedy + Robby) convert to bundles; manifests pass the zod validator.
- Exact unique-image count; lossless sprite-sheet round-trip (pixel-for-pixel).
- Synthetic fixtures → green parser tests in CI.
- Composited animations rebuilt from the bundle render coherently (PNGs to gitignored out).

## Non-goals
Browser rendering engine/queue (Cycle 3), balloon rendering, voice synthesis + structured lip-sync
(Cycle 5/6), clippy.js import. Mouth overlays are captured but not structurally modeled (Cycle 6).
