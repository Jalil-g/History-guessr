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

## Book-grounded scene extraction 📋
`scripts/extract-scenes.ts` — Gemini reads the book and returns ~20 vivid, guessable scenes spread
across eras and continents, each with answer (place, lat, lng, year), image prompt, world prompt,
local persona and `source { chapter, quote }` quoted verbatim. Output: `data/scenes.json`.

## Scene images 📋
`scripts/generate-images.ts` — Gemini image model paints each scene's first frame (16:9, first-person,
no text) to `public/scenes/<id>.png`.

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

## Voice chat with a local (Gemini Live) 📋
Server mints an ephemeral Gemini Live token with the persona locked in; the local gives period clues
but never names the place or year.

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
