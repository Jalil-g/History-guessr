/**
 * World-model adapter lookup — maps a WorldModelId (lib/world-models.ts) to the client adapter that
 * wraps its @reactor-models/* SDK (./types.ts WorldAdapter).
 *
 * How it fits the architecture: WorldView calls getWorldAdapter(info.id) once per mounted world and
 * hands the adapter to useWorldSession / useWasdControls. Adding a model = new adapter file + one
 * entry here + one entry in lib/world-models.ts + its model name in REACTOR_TOKEN_MODELS.
 */
import { log } from "@/lib/log";
import type { WorldModelId } from "@/lib/world-models";
import { lingbotWorld2Adapter } from "./lingbotWorld2";
import type { WorldAdapter } from "./types";

const ADAPTERS: Record<WorldModelId, WorldAdapter> = {
  "lingbot-world-2": lingbotWorld2Adapter,
};

/**
 * Returns the adapter for a world model.
 * @param id registry id
 * @returns the adapter (LingBot World 2 if unknown)
 */
export function getWorldAdapter(id: WorldModelId): WorldAdapter {
  log.info("getWorldAdapter", { id });
  return ADAPTERS[id] ?? lingbotWorld2Adapter;
}
