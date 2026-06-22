# Docs capture (Playwright)

Generates the screenshots and GIFs of vivify running that the docs reference. It drives the **live**
MASH demo, so you run it locally against your own stack — it can't run in CI (no Docker/Wine/voice
there).

## What you need

- The app running: **`docker compose up`** from the repo root.
  - MASH serves at **http://localhost:8090** — enough for the app/portrait stills and the animation GIF.
  - The voice container at **http://localhost:8080** is needed only for the **talking / lip-sync**
    shots (`*-speaking.*`). That's Tier 2 — see the [install pages](../../docs/install/windows.md).
- A character file: **your own `.acs`** (e.g. `Genie.acs`). vivify ships none; see
  [Legal & assets](../../docs/legal-and-assets.md). It is passed by path and **never committed**
  (`*.acs` is gitignored).
- The browser, installed once: **`pnpm capture:setup`** (runs `playwright install chromium`).

## Run it

```bash
# from the repo root, with the stack up:
pnpm capture:setup                              # once
pnpm capture -- --acs /path/to/Genie.acs        # capture with defaults
```

Note the `--` (everything after it is passed to the script, not to pnpm).

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--acs <path>` | _required_ | The `.acs` character to load (unless `--smoke`). |
| `--url <url>` | `http://localhost:8090` | The MASH URL. Use `http://localhost:5173` against `pnpm --filter mash dev`. |
| `--name <prefix>` | `genie` | Output filename prefix. |
| `--out <dir>` | `<repo>/assets` | Output root (`screenshots/` and `gifs/` are created under it). |
| `--speak <text>` | a friendly hello | Text typed into the balloon. |
| `--animation <name>` | auto-pick | Which animation to play for the GIF. |
| `--no-speak` | off | Skip the talking shots (no voice container needed). |
| `--smoke` | off | Just verify the page + selectors load; no `.acs`, no images. |
| `--headed` | off | Show the browser window (default headless). |

## What it writes (default `--name genie`)

```
assets/screenshots/genie-app.png        the whole MASH window — character + animation grid
assets/screenshots/genie-portrait.png   just the character (the #stage element)
assets/screenshots/genie-speaking.png   a still mid-speech (balloon up, mouth moving)
assets/gifs/genie-animation.gif         a representative animation playing
assets/gifs/genie-speaking.gif          Genie talking with his mouth moving
```

The docs reference the `genie-…` paths. If you capture a different character with `--name`, either
update the doc image paths or keep `genie` for the wired pages. Run once per character to grow the
gallery.

## Then commit the images

```bash
git add assets/screenshots assets/gifs
git commit -m "docs(assets): capture screenshots + GIFs of the running app"
```

The docs' `![…]` references resolve once these files are committed. (Before that, they 404 — expected.)

## Notes & troubleshooting

- **Mouth not moving in `*-speaking.*`?** The voice container probably isn't up. Bring up the full
  `docker compose up` (not just `mash`), or pass `--no-speak` to skip those shots.
- **GIFs** are built from a loop of element screenshots → `pngjs` → `gifenc` (256-colour, downscaled to
  480px wide by default). No `ffmpeg` needed. They show motion but aren't frame-accurate — fine for docs.
- **Smoke test without a character:** `pnpm capture -- --smoke --url http://localhost:5173` confirms the
  selectors against a dev server.
- The script reads the `.acs` only to upload it to the page; it never writes the `.acs` anywhere, and
  bakes in no download of any proprietary asset.
