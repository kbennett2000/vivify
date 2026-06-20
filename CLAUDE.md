# CLAUDE.md — vivify

> Working name: **vivify**. If the repo is renamed, find/replace `vivify` everywhere.

## What this is
Bring Microsoft Agent characters (Genie, Merlin, Peedy, Robby, Clippy, and any `.acs` ever made) back to life **in the browser**, faithfully. Three things ship from this monorepo:

1. **`@vivify/core`** — a framework-agnostic engine that loads a character and renders/animates/speaks it. Drop-in for React/Vue/Svelte/vanilla. API mirrors the classic Agent control (`show`, `play`, `animations`, `speak`, `moveTo`, `gestureAt`, `stop`) with an action queue.
2. **`@vivify/acs`** — the `.acs` parser + `acs2bundle` CLI. Same module runs in Node (convert ahead-of-time) and in the browser (drop a raw `.acs` and it runs).
3. **`@vivify/voice-truvoice`** + **voice server** — the authentic-voice path: a Dockerized Wine + SAPI4 + L&H TruVoice service that returns `{ audio, mouthTimeline }`, plus the provider that talks to it.

The **MASH clone** (`apps/mash`) is the showcase + dogfood of the public API. It is the demo, not the product.

## Non-negotiables (the constitution for this repo)
- **100% authentic experience.** No substitute voices, no "close enough" animation. The real character pixels, the real balloon, the real TruVoice voice with real lip-sync. If a shortcut compromises fidelity, it's wrong by definition here.
- **Superset format.** Our intermediate representation (IR) and on-disk bundle capture *everything* an `.acs` holds — multi-image frame compositing, branching, per-frame sounds, mouth/lip-sync data, balloon config, voice config, state map. clippy.js compatibility is a one-way *import* convenience, never a constraint. (See ADR-0003.)
- **Permissive license, zero bundled IP.** Code is MIT. We never commit Microsoft/L&H binaries or `.acs` character files. They're gitignored; users supply their own. (See ADR-0006 and `docs/legal-and-assets.md`.)
- **Framework-agnostic core.** `@vivify/core` has no framework dependency. (See ADR-0007.)

## How we work
- **PO plans, CC implements.** Kris is the product owner and writes the specs/cycles. Claude Code does the coding.
- **Small, reviewable cycles.** Default to the smallest load-bearing unit that can be reviewed and merged. If a monolith is genuinely the better call, say so and make the case — don't just split for splitting's sake.
- **Diffs over self-reports.** Nothing is "done" because the implementer says so. Done = the acceptance check in the cycle doc passes, tests are green, and the diff has been read. Reviews assume nothing from a summary; they read the code.
- **Validation against oracles, not vibes.** Every claim about the `.acs` format is validated against a ground-truth oracle (DoubleAgent's reader and/or Lebeau's MSAgent Decompiler output), never against "looks right."
- **Brutal honesty.** Flag risks, dead ends, and things that smell wrong early and plainly. No validation theater.

## Repo conventions
- **Monorepo**: pnpm workspaces. `packages/*` for libraries, `apps/*` for the demo, `services/*` for the voice server.
- **TypeScript strict** everywhere. ESM. Node 20+.
- **Tests**: vitest. Tests are written failing-first where practical and never assert against their own mocks. Parser tests diff against oracle output / golden fixtures.
- **ADRs**: load-bearing decisions go in `docs/decisions/` (see existing ADRs for the template). Use the `decision-recorder` agent.
- **Cycle docs**: each build cycle has a spec in `docs/cycles/`. Implement to the spec; if reality diverges, update the doc in the same PR.
- **Handoffs**: end every working session with the `session-closer` agent — what changed, what's *verified* vs *assumed*, open threads, the next concrete step.
- **Commits/PRs**: conventional commits; one PR per cycle; CI (typecheck + test + lint) must be green AND the diff reviewed before merge. Never force-merge on green alone.

## Agent roster (`.claude/agents/`)
- `test-writer` — failing-first tests tied to the cycle's acceptance check.
- `code-reviewer` — reviews the diff for correctness, scope creep, security; trusts nothing from self-reports.
- `fresh-eyes` — re-derives the approach from scratch; challenges assumptions; finds what was missed.
- `debugger` — reproduce → isolate → root-cause. No shotgun fixes.
- `doc-writer` — keeps cycle docs / README accurate to the code.
- `doc-auditor` — checks docs against reality and flags drift.
- `session-closer` — writes the handoff at end of session.
- `decision-recorder` — writes an ADR when a load-bearing decision is made.

## Definition of done (per cycle)
1. The acceptance check in the cycle's `docs/cycles/*.md` passes, demonstrably.
2. Tests cover the new behavior and are green in CI.
3. Docs updated; an ADR exists if a load-bearing decision was made.
4. The diff has been read by a human (or `code-reviewer` + human), not merged on a summary.
5. No third-party IP committed. No `.acs`, no engine binaries, no Wine prefix.
