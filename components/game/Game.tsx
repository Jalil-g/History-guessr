"use client";
/**
 * Game — PLACEHOLDER top-level component. The game-loop agent replaces this with the full state
 * machine: intro (choose rounds) → round (WorldView + VoiceChat + guess) → reveal (score + book
 * citation) → … → summary.
 *
 * It composes the other features only through their stable props:
 *  - <WorldView scene onEnded />   components/world/WorldView.tsx
 *  - <VoiceChat scene />           components/voice/VoiceChat.tsx
 * For now it just shows the first scene so the scaffold renders end to end.
 */
import { WorldView } from "@/components/world/WorldView";
import { VoiceChat } from "@/components/voice/VoiceChat";
import { SCENES } from "@/lib/scenes";

/** Renders the first scene with the world and voice placeholders. */
export function Game() {
  const scene = SCENES[0];
  return (
    <main className="flex h-screen gap-3 p-3">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg">
        <WorldView scene={scene} />
      </div>
      <aside className="w-80">
        <VoiceChat scene={scene} />
      </aside>
    </main>
  );
}
