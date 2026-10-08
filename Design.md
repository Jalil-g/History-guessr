# History Guesser — Design

Living feature document. **Every PR that adds or changes a feature updates this file.**
Status tags: ✅ done · 🚧 in progress · 📋 planned.

## Shared logger ✅
`lib/log.ts` — `log.info/warn/error` for function calls and `logGenAI(name, request, response)` for
model calls; strips inline base64 data and redacts secret-looking keys.

## Source book ✅
`data/short-history-of-the-world.txt` — H.G. Wells, *A Short History of the World* (1922), Project
Gutenberg #35461, public domain. 67 chapters from prehistory to 1920.

## App scaffold ✅
Next.js 15 + React 19 + TypeScript + Tailwind 4. `lib/config.ts` holds every model name and knob;
`lib/scene.ts` is the scene contract; `lib/scenes.ts` loads `data/scenes.json` (2 sample scenes until
extraction runs). `components/world/WorldView.tsx`, `components/voice/VoiceChat.tsx` and
`components/game/Game.tsx` are placeholders with fixed props that the feature PRs replace.

## Book-grounded scene extraction ✅
`scripts/extract-scenes.ts` sends the whole book to Gemini (`MODELS.sceneText` =
`gemini-3.1-pro-preview`, with `MODELS.sceneTextFallbacks` as backups) along with a curated list of 20
moments, and gets back structured JSON (`responseSchema` = the `Scene` type) in parallel batches of
`EXTRACT.batchSize`.
- **Framing**: the player is an ordinary, anonymous passer-by. Each scene shows daily life at street
  level with ONE world-famous landmark straight ahead, often brand-new or still being built (Great
  Pyramid, Ishtar Gate, Parthenon, Pharos, Great Wall, Colosseum, Hagia Sophia, Córdoba mosque, Angkor
  Wat, Forbidden City, Florence dome, Templo Mayor, Machu Picchu, St Basil's, Taj Mahal, Nihonbashi,
  Independence Hall, Bastille 1789, Suez Canal, Eiffel Tower). The scenes span different eras and
  continents.
- Each scene has an answer (place, lat, lng, year; Wells' dates are corrected to modern scholarship),
  a **content-only** `imagePrompt` (no style boilerplate, because the image script appends a shared
  style), a world prompt (≤ 600 chars, "EXACTLY ONE <landmark>"), and a `source { chapter, quote }`.
- `local` is an ordinary worker or vendor. It has `name` ("<first name>, a <role>"), `role`, `gender`,
  `appearance` (a half-body portrait description for the talking avatar), `voice` and `persona`.
- **Quote verification in code**: every quote must be a verbatim substring of the book, compared
  after normalising whitespace, curly quotes, dashes and `_italics_`. The stored quote is the exact
  book text, and the chapter heading is recomputed from where the quote actually sits. If Wells does
  not mention the landmark, the quote is his passage on that civilisation or era. A failed quote is
  re-requested `EXTRACT.quoteRepairAttempts` times, and the run aborts if it still fails.
- **Leak lint**: the script warns if an image or world prompt contains a place word or the year, or
  breaks the world prompt format.
- Re-run a subset with `node --env-file=.env.local scripts/extract-scenes.ts <id> <id>`. Check without
  API calls with `node scripts/extract-scenes.ts --verify`.
Output: `data/scenes.json` (20 scenes; `giza-pyramids` is the hand-written seed and style example).

## Scene images ✅
`scripts/generate-images.ts` — Gemini image model (`MODELS.sceneImage`, auto-fallback to
`MODELS.sceneImageFallback`) paints each scene's first frame (16:9, first-person, photorealistic, no
text) to `public/scenes/<id>.png`. Style lock: `imagePrompt` is content-only; the script strips any
trailing style sentence and always appends the shared `IMAGE_STYLE` (eye-level first person, 35mm, warm
late-afternoon light, one film grade, no text or signs with writing) so the whole set is consistent. The API returns JPEG, so output is converted
to real PNG with macOS `sips`. Skips existing files unless `--force`; positional args pick scene ids;
`--scenes <path>` reads another scenes file; `IMAGES.concurrency` in parallel; 429/5xx retried
`IMAGES.retries` times with exponential backoff; exits non-zero if any scene fails. Images are reviewed
by eye and regenerated with `--force <id>` if any text appears.

## Walkable world (Reactor) ✅
Reactor LingBot World 2 session started from the scene image + world prompt, WASD-driven, with a
server-minted token, session time cap and idle disconnect. Mock mode shows the still image.

- **Token**: `GET /api/reactor/token` (`lib/reactor-token.ts`) exchanges `REACTOR_API_KEY` for a JWT
  scoped to `MODELS.reactorWorld`, `REACTOR.maxSessionsPerToken` sessions, `REACTOR.tokenLifetimeSeconds`.
  The browser memoizes it (`components/world/fetchReactorToken.ts`); the key never leaves the server.
- **Session** (`components/world/useWorldSession.ts`): provider keyed by scene id → connect (retry
  `REACTOR.connectRetries`× on 429/no capacity) → upload `/scenes/<id>.png` → `setImage` →
  `setPrompt(base + idle)` → `start`. Image/prompt/start calls logged with `logGenAI`.
- **Controls** (`useWasdControls.ts`): WASD walk, arrows look; prompt swaps to `base + moving` while
  walking and back to `base + idle` when stopped.
- **Cost guards**: hard cap `REACTOR.exploreSeconds`, idle disconnect `REACTOR.idleDisconnectSeconds`,
  disconnect on hidden tab and unmount. On end/error → `onEnded(reason)` once + still image.
- **HUD** (`WorldHud.tsx`): status pill (connecting / waiting for GPU / retrying / LIVE · Ns / closed),
  key hints. **Mock** (`NEXT_PUBLIC_MOCK_WORLD=1`): Ken Burns still (`StillWorld.tsx`), no Reactor.
- **Missing image**: gradient fallback, no paid session, `onEnded("no scene image")`.

## Voice chat with a local (Gemini Live) ✅
Side panel (`components/voice/VoiceChat.tsx`, props `{ scene }`) with the local's name, a big **Talk**
toggle, connection status / speaking indicator / time left, and a live transcript of both sides.
- `lib/persona.ts` builds the system instruction: scene persona + secret answer + rules (stay in
  character, 1–3 short sentences, never name city/country/empire/ruler/event/year/century, vivid period
  clues that get more specific when the player is stuck, puzzled by modern words, greets first by
  remarking on the player's strange clothes).
- `POST /api/live-token { sceneId, fallback? }` (`lib/live-token.ts`) looks the scene up server-side
  and mints a single-use ephemeral token with model, persona, voice (`scene.local.voice`), AUDIO
  response and input/output transcription locked in → `{ token, model }`. Primary
  `MODELS.geminiLive`, falls back to `MODELS.geminiLiveFallback` if minting or connecting fails.
- `components/voice/useLiveSession.ts` fetches the token, connects from the browser, streams mic audio
  (`lib/audio/mic-capture.ts`, 16 kHz PCM16 via AudioWorklet), plays replies
  (`lib/audio/pcm-player.ts`, 24 kHz gapless queue, dropped on barge-in) and closes everything on stop,
  unmount, new scene or after `VOICE.sessionSeconds`. Mic-denied and connection errors show a readable
  message. All knobs in `VOICE` (`lib/config.ts`).
- Smoke test: `node --env-file=.env.local scripts/test-live.ts [sceneId] [--fallback]` opens a real
  session, begs for the answer and fails if the place/year leaks.
- **Now the fallback**: the primary local is the talking avatar below. `<LocalAvatar>` renders
  `<VoiceChat scene />` under the still portrait in mock mode, when `AVATAR.enabled` is false, or when
  the avatar can't start.

## Talking avatar (Reactor vidu-s2-avatar) ✅
The local becomes a live, lip-synced video character (`components/avatar/LocalAvatar.tsx`, props
`{ scene }`, drop-in for `<VoiceChat scene />` in the local panel): a ~300–340 px glass card, ≤ 60vh,
video on top, status / **Talk to <name>** / **End conversation** / mic status / live transcript below.
- **Portraits** (offline): `node --env-file=.env.local scripts/generate-portraits.ts [ids] [--force]
  [--scenes <path>]` paints `public/locals/<id>.png` (3:4, half body, facing camera, period clothing
  from `local.appearance`, else derived from name + persona, shared `PORTRAIT_STYLE`, no text) with
  `MODELS.sceneImage`. Skip existing, `PORTRAITS.concurrency`, retries on 429/5xx; 402 is not retried.
- **Token**: `GET /api/reactor/token?model=reactor/vidu-s2-avatar` — the route takes an optional
  `model` validated against `REACTOR_TOKEN_MODELS` (default stays the world model, so WorldView is
  unchanged). `components/avatar/fetchAvatarToken.ts` memoizes the avatar JWT.
- **Session** (`useAvatarSession.ts`): portrait HEAD check (missing → fallback, no paid session) →
  token → `connect` → wait "ready" → `attachAvatar` with the scene's cached `avatar_id` (localStorage,
  90-day reuse; `AVATAR_NOT_FOUND` → recreate) or `uploadFile(portrait)` + `createAvatar` →
  `avatar_ready` → Talk: mic → `publishMic` → `listVoices` → gender-matched voice
  (`avatarHelpers.ts`, `local.gender`, else inferred from the Gemini voice name / persona) →
  `startCall({ persona: buildLocalInstruction(scene), greeting, voice, language, call_mode: "audio",
  transcripts: true, llm })`. Video on `main_video`, audio on `main_audio`, `transcript` messages.
- **Cost guards** (`AVATAR` in `lib/config.ts`): call cap `callMaxSeconds` (or server cap if lower),
  call idle end `idleEndSeconds`, session disconnect if no call `readyIdleSeconds` after ready, tab
  hidden → end + disconnect ("Wake <name>" reconnects), unmount (round end) → end + disconnect.
- **Errors**: mic denied / no mic, NO_AVATAR, BUSY, AVATAR_FAILED / TIMEOUT, capacity → readable text.
  Setup failures switch to the fallback: still portrait (`AvatarPortrait.tsx`: portrait → scene image
  crop → silhouette) + Gemini Live `<VoiceChat>`.

## Guess, scoring and reveal ✅
- `components/guess/GuessMap.tsx` — react-leaflet world map on keyless Esri World Street Map tiles
  (URL/attribution/colours in `lib/config.ts` `MAP`). Click to drop/move a pin (CircleMarkers, so no
  broken default icon; longitudes wrapped to ±180). Reveal mode (`answer` prop) shows guess + answer
  with a dashed line and fits both in view. Always imported via `components/guess/LazyGuessMap.tsx`
  (next/dynamic, `ssr: false`).
- `components/guess/YearSlider.tsx` — range `GAME.minYear..GAME.maxYear`, BC/AD readout, ±1/10/100
  fine-adjust buttons.
- `lib/scoring.ts` — haversine distance; location points = round(5000·e^(−km/`GAME.locationDecayKm`=2000)),
  year points = round(5000·e^(−|Δy|/`GAME.yearDecayYears`=100)); `formatYear` ("2560 BC", "AD 410"),
  `formatKm`, `formatPoints`.
- `components/game/RevealScreen.tsx` — map with guess vs answer, distance and year error, points per
  axis with bars, title + place + year + reveal text (first time they appear), and the citation
  "From H.G. Wells, *A Short History of the World* — <chapter>: “<quote>”".

## Game loop ✅
`components/game/Game.tsx` is a state machine: intro → playing(i) → reveal(i) → … → summary → intro.
- `IntroScreen.tsx` — title, three how-to-play steps, round picker (`GAME.roundOptions`), Begin.
  Scenes are picked on Begin (`pickScenes`), never during render.
- `RoundScreen.tsx` — `TopBar` (round i/N, running score; nothing scene-specific), `<WorldView scene
  onEnded />` fills the main area, side panel with `<VoiceChat scene />` and the guess panel (map +
  year slider + Submit, disabled until a pin is dropped). Keyed by scene id and only mounted during
  "playing", so Reactor / Gemini Live sessions close on submit. If the world ends on its own a
  "vision fades" banner nudges the player to guess.
- `SummaryScreen.tsx` — per-round table (scene, place, year, distance, year error, points) + total
  out of rounds × 10 000 + Play again.
- Style: dark parchment & brass (bg `#0b0906`, amber accents), Cinzel display / Cormorant Garamond
  serif via next/font (`font-display`, `font-serif` in `app/globals.css`).
