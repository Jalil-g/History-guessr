"use client";
/**
 * VoiceChat — PLACEHOLDER. The voice agent replaces this with Gemini Live voice chat.
 *
 * Contract (keep these props stable — the game loop depends on them):
 *  - `scene`  the scene whose `local` persona the player talks to (server looks it up by scene.id)
 * Renders as a side panel; must stop the mic and close the session when unmounted.
 */
import type { Scene } from "@/lib/scene";

export type VoiceChatProps = { scene: Scene };

/** Shows who the local is; voice not wired yet. @param props see VoiceChatProps */
export function VoiceChat({ scene }: VoiceChatProps) {
  return (
    <div className="rounded-lg border border-amber-200/20 p-4 text-sm text-amber-100/80">
      A local is nearby: <b>{scene.local.name}</b>. (Voice chat coming soon.)
    </div>
  );
}
