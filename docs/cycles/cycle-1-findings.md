# Cycle 1 findings — the `.acs` byte layout (derived)

> **Source of truth.** This layout was derived by reading DoubleAgent's reader
> (`oracle/double-agent/Core/AgentFileAcs.cpp`, `AgentFileBinary.cpp`,
> `AgentFileParts.h` — GPL, gitignored, never committed) and confirmed against a
> hexdump of the real `Genie.acs`. It is described here in our own words; no
> DoubleAgent code is copied. Field names are ours. All integers are
> **little-endian**. Offsets are byte offsets within the file or within a block.
>
> Scope per Cycle 1: we model the **header → palette → image list → animation
> table**. TTS, balloon, icon, states, names, sounds, and per-frame mouth
> overlays are parsed only insofar as needed to skip them; their bodies are not
> interpreted (Cycle 2).

## File header (offset 0)
| off | type | field |
|----:|------|-------|
| 0 | `u32` | signature = `0xABCDABC3` (ACS). (`0xABCDABC4`=ACF, `0xABCDABC1`/`0xE011CFD0`=old v1.5) |
| 4 | `LOCATOR` | **character/header** block |
| 12 | `LOCATOR` | **gesture/animation index** |
| 20 | `LOCATOR` | **image index** |
| 28 | `LOCATOR` | **audio/sound index** |

`LOCATOR` = `{ u32 offset; u32 size; }` (8 bytes) — an absolute file offset + byte
length of the block. The four section blocks live near EOF; the concatenated
image/animation **data** begins right after the 36-byte header.

## Strings
`{ u32 charLen; WCHAR text[charLen]; /* if charLen>0: */ u16 0x0000 }` — `charLen`
is a UTF-16 **code-unit count** (not bytes). A trailing null code unit follows a
non-empty string. `charLen==0` ⇒ just the 4-byte length, no text, no terminator.

## Character/header block (at locator[0])
| type | field |
|------|-------|
| `u16` | versionMinor |
| `u16` | versionMajor |
| `u32` | namesOffset (absolute) |
| `u32` | namesSize |
| `GUID` | guid (16 bytes) |
| `u16` | width (default frame width, px) |
| `u16` | height (default frame height, px) |
| `u8`  | **transparency** = palette index used as the color key |
| `u32` | style flags (`Tts=0x20`, `Balloon=0x200`, …) |
| `u32` | unknown (always `0x00000002`) |
| … | if `style & Tts`: TTS block (skip) |
| … | if `style & Balloon`: balloon block (skip) |
| `PALETTE` | color table (below) |
| … | icon block, then states/names (skip) |

### Palette
`{ u32 count; BGRX entry[count]; }` where each entry is 4 bytes `{ u8 B; u8 G; u8 R;
u8 reserved }` (Windows `RGBQUAD`/`COLORREF` order). `count ≤ 256`. Map index→`(R,G,B)`;
the `transparency` index becomes **alpha 0**, all others alpha 255.

## Image index (at locator[2])
`{ u32 count; IMGREF entry[count]; }`, `IMGREF = { u32 offset; u32 size; u32 checksum }`
(12 bytes). `entry[i].offset` points to image *i*'s block. `count` is the
**unique-image count** (gates acceptance #3).

## Image block (at each `IMGREF.offset`)
| type | field |
|------|-------|
| `u8`  | unknown1 (must be `>0`; `0` ⇒ image skipped/empty) |
| `u16` | width |
| `u16` | height |
| `u8`  | compressed (nonzero ⇒ RLE-compressed) |
| `u32` | dataLen (bytes of image data that follow) |
| `u8[dataLen]` | image data |

Pixels are **8-bit palette indices**, one byte per pixel, row stride
`((width + 3) & ~3)` (rows padded to a 4-byte multiple), **bottom-up** (DIB
convention — row 0 is the bottom). Decoded size = `stride * height`.
- `compressed != 0`: run `dataLen` bytes through the RLE (below) to produce
  `stride*height` index bytes.
- `compressed == 0`: the `dataLen` bytes are the raw index rows.
(There can be a trailing "part 2" region/mask after the pixel data; ignored in Cycle 1.)

→ `ImageModel`: for each pixel index, emit `RGBA = (palette[idx].R, .G, .B, idx==transparency ? 0 : 255)`,
flipping rows to top-down for our IR.

## Gesture/animation index (at locator[1])
`{ u32 count; GESTURE entry[count]; }`, `GESTURE = { String name; u32 animOffset; u32 animSize }`.
This enumerates every animation by name; `animOffset` points to its block.

## Animation block (at each `animOffset`)
| type | field |
|------|-------|
| `String` | name |
| `u8` | returnType (`1`=exit-branching, `2`=none, else `returnName` is a named return animation) |
| `String` | returnName |
| `u16` | frameCount |
| `FRAME[frameCount]` | frames (below) |

### FRAME
| type | field |
|------|-------|
| `u16` | imageCount |
| `FRAMEIMAGE[imageCount]` | composited images |
| `i16` | soundNdx (`-1` = none) |
| `u16` | duration in **1/100 s** (→ ms = `×10`) |
| `i16` | exitFrame |
| `u8`  | branchCount |
| `BRANCH[branchCount]` | probabilistic next-frame jumps |
| `u8`  | overlayCount |
| `OVERLAY[overlayCount]` | mouth overlays (parsed-skip in Cycle 1) |

- `FRAMEIMAGE = { u32 imageNdx; i16 xOffset; i16 yOffset }` (8 bytes) — composite
  image `imageNdx` at `(x,y)`, in order.
- `BRANCH = u32` packed as `frameNdx = low 16 bits`, `probability = high 16 bits`
  (0–100). DoubleAgent keeps at most 3 but advances by `branchCount`.
- `OVERLAY` = 14 bytes `{ u8 type; u8 replaceFlag; u16 imageNdx; u8 unknown; u8 rgnFlag;
  i16 offX; i16 offY; i16 sX; i16 sY }`.

## RLE image codec (the `compressed` path)
A **bit-stream LZ77** over the 8-bit index bytes (DoubleAgent `DecodeData`).
Reproduced algorithmically (our own implementation in `src/rle.ts`):

- Preconditions (exactly as DoubleAgent's `DecodeData`): first byte is `0x00`; the stream ends
  with **≥5** trailing `0xFF` bytes (its guard is `lBitCount < 6`, counting the FF run + 1).
  Skip the first **5** bytes; bit position starts at 0.
- The bit reader reads a little-endian `u32` window from `src[ptr-4 .. ptr-1]`
  and shifts by the current bit position. After consuming *n* bits:
  `ptr += (bitpos + n) >> 3; bitpos = (bitpos + n) & 7`.
- Each token: read 1 flag bit.
  - **flag = 0** → literal: next 8 bits are a literal index byte → output it.
    (consumes 9 bits total)
  - **flag = 1** → back-reference. Read a unary-ish offset class to get the copy
    **distance** `D` (back into already-decoded output):
    | prefix bits | extra bits | distance |
    |-------------|-----------|----------|
    | `10` | 6 | `bits + 1` (1–64) |
    | `110` | 9 | `bits + 65` (65–576) |
    | `1110` | 12 | `bits + 577` (577–4672) |
    | `1111` | 20 | `bits + 4673`; the value `0xFFFFF` is the **end-of-image** marker |
    Then a length code: count leading 1-bits `k` (DoubleAgent breaks after >11, so cap 12), read `k` more bits `m`,
    length `L = (1<<k) + m + offsetBias` where `offsetBias` is 1 for the `10/110/1110`
    classes and 2 for the `1111` class (consumes `2k+1` bits). Copy `L` bytes from
    `out[pos-D]` (byte-by-byte; overlap allowed).
- Stop at the end marker, or when input/output is exhausted.

## Validation (Cycle 1) — GO

The byte layout above was **derived by reading DoubleAgent's reader source** (the format/algorithm,
not the code) and confirmed against a `Genie.acs` hexdump. The Cycle 1 spike is then graded by an
**independent oracle: Microsoft's own published animation lists** (Microsoft Learn — see
`packages/acs/test/golden/README.md`):

- **Acceptance #1 (names) — GO.** Our decoder's animation-name set equals Microsoft's published set
  **exactly**: **Genie 76/76**, **Merlin 73/73** (case- and underscore-exact, incl. Genie's
  `Idle1_5/1_6`/`Idle2_3` which Merlin lacks). This independently validates the header → gesture
  index → animation/frame parse. Test: `packages/acs/test/acs-spike.test.ts`.
- **Acceptance #2 (pixel decode) — GO (structural/visual).** Palette 256, transparency index 10,
  128×128 frames, 591 (Genie) / 614 (Merlin) decoded images, per-image opaque-pixel counts sane,
  and the `Greet` animation composites coherently across frames (PNGs reviewed locally; gitignored).

> The genuine MS Agent control + DoubleAgent `da-dump` answer-key approach was **superseded** before
> implementation (the control exposes no pixel/frame data; the decompiler refuses MS characters).
> DoubleAgent's source remains the basis of the byte-layout derivation above — that part stands.

## Deferred to Cycle 2 (see ADR-0009)
Byte-exact unique-image **count** and **per-pixel** grading of decoded images are deferred to
Cycle 2, where they gate the `acs2bundle` converter. The spike answers "did we decode the format"
(proven via the exact MS name match + structural/visual decode); byte-exact grading gates "ship the
converter." Items to settle then, now that there's no per-pixel oracle in Cycle 1:
- Row orientation (we assume bottom-up DIB and flip to top-down) — confirm per-pixel.
- Whether any image uses `compressed == 0` (raw) in these characters.
- The image "part 2" trailing region (region/mask) — harmless to the per-image parse (we seek by
  `IMGREF.offset`), but model it when byte-exactness is required.
- **Input hardening**: `parseAcs` currently trusts the on-disk image/animation/palette counts and
  loops on them directly. Before the browser path ingests untrusted `.acs` uploads (Cycle 2+),
  bound each count against the remaining file length so a malformed/hostile file degrades instead
  of over-allocating.
