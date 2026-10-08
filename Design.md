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

## Walkable world (Reactor) 📋
Reactor LingBot World 2 session started from the scene image + world prompt, WASD-driven, with a
server-minted token, session time cap and idle disconnect. Mock mode shows the still image.

## Voice chat with a local (Gemini Live) 📋
Server mints an ephemeral Gemini Live token with the persona locked in; the local gives period clues
but never names the place or year.

## Guess, scoring and reveal 📋
Leaflet map pin + year slider; score up to 5000 for distance and 5000 for year. Reveal shows the
answer and the book chapter + quote.

## Game loop 📋
Intro (scene count) → N rounds → summary with total score.
