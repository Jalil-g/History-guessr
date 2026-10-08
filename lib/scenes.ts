/**
 * Scene catalogue — loads data/scenes.json (the contract, see lib/scene.ts) and exposes helpers
 * to pick scenes for a game.
 *
 * Use cases:
 *  - the game loop calls `pickScenes(n)` at the start of each game for a random set of rounds
 *  - server routes (voice token) call `getScene(id)` to look up a persona without trusting the client
 * The JSON is bundled at build time, so regenerating scenes means re-running the extract script and
 * rebuilding.
 */
import scenesJson from "@/data/scenes.json";
import type { Scene } from "./scene";
import { log } from "./log";

export const SCENES: Scene[] = scenesJson as Scene[];

/**
 * Returns `n` random distinct scenes (all of them if n ≥ catalogue size).
 * @param n number of rounds
 */
export function pickScenes(n: number): Scene[] {
  log.info("pickScenes", { n, available: SCENES.length });
  return [...SCENES].sort(() => Math.random() - 0.5).slice(0, n);
}

/**
 * Looks up one scene by id.
 * @param id scene id
 * @returns the scene, or undefined if unknown
 */
export function getScene(id: string): Scene | undefined {
  log.info("getScene", { id });
  return SCENES.find((s) => s.id === id);
}
