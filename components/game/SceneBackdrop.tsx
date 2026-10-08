"use client";
/**
 * SceneBackdrop — a full-bleed, darkened (optionally blurred) scene image behind the intro, reveal
 * and summary screens.
 *
 * How it fits the architecture: the round screen shows the live world full-bleed; to keep the same
 * cinematic feel everywhere else, IntroScreen (hero), RevealScreen (the scene just played, dimmed) and
 * SummaryScreen render this behind their content. It shows /scenes/<id>.png (sceneImageUrl from
 * lib/config.ts) with a slow drift, and falls back to a warm sepia gradient when the image is missing
 * (images are generated offline and may not exist yet during development). It is a plain image —
 * never a paid Reactor session.
 */
import { useState } from "react";
import { sceneImageUrl } from "@/lib/config";
import { log } from "@/lib/log";

export type SceneBackdropProps = {
  /** Scene id whose first frame to show (omit for the gradient only). */
  sceneId?: string;
  /** Blur the image (intro / summary). */
  blur?: boolean;
  /** Darkness of the overlay, 0..1. */
  dim?: number;
};

/**
 * Renders the backdrop (absolute inset-0; the parent must be relative).
 * @param props see SceneBackdropProps
 */
export function SceneBackdrop({ sceneId, blur = false, dim = 0.6 }: SceneBackdropProps) {
  log.info("SceneBackdrop", { sceneId, blur, dim });
  const [failed, setFailed] = useState(false);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#4a3420_0%,#1b130c_55%,#0b0906_100%)]">
      <style>{`@keyframes hg-drift{from{transform:scale(1.08)}to{transform:scale(1.16) translate(-1.5%,-1%)}}`}</style>
      {sceneId && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sceneImageUrl(sceneId)}
          alt=""
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${blur ? "blur-md" : ""}`}
          style={{ animation: "hg-drift 30s ease-in-out infinite alternate" }}
        />
      )}
      <div className="absolute inset-0" style={{ background: `rgba(5,4,3,${dim})` }} />
      <div className="hg-vignette absolute inset-0" />
    </div>
  );
}
