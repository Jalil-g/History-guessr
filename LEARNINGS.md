# History Guesser: what we learned

A running log of decisions, model findings, bugs and fixes from building History Guesser at the hackathon.
Last updated: 2026-10-08.

> **Note on file paths:** sections 2 and 4 describe Cristian's local build (talking Vidu avatars, `components/game/*`, `scripts/create-avatars.py`). Jalil's restructured `main` uses a different layout (`components/world/*`, `components/voice/*`, `data/scenes.json`). The model and platform findings apply to both.

## 1. What we built

A GeoGuessr-style history game you can walk around in:

1. You're dropped into a live, AI-generated scene (Rome 44 BC, Giza 2560 BC, Edo 1830, Paris 1889, Apollo 11 1969).
2. You walk around it with WASD and the arrow keys (Reactor **LingBot World 2**).
3. You talk out loud to a local who answers with lip-synced video (Reactor **Vidu S2-Avatar**). They drop clues but never give the answer.
4. You pin a map and pick a year. Scoring follows EraGuessr: up to 5000 points for location plus 5000 for the year, both decaying exponentially.
5. The bonus finale is the fictional **"Summit of Titans 2026"**, a parody tech-CEO stage show.

## 2. Architecture

```
OFFLINE (once)
  lib/eras.ts ──imagePrompt──────▶ gemini-3.1-flash-image ──▶ public/eras/<id>.png    (scene first frame, 16:9)
  lib/eras.ts ──portraitPrompt───▶ gemini-3.1-flash-image ──▶ public/locals/<id>.png  (local's face, 3:4)
  public/locals/<id>.png ──create_avatar──▶ Vidu S2-Avatar ──▶ lib/avatars.json        (avatar ids, kept 90 days)

PER ROUND (browser)
  GET  /api/reactor/token ─▶ server mints a session-scoped Reactor JWT (models: lingbot-world-2 + vidu-s2-avatar,
                             max_session_duration_seconds = 300)
  Reactor #1 lingbot-world-2: uploadFile(era.png) → set_image → set_prompt → start → WASD/look commands
  Reactor #2 vidu-s2-avatar:  attach_avatar(id) → publish mic → start_call(persona, voice, greeting) → live
  GET  /api/persona          ─▶ persona text for the local (built server-side)
  Fallback: POST /api/live-token ─▶ Gemini Live ephemeral token → voice-only local (gemini-3.8-live)
  Guess → score → both sessions disconnect (billing stops)
```

**Key files:** `lib/config.ts` (all model names and budget settings), `lib/eras.ts` (scenes), `lib/world-models.ts` (world engine driver), `lib/local-persona.ts`, `lib/scoring.ts`, `components/game/*`, `scripts/*`.

**Stack:** Next.js 15 (App Router), Tailwind, `@reactor-team/js-sdk`, `@google/genai`, Leaflet. Deploys to Cloud Run (`Dockerfile`, `output: "standalone"`).

## 3. Model learnings

### Reactor (real-time world and avatar models)

| Model | $/min | Verdict |
|---|---|---|
| `reactor/lingbot-world-2` | 0.42 | ✅ **Used.** Walkable, image-anchored, realistic. 39 chunks in about 20 s, no errors. |
| `reactor/vidu-s2-avatar` | 0.42 | ✅ **Used** for locals. Lip-synced face and voice, about 6 s from connect to live with a pre-made avatar. |
| `reactor/lingbot` | 0.30 | ❌ Dropped: repeatedly "no available capacity". |
| `reactor/helios` | 0.10 | ❌ Dropped: no capacity, and you can't walk in it (prompt-steered only). |
| `reactor/happy-oyster-*` | 1.67 | Not tried: too expensive for our $175 budget. |
| `reactor/ltx2` | 1.80 | Not tried: generates a pre-made clip per script, so it can't hold a back-and-forth conversation. |

Live prices: `curl https://api.reactor.inc/pricing` (divide by `credits_per_dollar`).

**LingBot World 2**
- It needs **both** an image and a prompt before `start`. The image is uploaded with `uploadFile()` and then passed as a `FileRef` to `set_image`.
- Write prompts as layers: `base` (what the world is), plus `camera` and `movement` (each with a static and a moving variant). Swap the prompt when the player starts or stops moving, because anything the prompt says is moving will keep moving forever.
- Pin landmarks with explicit counts ("EXACTLY ONE temple straight ahead at a fixed position"), or the model invents duplicates as you look around.
- Keep the combined prompt under about 2000 characters (base ≤600).
- Movement uses two independent axes (`set_move_longitudinal`, `set_move_lateral`), which is what makes diagonals work. LingBot v1 has only one `set_movement`.

**Vidu S2-Avatar**
- **Create avatars ahead of time** (`scripts/create-avatars.py`) and `attach_avatar` at runtime. Creating one live is slow and can fail with `AVATAR_TIMEOUT`; that error is marked retryable, and a retry worked.
- **Only 3 of its 56 voices are English** (Aiden, Jennifer, Mione). The rest are Chinese.
- Its built-in LLM **leaked the answer** ("this is Rome", "Caesar") when we put the answer in the persona and asked directly. Fix: **never give it the answer**, remove giveaway words from the persona text, add a per-era `forbidden` word list, and set `max_tokens: 60`. After the fix it deflected in character.
- `say` is *input to the character* ("as if you had spoken it"), not text-to-speech. You can't use Gemini as the brain and Vidu only as the face.
- Declare all four tracks (`mic`, `webcam`, `main_video`, `main_audio`) even for an audio-only call, and call `resumeTrack` on the outputs once the phase is `live`.
- Transcripts arrive per sentence with `final: true`.
- Billing runs while the session is `ready`, even between calls, so disconnect at the end of the round.

**Reactor platform limits** (these caught us out)
- **5 concurrent sessions per account.** Each round uses 2 (world + avatar), so two players at once is already 4.
- **10 new sessions per minute per account**, with a burst of 3. Failed create attempts count too. The error looks like `429 {"error":"quota_exceeded","current":10,"limit":10}`.
- **`429 "no available capacity"`** means Reactor's shared GPU pool is full. It comes and goes, so retry with backoff (we wait 7 s between tries, up to 6 tries).
- Session-scoped tokens: a session can only be used with **the exact token that created it**. Cache the token in your own code (module scope) until shortly before it expires, and fetch it with `cache: "no-store"`.
- `max_sessions` on a token counts every session it ever created, not just open ones.
- `constraints.max_session_duration_seconds` is a **server-side kill switch**: we set it to 300 s, so a forgotten tab can't keep billing.
- Moderation screens prompts *and* images, and ends sessions that break the rules (which would stop a session mid-demo).

### Google (hackathon tier-3 key)

| Use | Model | Notes |
|---|---|---|
| Scene and portrait images | `gemini-3.1-flash-image` (Nano Banana 2) | `imageConfig: { aspectRatio: "16:9" \| "3:4" }`; all 6 generated in parallel in about 20 s. |
| Voice fallback | `gemini-3.8-live` (backup `gemini-3.1-flash-live-preview`) | Ephemeral tokens work (`v1alpha`). Best English voices, reliably keeps secrets. |

- List what your key can use: `GET https://generativelanguage.googleapis.com/v1beta/models` with the `x-goog-api-key` header. Don't guess model names.
- **Ephemeral Live tokens:** `ai.authTokens.create({ config: { uses: 1, liveConnectConstraints: { model, config } } })` on `apiVersion: "v1alpha"`. The browser then connects with `new GoogleGenAI({ apiKey: token.name })`, so the real key never leaves the server.
- Live audio: **mic in as 16 kHz PCM16** (we convert with an AudioWorklet), **speech out as 24 kHz PCM16** (we schedule each chunk right after the previous one so playback has no gaps). When `serverContent.interrupted` arrives, stop queued playback (that's how barge-in works).
- **Real-person likeness:** prompts like "slim man in a grey crewneck" produced near-copies of real CEOs, and "neural-network logo" produced a real company's logo. Fix: give each character distinctive *invented* features (curly hair + round glasses, silver goatee…), write "original faces that do not resemble any real person", and use our own banner text ("SUMMIT OF TITANS").

## 4. Bugs we hit and how we fixed them

### UI
| Symptom | Cause | Fix |
|---|---|---|
| Map shows "API KEY REQUIRED" | CARTO basemaps now need a key | Switched to **Esri ArcGIS** tiles (`World_Imagery` + `World_Boundaries_and_Places`): no key, attribution "Tiles © Esri" required |
| "Everything is static, no world" | `NEXT_PUBLIC_MOCK_WORLD=1` (on purpose, so building costs $0) | Set it to `0` **and restart the dev server**: `NEXT_PUBLIC_*` values are baked in when the server starts |
| Hydration error about `cz-shortcut-listen` on `<body>` | The ColorZilla browser extension adds that attribute | `suppressHydrationWarning` on `<body>`; demo from a Chrome profile without extensions |
| Talking face never appeared; fell back to voice only | The tab kept an **old cached Reactor token** that only allowed the world model (the in-page code reload keeps old module state) | Full page reload; the fallback now **shows its reason on screen** |
| Two paid sessions per round in dev | React Strict Mode runs effects twice | `reactStrictMode: false` in `next.config.ts` |
| Keys typed into the year box moved the camera | Global keyboard listener | Ignore key events whose target is inside `input` / `textarea` / `select` |
| Leaflet grey or wrongly sized after the panel resized | Leaflet measures its container once | `ResizeObserver` → `map.invalidateSize()`; load the map via `next/dynamic` with `ssr: false` |

### Backend and platform
| Symptom | Cause | Fix |
|---|---|---|
| `429 no available capacity` | Shared GPU pool full | Retry with backoff, plus a clear "at capacity" message |
| `429 quota_exceeded 10/10` | Too many session creates per minute (test scripts + browser) | Slower retries (7 s); remember each round uses 2 sessions |
| Vidu `AVATAR_TIMEOUT` on create | Upstream slowness | Retry (it's marked retryable); create avatars ahead of time |
| Avatar said "this is Rome" | Its LLM was given the answer and leaked it | Don't give it the answer, forbidden-words list, shorter replies |
| `tsc` errors for `.ts` imports in `scripts/` | Node runs TS directly, but Next's tsconfig rejects `.ts` import paths | Exclude `scripts` from `tsconfig.json`; run with `node --env-file=.env.local scripts/x.ts` |
| `tsc` TS6053 missing `.next/types/*` | Leftover generated types from the dev server | Harmless; ignore, or delete `.next` |
| GitHub "repository moved" warning | Repo renamed to `Jalil-g/History-guessr` | `git remote set-url origin https://github.com/Jalil-g/History-guessr.git` |

## 5. What worked vs. what didn't

**Worked**
- Generating images and avatars **ahead of time**: no waiting on stage, consistent look.
- Starting from `npx create-reactor-app --model=lingbot-world-2` to get the auth pattern right, then replacing its 3400-line demo controller with a small game-specific one.
- One server-minted Reactor token covering both models, plus a server-side session time limit.
- Keeping **all model names and budget settings in `lib/config.ts`**.
- Test scripts run from the command line with the Python SDK (`uv run --with reactor-sdk python -I …`) to check models, capacity and commands **without a browser**, costing a few cents each.
- Falling back from Vidu to Gemini Live voice, so a round always has a local.

**Didn't work / avoid**
- LingBot v1 and Helios: no capacity when we needed them.
- CARTO map tiles without a key.
- Putting the secret answer in the Vidu persona.
- Vague prompts for "fictional" characters: they drift toward real people.
- Trusting the browser's HTTP cache for Reactor tokens.

## 6. Cost notes

- Budget: $175 of Reactor credit. Gemini runs on the hackathon tier-3 project.
- Playing costs about **$0.84/min** (world + avatar), roughly $1.30–2 per round.
- Cost guards: 90 s world session, 40 s idle disconnect, disconnect when the tab is hidden, 150 s avatar cap, **300 s server-side session limit**, mock mode for building the UI.

## 7. Security and hackathon rules

- API keys live only in `.env.local` (git-ignored) and in Cloud Run environment variables. The browser only ever receives **short-lived tokens limited to specific models**.
- Before each push, scan for keys: `git grep --cached -nE 'rk_[0-9a-f]{20}|AQ\.[A-Za-z0-9_-]{20}|AIza[0-9A-Za-z_-]{20}'`.
- The hackathon account is **deleted the day after**, so everything we want to keep must be in GitHub.
- Real people: the finale uses **fictional parody characters** (no real photos, names or voice clones) and is labelled as parody.

## 8. Open items

- Listen to the Vidu English voices (Aiden / Jennifer / Mione) and decide whether some locals should use Gemini voices instead.
- Deploy to Cloud Run (needs `gcloud auth login` with the hackathon account).
- Record a backup demo video in case Reactor has no capacity on stage.
