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
Reactor world-model session (player's choice, LingBot World 2 by default) started from the scene
image + world prompt, WASD-driven, with a server-minted token, session time cap and idle disconnect.
Mock mode shows the still image.

- **World-model choice** (`lib/world-models.ts`, `components/world/adapters/*`): a registry lists each
  model (id, label, one-line description, Reactor model name from `MODELS`, npm package, capabilities
  `{ move, look }`, `inPicker`). Each model's typed SDK is wrapped in one adapter implementing
  `WorldAdapter` (`adapters/types.ts`): `Provider`, `Video`, `useWorld()` → `connect` → `setImage(blob)`
  → `setPrompt` → `setRotationSpeedDeg` → `start`, `move(axis, value)`, `look(axis, value)`,
  `disconnect`, plus `useChunkComplete` (feeds the look clamp) and `useCommandError`.
  `useWorldSession` / `useWasdControls` are model-agnostic. Intro screen has a **World model** picker
  next to the rounds picker (remembered in localStorage `WORLD.storageKey`); Game → RoundScreen →
  WorldView pass `modelId?` (default `WORLD.defaultModelId`). The HUD shows the model name next to
  the status pill and hides WASD / arrow hints and the look indicator when the model lacks move / look.
  Tokens: `fetchReactorToken(model)` caches one JWT per model; every model name is in
  `REACTOR_TOKEN_MODELS`.
- **World models** — research (2026-10-08, `@reactor-models/*` READMEs). Kept only models that start
  from an image, take a prompt and accept real-time movement/look:

  | Model (package) | Image start | Prompt | Movement | Look | Notes |
  |---|---|---|---|---|---|
  | lingbot-world-2 1.0.1 | ✅ set_image | ✅ hot-swap | ✅ long + lat axes | ✅ yaw/pitch + speed | **In picker (default).** chunk_complete with action + frames |
  | lingbot 1.0.1 | ✅ set_image | ✅ hot-swap | ✅ single `set_movement` | ✅ yaw/pitch + speed | **In picker.** Smoke test OK (live video, W/←/D accepted). Emits 24 frames/chunk, so the look clamp hits ±100° after ~1 chunk of turning — tune `REACTOR.lookFramesPerChunk` if needed |
  | happy-oyster 1.0.1 (Adventure) | ✅ first frame ≤2 MB, 1.5–2.0 ratio | ✅ at createWorld only | ✅ held 8-way | ✅ held 8-way, no progress events | Adapter built (walk only, look off since the clamp can't track it; PNG >2 MB re-encoded to JPEG). **Hidden from picker**: smoke test got `429 no available servers` on every attempt. ~2 min travel cap |
  | visko-orbis-stable 2.3.0 | ✅ set_image | ✅ hot-swap | ❌ | ❌ | **In picker as "Orbis Stable"** — watch-only cinematic mode with ambient audio: fixed camera, HUD hides key hints + heading indicator, idle disconnect skipped (hard cap still applies). Runs stop at the deployment's `max_chunks` |
  | helios, visko-orbis-dynamic | ✅ | ✅ | ❌ | ❌ | image-to-video, no camera control |
  | longlive-v2, sana-streaming, ltx2 | ❌ | ✅ | ❌ | ❌ | text/webcam/avatar video |
  | x2 | ref image | ✅ | ❌ (pointer) | ❌ | pointer-steered |
  | fast-h3, h3-reference-to-video-turbo-realtime | clip queue | ✅ | ❌ | ❌ | clip generator ("move" = queue reorder) |
  | vidu-s2-avatar | portrait | — | ❌ | ❌ | talking avatar (used for the local) |

  No prices are documented in the packages.

- **Token**: `GET /api/reactor/token` (`lib/reactor-token.ts`) exchanges `REACTOR_API_KEY` for a JWT
  scoped to `MODELS.reactorWorld`, `REACTOR.maxSessionsPerToken` sessions, `REACTOR.tokenLifetimeSeconds`.
  The browser memoizes it (`components/world/fetchReactorToken.ts`); the key never leaves the server.
- **Session** (`components/world/useWorldSession.ts`): provider keyed by scene id → connect (retry
  `REACTOR.connectRetries`× on 429/no capacity) → upload `/scenes/<id>.png` → `setImage` →
  `setPrompt(base + idle)` → `start`. Image/prompt/start calls logged with `logGenAI`.
- **Controls** (`useWasdControls.ts`): WASD walk, arrows look; prompt swaps to `base + moving` while
  walking and back to `base + idle` when stopped.
- **Look limit** (`lib/look-limit.ts` + `useWasdControls.ts`): arrow-key look is clamped to
  ±`REACTOR.maxYawDeg` (100°) yaw and ±`REACTOR.maxPitchDeg` (40°) pitch around the starting view, so
  the world model never turns away from (and forgets) the landmark. Rotation is accumulated from each
  `chunk_complete` (`active_action` sign × `frames_emitted` × the rotation speed in effect for that
  chunk); before each chunk, committed + in-flight rotation is projected and the held direction is
  passed, slowed (`setRotationSpeedDeg`) to land exactly on the limit, or sent as `idle`. The opposite
  direction always works; WASD never rotates. Resets to 0 whenever a session goes live (incl.
  reconnects); `resetLook()` is also returned. `REACTOR.lookFramesPerChunk` overrides the per-chunk
  frame count if the SDK's "degrees per frame" turns out to mean latent steps.
- **Heading indicator** (`LookIndicator.tsx`): thin cream yaw bar (±60°, centre diamond = straight
  ahead) + tiny pitch bar, top-centre in live mode; end ticks turn brass at the limit.
- **Cost guards**: hard cap `REACTOR.exploreSeconds`, idle disconnect `REACTOR.idleDisconnectSeconds`,
  disconnect on hidden tab and unmount. On end/error → `onEnded(reason)` once + still image.
- **HUD** (`WorldHud.tsx`): status pill (connecting / waiting for GPU / retrying / LIVE · Ns / closed),
  key hints. **Mock** (`NEXT_PUBLIC_MOCK_WORLD=1`): Ken Burns still (`StillWorld.tsx`), no Reactor.
- **Missing image**: gradient fallback, no paid session, `onEnded("no scene image")`.
- **Reconnect** (`WorldView.tsx` `ReconnectableWorld`, button in `WorldHud.tsx`): after the session
  ends or errors (idle, time up, tab hidden, server drop, busy GPUs…) a centred **Reopen the portal**
  button (or **R**, ignored while typing) starts a fresh session for the same scene — the provider is
  re-keyed `<scene>#<attempt>`, so the old one disconnects and the new one runs connect → setImage →
  setPrompt → start with a fresh idle timer, time cap and look/WASD state. Never automatic; capped at
  `REACTOR.maxReconnectsPerRound` per round, then "The portal is spent — make your guess". Not in mock
  mode. `onEnded` fires at most once per session and stale sessions are ignored; the optional
  `onResumed` prop fires when a reconnect goes live (RoundScreen hides "The vision fades…").

## Voice chat with a local (Gemini Live) ✅
Side panel (`components/voice/VoiceChat.tsx`, props `{ scene }`) with the local's name, a big **Talk**
toggle, connection status / speaking indicator / time left, and a live transcript of both sides.
- `lib/persona.ts` builds the system instruction: scene persona + secret answer + rules (stay in
  character, 1–3 short sentences, never name city/country/empire/ruler/event/year/century, vivid period
  clues that get more specific when the player is stuck, puzzled by modern words). The local is a
  **guide**: it leads the conversation, points the player at things worth noticing, asks what they
  think and steers them to narrow down first the part of the world, then roughly when — never naming
  the answer. Friendly, never flirtatious (no remarks on looks). Greets first by offering to help the
  lost traveller get their bearings.
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
`{ scene }`, drop-in for `<VoiceChat scene />` in the local panel): a ~300–340 px glass card,
video on top, the player's own webcam under it (video call), status / **End conversation** / mic
status / live transcript below. The call **starts automatically** when the avatar is ready
(`AVATAR.autoStart`); **Talk to <name>** only appears to restart a call that ended.
- **Portraits** (offline): `node --env-file=.env.local scripts/generate-portraits.ts [ids] [--force]
  [--scenes <path>]` paints `public/locals/<id>.png` (3:4, half body, facing camera, period clothing
  from `local.appearance`, else derived from name + persona, shared `PORTRAIT_STYLE`, no text) with
  `MODELS.sceneImage`. Skip existing, `PORTRAITS.concurrency`, retries on 429/5xx; 402 is not retried.
- **Token**: `GET /api/reactor/token?model=reactor/vidu-s2-avatar` — the route takes an optional
  `model` validated against `REACTOR_TOKEN_MODELS` (default stays the world model, so WorldView is
  unchanged). `components/avatar/fetchAvatarToken.ts` memoizes the avatar JWT.
- **Prebuilt avatars** (`data/avatars.json`, loader `lib/avatars.ts`): creating an avatar from a
  portrait takes 5–60 s, attaching an existing one ~1 s after connect, and Reactor keeps avatars 90
  days. So every scene's avatar is created once offline and its id committed:
  `{ "<sceneId>": { avatarId, createdAt, portrait } }`. Entries older than
  `AVATAR.prebuiltMaxAgeDays` (85) are ignored. Regenerate with a dev server running:
  `node scripts/prewarm-avatars.ts [ids] [--force] [--attach] [--url http://localhost:3000]` — it
  drives the dev-only page `/dev/prewarm-avatars?ids=…[&mode=attach]` (404 outside development) in
  headless Chrome over the DevTools protocol; the page connects one session per scene
  (`AVATAR.prewarmConcurrency`, 429 quota retries — vidu-s2-avatar allows 10 sessions/min),
  uploads the portrait, `createAvatar`, waits for `avatar_ready`, disconnects (never `startCall`),
  and exposes `window.__prewarmResult`; the script merges new ids into `data/avatars.json` (skips
  existing unless `--force`). `--attach` only measures connect → `avatar_ready` via `attachAvatar`.
- **Session** (`useAvatarSession.ts`): at mount, mic + camera are requested (one prompt) **in parallel**
  with: portrait HEAD check (missing → fallback, no paid session) ‖ token → `connect` → wait "ready" →
  avatar source in order: prebuilt id (`attachAvatar`) → localStorage cached id (`attachAvatar`) →
  `uploadFile(portrait)` + `createAvatar`; `AVATAR_NOT_FOUND` / any attach error falls through to the
  next source, a freshly created id is cached in localStorage; `avatar.ready` logs the source and ms
  from connect / prepare → `avatar_ready` → **auto-start** (`AVATAR.autoStart`): `publishMic` +
  `publishWebcam` → `listVoices` (cached per page) → gender-matched voice (`avatarHelpers.ts`) →
  `startCall({ persona: buildLocalInstruction(scene) + AVATAR.seeingInstruction, greeting:
  AVATAR.videoGreeting, voice, language, call_mode: "video", transcripts: true, llm })`. Camera refused
  / missing → mic only, `call_mode: "audio"`, the old greeting. Video on `main_video`, audio on
  `main_audio`, `transcript` messages.
- **Video call** (`SelfView.tsx`): the player's webcam goes to the character (`call_mode: "video"`),
  which sees them. It may make at most one short, neutral remark about their foreign-looking clothes
  at the start (never face, body or attractiveness, no compliments), then spends the call guiding
  (`AVATAR.seeingInstruction`, `AVATAR.videoGreeting`; never mentions a camera). Under the
  character: mirrored self-view, "They can see you" once `session_state.camera_forwarding`, and a
  camera on/off toggle (track disabled, call continues). Settings: `AVATAR.camera` (640×480 @ 15 fps).
- **Speed**: prebuilt ids (attach, not create), HEAD ‖ token in parallel, permission prompt during
  connect, cached voice list, and auto-start (no "Talk" click).
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
- Year picking: see "UI (EraGuessr-style HUD)" below (`TimelineSlider` replaced `YearSlider`).
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

## UI (EraGuessr-style HUD) ✅
Cinematic, dark, minimal: thin 1px cream borders, glass panels (black/45 + blur), tiny wide-tracked
JetBrains Mono labels (`.hg-label`), Cinzel / Cormorant serif titles. Tokens + helpers in `app/globals.css`,
timings / sizes / hints in `lib/config.ts` `UI`, timeline scale in `TIMELINE`.
- **Round** (`RoundScreen.tsx`): `<WorldView>` full-bleed (wrapped in `.hg-world`, whose CSS moves the
  world HUD pill/key hints clear of our overlays) + top/bottom vignette. Overlays:
  - `TopBar.tsx` — logo box, "ROUND i OF N" + one progress segment per round, "SCORE · n";
    `HudToolbar.tsx` — hint (generic answer-free tips from `UI.hints`), hide-UI eye, mute world video, help.
  - `LocalPanel.tsx` — floating glass card on the right edge, collapsible to a "Talk to a local" pill;
    renders `<VoiceChat scene />` (swap point for `components/avatar/LocalAvatar.tsx`). Hide/collapse
    only hide it — the paid session stays mounted until the round ends.
  - `components/guess/MiniMap.tsx` — "1 PLACE" parchment mini-map (480×250), EXPAND to 70vw×70vh
    (same Leaflet instance), custom +/− zoom.
  - `components/guess/TimelineSlider.tsx` — "2 TIME" ruler: sepia track, minor/major/labelled ticks,
    cream thumb with hairline, year above the thumb; pointer drag, ←/→ (Shift = 25 yr) when focused.
    Non-linear scale in `lib/timeline.ts` (`posToYear`, `yearToPos`, `timelineTicks`, `formatEra`)
    from `TIMELINE.anchors`; range `GAME.minYear..maxYear` (−3000..2026).
  - `SubmitCard.tsx` — "3 LOCATION + YEAR NEEDED" → "READY · year" card that is the submit button
    ("DROP PIN →" / "GUESS →").
- **Map** (`GuessMap.tsx`): keyless Esri World Physical Map, sepia-filtered into parchment, plus Esri
  boundaries & places label overlay; SVG divIcon pins (cream = you, brass star = answer); reveal flies
  to fit both with a dotted line.
- **Keys** (`useGameKeys.ts`): Space/Enter guess (reveal: next; intro: begin; summary: play again),
  M expand map, H hide UI, Esc close. Never W A S D / arrows; ignored while typing or when a button
  has focus.
- **Reveal**: dimmed full-bleed scene (`SceneBackdrop.tsx`), large map with "n km away", title, place ·
  year, reveal text, place/year points counting up (`CountUp.tsx`) with bars, round total, Wells quote
  in an italic serif card with chapter.
- **Intro**: blurred hero of the first scene image, big serif title, three steps, round picker, Begin.
  **Summary**: counting total, per-round rows with bars, Play again. Phases fade in (`.hg-fade`, `UI.fadeMs`).

