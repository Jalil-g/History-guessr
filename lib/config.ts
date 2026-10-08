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
  sceneText: "gemini-3.1-pro-preview",
  /** Tried in order if MODELS.sceneText errors (e.g. unknown model id). */
  sceneTextFallbacks: ["gemini-2.5-pro"],
  /** Gemini image model (Nano Banana 2) used offline to paint each scene's first frame. */
  sceneImage: "gemini-3.1-flash-image",
  /** Fallback image model, tried automatically if `sceneImage` is rejected (unknown model id). */
  sceneImageFallback: "gemini-3.1-flash-image-preview",
  /** Gemini Live model for the voice conversation with a local. */
  geminiLive: "gemini-3.8-live",
  /** Fallback Live model if the primary one is overloaded. */
  geminiLiveFallback: "gemini-3.1-flash-live-preview",
  /** Reactor real-time world model the player walks around in. */
  reactorWorld: "reactor/lingbot-world-2",
  /** Reactor talking-avatar model the local is rendered with (right side panel). */
  reactorAvatar: "reactor/vidu-s2-avatar",
} as const;

/**
 * Reactor models a browser JWT minted by /api/reactor/token may be scoped to (`?model=` query param).
 * Anything else is rejected with 400, so a client cannot mint tokens for arbitrary paid models.
 */
export const REACTOR_TOKEN_MODELS: readonly string[] = [MODELS.reactorWorld, MODELS.reactorAvatar];

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

export const EXTRACT = {
  /** Scenes requested per Gemini call (smaller batches = more reliable structured output). */
  batchSize: 5,
  /** Extra attempts to repair a scene whose quote is not verbatim in the book. */
  quoteRepairAttempts: 2,
  /** Max characters for worldPrompt.base (LingBot World 2 prompt budget). */
  worldPromptMaxChars: 600,
  /** Sampling temperature for scene extraction. */
  temperature: 0.4,
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

export const IMAGES = {
  /** Aspect ratio requested from the image model (matches the Reactor world frame). */
  aspectRatio: "16:9",
  /** How many scene images scripts/generate-images.ts paints in parallel. */
  concurrency: 4,
  /** Retries per image on 429 / 5xx responses (total attempts = retries + 1). */
  retries: 3,
  /** Base backoff in ms; doubles each retry (2s, 4s, 8s) plus jitter. */
  backoffMs: 2000,
  /**
   * Any trailing style sentence a scene's imagePrompt still carries is cut from the first match of
   * this pattern onward before IMAGE_STYLE is appended (keeps older prompts consistent).
   */
  styleStripPattern: /\s*(Photorealistic|Photo-realistic|Cinematic film still)\b[\s\S]*$/i,
} as const;

/**
 * ONE shared visual style for every scene's first frame. scripts/generate-images.ts always appends it
 * to scene.imagePrompt (which is content-only), so all scenes share camera, light and colour grade.
 * The no-text clause also blocks shop signs, which leaked the place/language in testing.
 */
export const IMAGE_STYLE =
  "Photorealistic cinematic film still, first-person view from human eye level as if the viewer is an ordinary bystander standing in an everyday street or site scene among ordinary people of the period, with the one famous landmark ahead clearly recognisable by its true silhouette and proportions, camera about 1.7 m above flat ground with the horizon at eye level, never an aerial, high or elevated vantage, 35mm lens, warm natural late-afternoon light, consistent subtle warm film color grade, high detail, wide 16:9 frame. No text, letters, signs with writing, captions, logos or watermarks anywhere; any signboards are blank.";

export const AVATAR = {
  /** Master switch for the live talking avatar; false → portrait still + Gemini Live voice chat. */
  enabled: true,
  /** Hard cap on one avatar call, in seconds — the main avatar cost guard. */
  callMaxSeconds: 120,
  /** End the call after this many seconds without any transcript activity from either side. */
  idleEndSeconds: 40,
  /** Give up on createAvatar / attachAvatar if `avatar_ready` has not arrived after this many ms. */
  prepareTimeoutMs: 60_000,
  /** Language the local speaks in. */
  language: "English",
  /** Reply generation settings passed to startCall (short spoken turns). */
  llm: { max_tokens: 90 },
  /** localStorage key prefix under which a scene's reusable avatar_id is cached (90-day lifetime). */
  cacheKeyPrefix: "hg.avatar.",
  /** Countdown tick, in ms. */
  tickMs: 500,
  /** Max transcript lines kept on screen. */
  maxTranscriptLines: 40,
  /** Greeting (≤ 200 chars) — a curious, in-character line about the player's strange clothes. */
  greeting: "Well now, stranger, where did you get such peculiar clothes? I have never seen the like around here!",
} as const;

export const PORTRAITS = {
  /** Aspect ratio of each local's portrait (portrait-orientation frame for the avatar card). */
  aspectRatio: "3:4",
  /** Portraits painted in parallel by scripts/generate-portraits.ts. */
  concurrency: 4,
  /** Retries per portrait on 429 / 5xx / empty responses (total attempts = retries + 1). */
  retries: 3,
  /** Base backoff in ms; doubles each retry, plus jitter. */
  backoffMs: 2000,
} as const;

/**
 * ONE shared style for every local's portrait (scripts/generate-portraits.ts appends it to the
 * per-scene description). Half-body, facing camera, single person: what vidu-s2-avatar animates best.
 */
export const PORTRAIT_STYLE =
  "Photorealistic half-body portrait of exactly one person, facing the camera and looking into the lens, framed from the waist up with head and shoulders fully visible and centred, mouth closed and relaxed, neutral friendly expression, period-accurate clothing and hair, soft natural window light, plain softly blurred period-appropriate background, 50mm lens, shallow depth of field, high detail, natural skin texture. No other people, no hands covering the face, no text, letters, captions, logos or watermarks.";

export const PATHS = {
  /** Source book (plain text). */
  book: "data/short-history-of-the-world.txt",
  /** The scene contract file. */
  scenes: "data/scenes.json",
  /** Where generated first frames are written (served from /scenes/<id>.png). */
  sceneImagesDir: "public/scenes",
  /** Where generated local portraits are written (served from /locals/<id>.png). */
  localPortraitsDir: "public/locals",
} as const;

/** Public URL of a scene local's portrait (talking-avatar source image). @param id scene id */
export function localPortraitUrl(id: string): string {
  return `/locals/${id}.png`;
}

/** Public URL of a scene's first frame. @param id scene id */
export function sceneImageUrl(id: string): string {
  return `/scenes/${id}.png`;
}

/**
 * Mock mode shows the scene's still image instead of opening a paid Reactor session.
 * Set NEXT_PUBLIC_MOCK_WORLD=1 in .env.local while building UI.
 */
export const MOCK_WORLD = process.env.NEXT_PUBLIC_MOCK_WORLD === "1";
