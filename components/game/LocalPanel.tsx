"use client";
/**
 * LocalPanel — the floating "talk to a local" card on the right edge of the round HUD.
 *
 * How it fits the architecture: components/game/RoundScreen.tsx renders it over the full-bleed world,
 * vertically centred in the space above the submit card. Its job is PURELY LAYOUT + CHROME: a glass
 * card (UI.localPanelWidth wide, up to ~60vh tall) with a small header and a collapse button that
 * shrinks it to a "Talk to a local" pill. The content is the scene's conversation feature:
 *  - <LocalAvatar scene={scene} /> (components/avatar/LocalAvatar.tsx): the Reactor talking-video avatar,
 *    which itself falls back to <VoiceChat /> (Gemini Live) in mock mode or when the avatar can't start.
 *
 * Cost safety: collapsing and the H "hide UI" toggle only HIDE the content (CSS), they never unmount
 * it, so an open voice session isn't killed by accident. The whole panel unmounts with RoundScreen
 * when the guess is submitted, which closes the paid session.
 * Never shows the answer (the local's name is fine — it is part of the scene's persona).
 */
import { useState } from "react";
import { LocalAvatar } from "@/components/avatar/LocalAvatar";
import { UI } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";

export type LocalPanelProps = {
  scene: Scene;
};

/**
 * Renders the collapsible local card.
 * @param props see LocalPanelProps
 */
export function LocalPanel({ scene }: LocalPanelProps) {
  log.info("LocalPanel", { sceneId: scene.id });
  const [collapsed, setCollapsed] = useState(false);

  const content = <LocalAvatar scene={scene} />;

  return (
    <div className="flex flex-col items-end">
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="hg-glass hg-rise flex items-center gap-2.5 rounded-full px-4 py-2 transition hover:border-cream/45"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brass" />
          <span className="hg-label !text-cream">Talk to a local</span>
        </button>
      )}
      <section
        aria-label="Talk to a local"
        className={`hg-glass flex max-h-[60vh] flex-col shadow-[0_20px_60px_rgba(0,0,0,0.45)] ${collapsed ? "hidden" : "hg-rise"}`}
        style={{ width: UI.localPanelWidth }}
      >
        <header className="flex items-center justify-between border-b border-cream/10 px-4 py-2.5">
          <span className="hg-label">Talk to a local</span>
          <button
            type="button"
            aria-label="Collapse"
            title="Collapse"
            onClick={() => setCollapsed(true)}
            className="flex h-6 w-6 items-center justify-center text-cream/50 transition hover:bg-cream/10 hover:text-cream"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M5 12h14" />
            </svg>
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-3 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-1">{content}</div>
      </section>
    </div>
  );
}
