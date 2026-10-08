/**
 * The Scene type — THE CONTRACT between the offline pipeline and the game.
 *
 * A scene is one playable historical moment. `scripts/extract-scenes.ts` produces an array of these
 * into data/scenes.json from the history book; every part of the game consumes them:
 *  - `answer`       hidden until the guess; used for scoring (lib/scoring.ts) and the reveal
 *  - `imagePrompt`  painted offline into public/scenes/<id>.png (scripts/generate-images.ts)
 *  - `worldPrompt`  LingBot World 2 prompt layers for the Reactor live world
 *  - `local`        an ordinary worker/vendor: name, role, gender, appearance (portrait for the
 *                   Reactor talking avatar), persona + voice for the Gemini Live voice chat
 *  - `source`       chapter + verbatim quote from the book, shown on the reveal
 *
 * Rules: nothing a player sees before guessing (imagePrompt rendering, worldPrompt, persona speech)
 * may name the place or the year. Changing this type is a hot-file change — coordinate first.
 */

export type Scene = {
  /** Stable kebab-case id, also the image filename, e.g. "giza-pyramids". */
  id: string;
  /** Short title shown only AFTER the guess, e.g. "Building the Great Pyramid". */
  title: string;
  answer: {
    /** Human-readable place, e.g. "Giza Plateau, Egypt". */
    place: string;
    lat: number;
    lng: number;
    /** Negative = BC. */
    year: number;
  };
  /** One or two sentences shown on the reveal, explaining the moment. */
  reveal: string;
  /** Prompt for the image model: first-person, photorealistic, 16:9, no text. */
  imagePrompt: string;
  /** LingBot World 2 prompt layers (each ≤ ~600 chars, never naming place/year). */
  worldPrompt: {
    /** What the world contains: setting, people, architecture, light. */
    base: string;
    /** Camera + motion while the player stands still. */
    idle: string;
    /** Camera + motion while the player walks. */
    moving: string;
  };
  /** The local the player talks to by voice. */
  local: {
    /** "<first name>, a <role>", e.g. "Neferu, a work-gang foreman". */
    name: string;
    /** Short everyday occupation fitting place/period, e.g. "stonemason", "spice merchant". */
    role: string;
    /** For voice selection. */
    gender: "male" | "female";
    /**
     * 1–2 sentences for a half-body portrait (talking avatar): age, face, period clothing/headwear,
     * tools of the trade. No text or insignia naming the place.
     */
    appearance: string;
    /** Gemini Live prebuilt voice name, e.g. "Charon", "Leda", "Puck", "Orus", "Kore". */
    voice: string;
    /** In-character system prompt: who they are, period details, what they know. */
    persona: string;
    /** Optional: short role, e.g. "work-gang foreman" (added by the extractor; may be absent). */
    role?: string;
    /** Optional: "male" | "female" — used to pick a matching avatar voice. */
    gender?: string;
    /** Optional: visual description (age, build, clothing) used to paint the local's portrait. */
    appearance?: string;
  };
  /** Grounding in the source book. */
  source: {
    chapter: string;
    /** Verbatim quote from the book. */
    quote: string;
  };
};
