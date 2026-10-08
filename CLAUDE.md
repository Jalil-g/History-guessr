# History Guesser — Claude instructions

Hackathon project (2 people, ~2.5 h). A GeoGuessr-for-history game like eraguessr.ai: the player is
dropped into a **walkable, AI-generated historical scene**, talks to a local by voice, then guesses
**where** (map pin) and **when** (year). Scenes are extracted from a real history book so they are
historically grounded and citable. ~20 scenes.

`Design.md` is the feature list — keep it current.

## Stack (planned)

- Next.js (App Router) + React 19 + TypeScript + Tailwind, pnpm 10 (`corepack prepare pnpm@10.18.0 --activate`)
- **Gemini** (Google AI Studio key): text model to extract scenes from the book; image model to paint
  each scene's first frame; Gemini Live for voice chat with a local.
- **Reactor** world model (`@reactor-team/js-sdk`, LingBot World 2): turns the first frame + a prompt
  into a walkable real-time world driven by WASD.
- Leaflet for the guess map. Cloud Run for hosting.

## Commands (once scaffolded — keep this list accurate)

```bash
pnpm install
pnpm dev               # keep NEXT_PUBLIC_MOCK_WORLD=1 while building UI (no Reactor spend)
pnpm typecheck         # tsc --noEmit — must pass before every PR
pnpm build             # must pass before every PR (the merge agent runs it too)
node --env-file=.env.local scripts/extract-scenes.ts    # book → data/scenes.json
node --env-file=.env.local scripts/generate-images.ts   # scenes.json → public/scenes/<id>.png
```

Node 24 runs `.ts` scripts directly (type stripping) — no ts-node/tsx needed.

## Architecture

```
data/short-history-of-the-world.txt   H.G. Wells, A Short History of the World (1922, public domain)
        │  scripts/extract-scenes.ts — Gemini text model, structured JSON output
        ▼
data/scenes.json                      THE CONTRACT between pipeline and game (type in lib/scene.ts)
        │  scripts/generate-images.ts — Gemini image model
        ▼
public/scenes/<id>.png                first frame of each scene (generated offline, committed)
        ▼
Game  intro → round (world + voice + guess) → reveal (score + book citation) → … → summary
  ├─ World      Reactor session: image + world prompt → WASD-driven live video
  ├─ Voice      Gemini Live, persona from the scene, ephemeral token minted server-side
  └─ Guess      Leaflet pin + year slider → score (distance + year, max 5000 each)
```

Scene shape (`lib/scene.ts`): `id`, `answer { place, lat, lng, year }`, `reveal`, `imagePrompt`,
`worldPrompt { base, idle, moving }`, `title`, `local { name, voice, persona }`, `source { chapter, quote }`.

Rules:
- **Everything slow or paid is generated offline** (scene text, images) and committed. At runtime the
  only paid calls are the Reactor session and the Gemini Live session.
- **Historical accuracy**: every scene carries `source { chapter, quote }` copied verbatim from the book.
  Wells is from 1922 — the extractor may correct dated facts (dates, coordinates) with model knowledge,
  but must not invent events that aren't in the book. Show the quote on the reveal.
- Never leak the answer before the guess: no place/year in rendered text, world prompt or persona speech.
- API keys only in `.env.local` and server routes; the browser gets short-lived tokens only.
- Reactor costs real money: cap session length and idle time in `lib/config.ts`; mock mode by default.

## Coding / documenting guidelines (mandatory)

1. **One file per feature** (or tightly related features). Split aggressively — it also keeps merge
   conflicts down.
2. **Every file starts with a long header comment** explaining in detail what the feature is, how it
   fits the architecture above, and its different use cases.
3. **Docstrings on every function** (JSDoc `/** … */`): what it does, params, return.
4. **`Design.md` at the repo root documents every feature.** Any PR that adds or changes a feature
   updates `Design.md` in the same PR.
5. **Logging** via `lib/log.ts`:
   - every function call at info level with its parameters: `log.info("fnName", { ...params })`;
   - every GenAI call (Gemini text/image/Live token, Reactor image/prompt) with **all** parameters —
     model, prompt, config — and its output: `logGenAI(name, request, response)`. Inline data is
     stripped automatically. Never log API keys or tokens.
6. **All configurable items in `lib/config.ts`**: model names, scene count, rounds, timeouts, budgets,
   paths. No model name or magic number anywhere else.

## Git workflow (two humans + a merge agent)

- **`main` must always build.** Nobody commits or pushes to `main` directly — only the merge agent
  merges into it, via rebase-merged PRs (every commit is kept on `main`).
- **Branch per task**: `<initials>/<short-topic>` from fresh `main`, e.g. `jj/extract-scenes`.
  Keep branches small and short-lived (≤ 30–40 min of work).
- **Several Claude sessions on one machine → git worktrees**, one per branch:
  `git worktree add ../hg-<topic> -b <initials>/<topic> origin/main`.
- Before a PR: `git fetch && git rebase origin/main`, then `pnpm typecheck && pnpm build`.
- `gh pr create --fill`. Not ready → `--draft` or label `wip`; the merge agent skips those.
- **Commit maxing — commit small and often.** One logical step per commit (a new file, a wired-up
  prop, a config key, a doc update, a fix), typically every 5–15 minutes of work. Never batch a whole
  feature into one commit. Push after every commit so teammates and the merge agent see progress.
- Commit messages: imperative one-line summary.
- **Hot files** — coordinate before editing: `lib/config.ts`, `lib/scene.ts`, the top-level game
  component, `data/scenes.json` (only the extract script rewrites it; hand edits in their own PR).
- Never commit `.env*` (except `.env.example`), and never read `.env.local` into the conversation.

## Merge agent

A third terminal runs `claude` in a dedicated worktree and `/loop 5m /merge-prs`.
Procedure: `.claude/skills/merge-prs/SKILL.md`.
