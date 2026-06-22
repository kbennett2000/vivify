// Docs-capture script — drives the running MASH demo with Playwright and saves
// screenshots + GIFs of vivify actually running, for the documentation pages.
//
// This needs the LIVE app, which only runs on the operator's machine:
//   • MASH (Docker)             → http://localhost:8090   (all shots)
//   • the voice container       → http://localhost:8080   (only the *-speaking.* shots)
//   • an operator-supplied .acs → passed via --acs        (never committed)
//
// Run:  pnpm capture:setup            (once — installs the Chromium browser)
//       pnpm capture -- --acs /path/to/Genie.acs
//
// See scripts/capture/README.md for the full guide and every flag.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from 'playwright';
import { encodeGif } from './gif.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Options {
  url: string;
  acs: string | null;
  name: string;
  out: string;
  speak: string;
  animation: string | null;
  noSpeak: boolean;
  smoke: boolean;
  headed: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    url: 'http://localhost:8090',
    acs: null,
    name: 'genie',
    out: join(REPO_ROOT, 'assets'),
    speak: 'Hello! I am alive in your browser.',
    animation: null,
    noSpeak: false,
    smoke: false,
    headed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--':
        break; // pnpm forwards a literal `--` separator; ignore it.
      case '--url':
        opts.url = next();
        break;
      case '--acs':
        opts.acs = resolve(next());
        break;
      case '--name':
        opts.name = next();
        break;
      case '--out':
        opts.out = resolve(next());
        break;
      case '--speak':
        opts.speak = next();
        break;
      case '--animation':
        opts.animation = next();
        break;
      case '--no-speak':
        opts.noSpeak = true;
        break;
      case '--smoke':
        opts.smoke = true;
        break;
      case '--headed':
        opts.headed = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm capture -- --acs <path-to.acs> [options]',
      '',
      '  --acs <path>        REQUIRED (unless --smoke): the .acs character to load. Never committed.',
      '  --url <url>         MASH URL (default http://localhost:8090).',
      '  --name <prefix>     Output filename prefix (default "genie").',
      '  --out <dir>         Output root (default <repo>/assets).',
      '  --speak <text>      Text typed into the balloon (default a friendly hello).',
      '  --animation <name>  Animation to play for the GIF (default: auto-pick).',
      '  --no-speak          Skip the talking shots (no voice container needed).',
      '  --smoke             Verify the page + selectors only; no .acs, no images.',
      '  --headed            Run the browser visibly (default headless).',
    ].join('\n'),
  );
}

const log = (msg: string): void => console.log(`[capture] ${msg}`);
const warn = (msg: string): void => console.warn(`[capture] ⚠ ${msg}`);

function ensureDirs(out: string): { shots: string; gifs: string } {
  const shots = join(out, 'screenshots');
  const gifs = join(out, 'gifs');
  mkdirSync(shots, { recursive: true });
  mkdirSync(gifs, { recursive: true });
  return { shots, gifs };
}

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Capture a sequence of frames over time. Uses a page-level clip (a tight box
// around the character) when given, else the element. Screenshots aren't
// frame-accurate (each call has overhead), but the result clearly shows motion.
async function captureFrames(
  page: Page,
  clip: Clip | undefined,
  fallback: Locator,
  frames: number,
  gapMs: number,
): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    buffers.push(clip ? await page.screenshot({ clip }) : await fallback.screenshot());
    if (i < frames - 1) await page.waitForTimeout(gapMs);
  }
  return buffers;
}

async function loadCharacter(page: Page, opts: Options): Promise<void> {
  log(`opening ${opts.url}`);
  await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
  await page.locator('#file').waitFor({ state: 'attached', timeout: 15_000 });

  if (opts.smoke) return;

  log(`uploading ${opts.acs}`);
  await page.locator('#file').setInputFiles(opts.acs as string);
  // The app sets #status to "Loaded <name> — N animations …" on success.
  await page
    .locator('#status')
    .filter({ hasText: /Loaded/i })
    .waitFor({ timeout: 30_000 });
  await page.locator('#animations .anim').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800); // let the first idle frame settle
  const count = await page.locator('#animations .anim').count();
  log(`character loaded — ${count} animations`);
}

async function smokeCheck(page: Page): Promise<void> {
  const required = [
    '#file',
    '#stage',
    '#animations',
    '#speak',
    '#speakBtn',
    '#voiceUrl',
    '#status',
  ];
  for (const sel of required) {
    const ok = (await page.locator(sel).count()) > 0;
    if (!ok) throw new Error(`smoke: selector ${sel} not found — is this the MASH app?`);
    log(`✓ ${sel}`);
  }
  log('smoke OK — page and selectors present');
}

async function capturePng(target: Locator, file: string): Promise<void> {
  await target.screenshot({ path: file });
  log(`wrote ${file}`);
}

async function pickAnimation(page: Page, requested: string | null): Promise<Locator | null> {
  const buttons = page.locator('#animations .anim');
  if (await buttons.count()) {
    if (requested) {
      const byName = buttons.filter({ hasText: requested });
      if (await byName.count()) return byName.first();
      warn(`animation "${requested}" not found — using the first one`);
    }
    return buttons.first();
  }
  return null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.smoke && !opts.acs) {
    warn('no --acs given. Pass a .acs path, or use --smoke to check selectors only.');
    printUsage();
    process.exit(1);
  }
  if (opts.acs && !existsSync(opts.acs)) throw new Error(`--acs file not found: ${opts.acs}`);

  const browser = await chromium.launch({ headless: !opts.headed });
  const page = await browser.newPage({ viewport: { width: 920, height: 860 } });
  try {
    await loadCharacter(page, opts);

    if (opts.smoke) {
      await smokeCheck(page);
      return;
    }

    const { shots, gifs } = ensureDirs(opts.out);
    const window = page.locator('.window');
    const stage = page.locator('#stage');

    // Play a representative animation first. The character only paints once an
    // action runs (right after load the stage is still empty), and this leaves it
    // holding a lively end pose for the stills.
    const anim = await pickAnimation(page, opts.animation);
    let animName = 'animation';
    if (anim) {
      animName = (await anim.textContent())?.trim() ?? 'animation';
      log(`playing "${animName}" to bring the character on stage`);
      await anim.click();
      await page.waitForTimeout(1600); // let it play through and hold its end pose
    } else {
      warn('no animations found — the character may not be visible in the stills');
    }

    // The character sits at the stage's left edge in a wide, mostly-empty stage.
    // Clip a tight box around it so the portrait and GIFs frame the character
    // (and the small mouth movement is actually visible) instead of empty space.
    const sb = await stage.boundingBox();
    const clip: Clip | undefined = sb
      ? {
          x: Math.round(sb.x),
          y: Math.round(sb.y),
          width: Math.round(Math.min(220, sb.width)),
          height: Math.round(Math.min(220, sb.height)),
        }
      : undefined;

    // Stills: the whole app (character on stage + animation grid), and a tight portrait.
    await capturePng(window, join(shots, `${opts.name}-app.png`));
    if (clip) {
      await page.screenshot({ path: join(shots, `${opts.name}-portrait.png`), clip });
      log(`wrote ${join(shots, `${opts.name}-portrait.png`)}`);
    } else {
      await capturePng(stage, join(shots, `${opts.name}-portrait.png`));
    }

    // GIF: replay the same animation and capture it playing.
    if (anim) {
      log(`replaying "${animName}" for the animation GIF`);
      await anim.click();
      const frames = await captureFrames(page, clip, stage, 30, 90);
      encodeGif(frames, join(gifs, `${opts.name}-animation.gif`), { delayMs: 90, maxWidth: 320 });
      log(`wrote ${join(gifs, `${opts.name}-animation.gif`)}`);
    }

    // Talking + lip-sync: needs the voice container at #voiceUrl (pre-filled to :8080).
    if (opts.noSpeak) {
      log('--no-speak set — skipping the talking shots');
    } else {
      await page
        .locator('#stopBtn')
        .click()
        .catch(() => undefined);
      await page.locator('#speak').fill(opts.speak);
      log('clicking Speak — needs the voice container for authentic audio + lip-sync');
      // The engine logs a lip-sync tick the instant audio starts (and the balloon
      // shows). Wait for that so we capture the actual mouth movement, not the
      // synthesis wait — robust whether the phrase is cached (instant) or fresh (~3-4s).
      const audioStarted = page
        .waitForEvent('console', {
          predicate: (m) => m.text().includes('[vivify:lipsync] t='),
          timeout: 20_000,
        })
        .then(() => true)
        .catch(() => false);
      await page.locator('#speakBtn').click();
      const started = await audioStarted;
      const status = (await page.locator('#status').textContent())?.trim() ?? '';
      if (!started || /couldn't reach|failed/i.test(status)) {
        warn(
          `speech may not have started (status: "${status}"). The mouth may not move — is the voice container up?`,
        );
      }
      const frames = await captureFrames(page, clip, stage, 40, 90);
      encodeGif(frames, join(gifs, `${opts.name}-speaking.gif`), { delayMs: 90, maxWidth: 320 });
      log(`wrote ${join(gifs, `${opts.name}-speaking.gif`)}`);
      // A still from the middle of the utterance (balloon up, mouth mid-move).
      const mid = frames[Math.floor(frames.length / 2)];
      if (mid) {
        const file = join(shots, `${opts.name}-speaking.png`);
        writeFileSync(file, mid);
        log(`wrote ${file}`);
      }
    }

    log('done — review the files, then `git add assets/ && git commit`.');
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(`[capture] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
