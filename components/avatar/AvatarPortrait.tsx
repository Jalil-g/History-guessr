"use client";
/**
 * AvatarPortrait — the still picture of the local, with graceful fallbacks when the portrait is missing.
 *
 * Feature: "Talking avatar (Reactor vidu-s2-avatar)". Used by <LocalAvatar> in three situations:
 *  - while the live avatar session is connecting / preparing (placeholder under a spinner),
 *  - in mock mode, AVATAR.enabled = false, or after the avatar failed (voice-only fallback),
 *  - after a cost-guard close.
 * Image chain: public/locals/<id>.png (scripts/generate-portraits.ts) → if it fails to load, a crop of
 * the scene's first frame (public/scenes/<id>.png) → if that fails too, a neutral silhouette. So a
 * scene whose portrait hasn't been generated yet still looks intentional.
 */
import { useState } from "react";
import { localPortraitUrl, sceneImageUrl } from "@/lib/config";
import { log } from "@/lib/log";

export type AvatarPortraitProps = { sceneId: string; alt: string; dim?: boolean };

/**
 * Still portrait with portrait → scene crop → silhouette fallback.
 * @param props sceneId, alt text, and `dim` to darken it under an overlay
 */
export function AvatarPortrait({ sceneId, alt, dim }: AvatarPortraitProps) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  /** Advances to the next fallback image when one fails to load. */
  const onError = () => {
    log.warn("AvatarPortrait.onError", { sceneId, stage });
    setStage((s) => (s < 2 ? ((s + 1) as 0 | 1 | 2) : s));
  };

  if (stage === 2) {
    return (
      <div className="flex h-full w-full items-end justify-center bg-gradient-to-b from-stone-800 to-stone-950" aria-label={alt}>
        <svg viewBox="0 0 100 100" className="h-4/5 w-4/5 text-amber-100/15" fill="currentColor" aria-hidden>
          <circle cx="50" cy="32" r="18" />
          <path d="M14 100c0-22 16-38 36-38s36 16 36 38z" />
        </svg>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      key={stage}
      src={stage === 0 ? localPortraitUrl(sceneId) : sceneImageUrl(sceneId)}
      alt={alt}
      onError={onError}
      className={`h-full w-full object-cover ${stage === 0 ? "object-top" : "object-center"} ${dim ? "opacity-50" : ""}`}
    />
  );
}
