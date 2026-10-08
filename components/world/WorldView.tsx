"use client";
/**
 * WorldView — PLACEHOLDER. The world agent replaces this with the Reactor LingBot World 2 live world.
 *
 * Contract (keep these props stable — the game loop depends on them):
 *  - `scene`   the scene to render (first frame = sceneImageUrl(scene.id), prompts = scene.worldPrompt)
 *  - `onEnded` called once if the session ends on its own (time cap, idle, error) with a short reason
 * Fills its parent (absolute inset-0 friendly). In mock mode / this placeholder it shows the still image.
 */
import { sceneImageUrl } from "@/lib/config";
import type { Scene } from "@/lib/scene";

export type WorldViewProps = { scene: Scene; onEnded?: (reason: string) => void };

/** Shows the scene's still first frame. @param props see WorldViewProps */
export function WorldView({ scene }: WorldViewProps) {
  return (
    <div
      className="h-full w-full bg-gradient-to-br from-amber-900 to-stone-950 bg-cover bg-center"
      style={{ backgroundImage: `url(${sceneImageUrl(scene.id)})` }}
    />
  );
}
