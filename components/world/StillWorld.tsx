"use client";
/**
 * StillWorld — the scene's first frame as a slowly panning/zooming still ("Ken Burns" effect).
 *
 * Used in three places of the walkable-world feature:
 *  - MOCK_WORLD mode (NEXT_PUBLIC_MOCK_WORLD=1): the whole world view, no Reactor contact at all;
 *  - the poster behind the live video while the Reactor session connects / stages;
 *  - the fallback after the live session ends (time cap, idle, hidden tab) or errors.
 * If the image is missing (404 during development) it renders a warm gradient instead.
 * Fills its parent (absolute inset-0). Never renders any text that could leak the answer.
 */
import { useEffect } from "react";
import { REACTOR } from "@/lib/config";
import { log } from "@/lib/log";
import type { SceneImageStatus } from "./useSceneImage";

type Props = {
  /** Image URL (sceneImageUrl(scene.id)). */
  url: string;
  /** Result of useSceneImage — gradient when "missing". */
  status: SceneImageStatus;
  /** Animate with the Ken Burns pan/zoom (default true). */
  animate?: boolean;
  /** Dim/blur it, e.g. as a poster behind a connecting session. */
  dimmed?: boolean;
};

/**
 * Renders the still first frame (or a gradient fallback).
 * @param props see Props
 */
export function StillWorld({ url, status, animate = true, dimmed = false }: Props) {
  useEffect(() => log.info("StillWorld", { url, status, animate, dimmed }), [url, status, animate, dimmed]);
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-amber-900 via-stone-900 to-stone-950">
      <style>{`@keyframes hg-kenburns{0%{transform:scale(1) translate(0,0)}50%{transform:scale(1.12) translate(-2%,-1.5%)}100%{transform:scale(1.06) translate(2%,1%)}}`}</style>
      {status === "ok" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className={`h-full w-full object-cover ${dimmed ? "opacity-60 blur-[2px]" : ""}`}
          style={animate ? { animation: `hg-kenburns ${REACTOR.kenBurnsSeconds}s ease-in-out infinite alternate` } : undefined}
        />
      )}
    </div>
  );
}
