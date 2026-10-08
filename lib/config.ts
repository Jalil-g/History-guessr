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
 *  - the game loop reads GAME.* (rounds, year range)
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
} as const;

export const REACTOR = {
  /** Hard cap on one Reactor world session, in seconds — the main cost guard. */
  exploreSeconds: 90,
  /** Disconnect after this many seconds without any input. */
  idleDisconnectSeconds: 25,
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
