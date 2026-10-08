/**
 * Central configuration — every model name, budget knob, timing value and path lives here.
 *
 * Why: the project guidelines require all configurable items in one file, so swapping a model,
 * tightening the Reactor budget or changing the number of rounds is a one-line change and nobody
 * hard-codes a model name in a component or script.
 *
 * Use cases:
 *  - scripts/extract-scenes.ts reads MODELS.sceneText and PATHS.book / PATHS.scenes
 *  - scripts/generate-images.ts reads MODELS.sceneImage and PATHS.sceneImagesDir
 *  - the world component reads MODELS.reactorWorld and REACTOR.* cost guards
 *  - the voice route reads MODELS.geminiLive (+ fallback)
 *  - the game loop reads GAME.* (rounds, year range, scoring decay constants)
 *  - the guess / reveal maps read MAP.* (keyless Esri tiles, zoom, marker colours)
 * Safe to import from both server and client code (no secrets here).
 */

export const MODELS = {
  /** Gemini text model used offline to extract scenes from the history book. */
  sceneText: "gemini-3.1-pro",
  /** Gemini image model (Nano Banana 2) used offline to paint each scene's first frame. */
  sceneImage: "gemini-3.1-flash-image",
  /** Gemini Live model for the voice conversation with a local. */
  geminiLive: "gemini-3.8-live",
  /** Fallback Live model if the primary one is overloaded. */
  geminiLiveFallback: "gemini-3.1-flash-live-preview",
  /** Reactor real-time world model the player walks around in. */
  reactorWorld: "reactor/lingbot-world-2",
} as const;

export const GAME = {
  /** Total scenes the extractor should produce. */
  sceneCount: 20,
  /** Default rounds per game (player can change it on the intro screen). */
  defaultRounds: 5,
  /** Options offered on the intro screen. */
  roundOptions: [3, 5, 10],
  /** Year slider range. */
  minYear: -3000,
  maxYear: 2000,
  /** Max points per axis (location, year) per round. */
  maxPointsPerAxis: 5000,
  /** Location score decay: points = max * exp(-km / locationDecayKm). 2000 km ≈ 37% of max. */
  locationDecayKm: 2000,
  /** Year score decay: points = max * exp(-|Δyears| / yearDecayYears). 100 years ≈ 37% of max. */
  yearDecayYears: 100,
  /** Year the slider starts at for every round (deliberately neutral). */
  defaultGuessYear: 0,
} as const;

export const MAP = {
  /** Keyless Esri World Street Map tiles (no API key required). */
  tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  /** Attribution required by Esri. */
  attribution: "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012",
  /** Initial map view for the guess map. */
  initialCenter: [25, 10] as [number, number],
  initialZoom: 1,
  minZoom: 1,
  maxZoom: 16,
  /** Padding (px) when the reveal map fits guess + answer into view. */
  revealPadding: 40,
  /** Marker / line colours. */
  guessColor: "#f59e0b",
  answerColor: "#22c55e",
  lineColor: "#fde68a",
} as const;

export const REACTOR = {
  /** Hard cap on one Reactor world session, in seconds — the main cost guard. */
  exploreSeconds: 90,
  /** Disconnect after this many seconds without any input. */
  idleDisconnectSeconds: 25,
  /** Extra connect attempts when Reactor answers 429 / "no capacity". */
  connectRetries: 2,
  /** Delay between connect retries, in ms. */
  connectRetryDelayMs: 3000,
  /** Reactor API base URL (overridable with NEXT_PUBLIC_REACTOR_API_URL). */
  apiUrl: process.env.NEXT_PUBLIC_REACTOR_API_URL || "https://api.reactor.inc",
  /** Lifetime of a minted browser JWT, in seconds (server caps at 6 h). */
  tokenLifetimeSeconds: 60 * 60,
  /** How many sessions one minted JWT may create (closed ones count too). */
  maxSessionsPerToken: 20,
  /** Re-mint the browser JWT this many ms before it expires. */
  tokenRefreshSkewMs: 60_000,
  /** Arrow-key look speed, degrees per step. */
  rotationSpeedDeg: 4,
  /** Countdown / idle-check tick, in ms. */
  tickMs: 500,
  /** Ken Burns pan/zoom cycle of the still image (mock mode / fallback), in seconds. */
  kenBurnsSeconds: 40,
} as const;

export const VOICE = {
  /** Hard cap on one voice conversation, in seconds (session auto-closes after this). */
  sessionSeconds: 180,
  /** How long a minted ephemeral token stays valid for messages, in minutes. */
  tokenExpireMinutes: 15,
  /** How long the token can be used to OPEN a new session, in minutes (single use). */
  tokenNewSessionMinutes: 2,
  /** Gemini Live API version for ephemeral tokens. */
  apiVersion: "v1alpha",
  /** Mic capture sample rate expected by Gemini Live (PCM16 mono). */
  inputSampleRate: 16000,
  /** Sample rate of the audio Gemini Live sends back (PCM16 mono). */
  outputSampleRate: 24000,
  /** Samples per mic chunk sent upstream (1600 @ 16 kHz = 100 ms). */
  micChunkSamples: 1600,
  /** First message sent so the local greets the player. */
  greetingCue: "(A strangely dressed time traveller suddenly appears right next to you.)",
} as const;

export const PATHS = {
  /** Source book (plain text). */
  book: "data/short-history-of-the-world.txt",
  /** The scene contract file. */
  scenes: "data/scenes.json",
  /** Where generated first frames are written (served from /scenes/<id>.png). */
  sceneImagesDir: "public/scenes",
} as const;

/** Public URL of a scene's first frame. @param id scene id */
export function sceneImageUrl(id: string): string {
  return `/scenes/${id}.png`;
}

/**
 * Mock mode shows the scene's still image instead of opening a paid Reactor session.
 * Set NEXT_PUBLIC_MOCK_WORLD=1 in .env.local while building UI.
 */
export const MOCK_WORLD = process.env.NEXT_PUBLIC_MOCK_WORLD === "1";
