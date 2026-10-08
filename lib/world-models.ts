/**
 * World-model registry — which Reactor real-time WORLD models the player may pick to render the
 * walkable scene, with a label, a one-line description and what each model can be driven with.
 *
 * How it fits the architecture:
 *  - the intro screen (components/game/IntroScreen.tsx) lists WORLD_MODELS in its "World model" picker
 *    and remembers the choice in localStorage (WORLD.storageKey);
 *  - Game → RoundScreen → WorldView thread the chosen `modelId`; WorldView looks the entry up with
 *    getWorldModel() and picks the matching client adapter (components/world/adapters/*), which wraps
 *    that model's typed @reactor-models/* SDK behind one interface (connect → image → prompt → start,
 *    move, look, disconnect, chunk events);
 *  - the token route (lib/reactor-token.ts) only mints JWTs for model names listed in
 *    REACTOR_TOKEN_MODELS (lib/config.ts); every `reactorModel` here must be in that list;
 *  - the HUD hides the WASD / arrow key hints and the look indicator when a model lacks `move` / `look`.
 *
 * Pure data, no React — safe to import from server and client code. Model names come from
 * lib/config.ts MODELS (no model name is hard-coded here).
 *
 * Every model in the list starts from the scene's first frame (image), takes the scene's text prompt
 * and accepts real-time camera input — the research behind the selection is in Design.md
 * ("World models").
 */
import { MODELS, WORLD } from "@/lib/config";
import { log } from "@/lib/log";

/** Stable ids of the supported world models (also the adapter keys and the localStorage value). */
export type WorldModelId = "lingbot-world-2" | "lingbot" | "happy-oyster" | "orbis-stable";

/** One selectable world model. */
export type WorldModelInfo = {
  id: WorldModelId;
  /** Short display name (picker + HUD). */
  label: string;
  /** One-line description shown under the label in the picker. */
  description: string;
  /** Reactor model name the session connects to / the JWT is scoped to. */
  reactorModel: string;
  /** npm package of the typed SDK the adapter wraps. */
  npmPackage: string;
  /** What the player can do: walk (WASD) and/or look (arrows, with the look clamp). */
  capabilities: { move: boolean; look: boolean };
  /**
   * Shown in the picker? false = adapter exists but the model failed the live smoke test
   * (see Design.md "World models"); flip to true once it works.
   */
  inPicker: boolean;
};

/** Every world model with an adapter, in display order (the first is the fallback). */
const ALL_WORLD_MODELS: readonly WorldModelInfo[] = [
  {
    id: "lingbot-world-2",
    label: "LingBot World 2",
    description: "Steadiest walkable world — separate walk and strafe axes",
    reactorModel: MODELS.reactorWorld,
    npmPackage: "@reactor-models/lingbot-world-2",
    capabilities: { move: true, look: true },
    inPicker: true,
  },
  {
    id: "lingbot",
    label: "LingBot",
    description: "The original LingBot world — looser, more dreamlike walk",
    reactorModel: MODELS.reactorWorldLingbot,
    npmPackage: "@reactor-models/lingbot",
    capabilities: { move: true, look: true },
    inPicker: true,
  },
  {
    id: "happy-oyster",
    label: "HappyOyster",
    description: "Game-like first-person world — walk only, view stays on the landmark",
    reactorModel: MODELS.reactorWorldHappyOyster,
    npmPackage: "@reactor-models/happy-oyster",
    capabilities: { move: true, look: false },
    // Smoke test 2026-10-08: session auth OK but "429 no available servers" on every attempt.
    inPicker: false,
  },
  {
    id: "orbis-stable",
    label: "Orbis Stable",
    description: "Cinematic living scene with ambient sound — you stand still and watch",
    reactorModel: MODELS.reactorWorldOrbisStable,
    npmPackage: "@reactor-models/visko-orbis-stable",
    capabilities: { move: false, look: false },
    inPicker: true,
  },
];

/** World models offered in the picker (inPicker only). */
export const WORLD_MODELS: readonly WorldModelInfo[] = ALL_WORLD_MODELS.filter((m) => m.inPicker);

/**
 * Looks up a world model by id, falling back to WORLD.defaultModelId (then the first entry).
 * @param id requested id (e.g. from localStorage or a prop); unknown / undefined → default
 * @returns the registry entry
 */
export function getWorldModel(id?: string | null): WorldModelInfo {
  log.info("getWorldModel", { id });
  return (
    WORLD_MODELS.find((m) => m.id === id) ??
    WORLD_MODELS.find((m) => m.id === WORLD.defaultModelId) ??
    WORLD_MODELS[0]
  );
}
