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

// Capture a sequence of element screenshots over ~durationMs. Element screenshots
// aren't frame-accurate (each call has overhead), but the result clearly shows
// motion, which is all the docs need.
async function captureFrames(target: Locator, frames: number, gapMs: number): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    buffers.push(await target.screenshot());
    if (i < frames - 1) await target.page().waitForTimeout(gapMs);
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

    // Stills: the whole app, and the character alone.
    await capturePng(window, join(shots, `${opts.name}-app.png`));
    await capturePng(stage, join(shots, `${opts.name}-portrait.png`));

    // GIF: a representative animation playing.
    const anim = await pickAnimation(page, opts.animation);
    if (anim) {
      const animName = (await anim.textContent())?.trim() ?? 'animation';
      log(`playing "${animName}" for the animation GIF`);
      await anim.click();
      const frames = await captureFrames(stage, 30, 90);
      encodeGif(frames, join(gifs, `${opts.name}-animation.gif`), { delayMs: 90, maxWidth: 480 });
      log(`wrote ${join(gifs, `${opts.name}-animation.gif`)}`);
    } else {
      warn('no animations to capture — skipping the animation GIF');
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
      await page.locator('#speakBtn').click();
      await page.waitForTimeout(500); // let synthesis start and the balloon open
      const status = (await page.locator('#status').textContent())?.trim() ?? '';
      if (/couldn't reach|failed/i.test(status)) {
        warn(
          `speech did not start: "${status}". The mouth may not move. Is the voice container up?`,
        );
      }
      const frames = await captureFrames(stage, 36, 80);
      encodeGif(frames, join(gifs, `${opts.name}-speaking.gif`), { delayMs: 80, maxWidth: 480 });
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
