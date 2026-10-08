"use client";
/**
 * WorldView — the walkable historical world for one round (Reactor LingBot World 2).
 *
 * Contract (stable — the game loop depends on it):
 *  - `scene`   the scene to render (first frame = sceneImageUrl(scene.id), prompts = scene.worldPrompt)
 *  - `onEnded` called once if the session ends on its own (time cap, idle, hidden tab, error) with a
 *              short reason; the view then falls back to the still image.
 * Fills its parent (absolute inset-0) — the parent must be `relative` with a size.
 *
 * Modes:
 *  - MOCK_WORLD (NEXT_PUBLIC_MOCK_WORLD=1): never contacts Reactor; shows the still image with a slow
 *    Ken Burns pan/zoom (StillWorld) and the same HUD.
 *  - Live: <LingbotWorld2Provider> keyed by scene id (fresh session per round, torn down on unmount)
 *    → useWorldSession (token → connect → setImage → setPrompt → start, cost guards) +
 *    useWasdControls (WASD walk, arrows look, idle ↔ moving prompt swap) + WorldHud.
 *  - Missing first frame (404 during development): gradient fallback, and no paid session is opened.
 *
 * Feature files: useWorldSession.ts, useWasdControls.ts, WorldHud.tsx, StillWorld.tsx,
 * useSceneImage.ts, fetchReactorToken.ts (client) + lib/reactor-token.ts & app/api/reactor/token (server).
 */
import { useEffect, useRef } from "react";
import { LingbotWorld2MainVideoView, LingbotWorld2Provider } from "@reactor-models/lingbot-world-2";
import { MOCK_WORLD, REACTOR } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import { fetchReactorToken } from "./fetchReactorToken";
import { StillWorld } from "./StillWorld";
import { useSceneImage } from "./useSceneImage";
import { useWasdControls } from "./useWasdControls";
import { useWorldSession } from "./useWorldSession";
import { WorldHud } from "./WorldHud";

export type WorldViewProps = { scene: Scene; onEnded?: (reason: string) => void };

/**
 * Entry point: picks mock / missing-image / live rendering.
 * @param props see WorldViewProps
 */
export function WorldView({ scene, onEnded }: WorldViewProps) {
  const image = useSceneImage(scene.id);
  const reportedRef = useRef<string | null>(null);
  useEffect(() => log.info("WorldView", { sceneId: scene.id, mock: MOCK_WORLD }), [scene.id]);

  // Missing first frame in live mode: no session possible — report once so the round can go on.
  useEffect(() => {
    if (MOCK_WORLD || image.status !== "missing" || reportedRef.current === scene.id) return;
    reportedRef.current = scene.id;
    onEnded?.("no scene image");
  }, [image.status, scene.id, onEnded]);

  if (MOCK_WORLD || image.status === "missing") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <StillWorld url={image.url} status={image.status} />
        <WorldHud phase={MOCK_WORLD ? "mock" : "error"} message={MOCK_WORLD ? null : "no scene image"} />
      </div>
    );
  }
  if (image.status === "loading") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <StillWorld url={image.url} status={image.status} />
        <WorldHud phase="connecting" />
      </div>
    );
  }
  return (
    <LingbotWorld2Provider key={scene.id} apiUrl={REACTOR.apiUrl} jwtToken={fetchReactorToken}>
      <LiveWorld scene={scene} onEnded={onEnded} imageUrl={image.url} />
    </LingbotWorld2Provider>
  );
}

/**
 * Live Reactor world: video stream over the still poster, HUD on top, keyboard driving.
 * @param props scene, onEnded, and the verified first-frame URL
 */
function LiveWorld({ scene, onEnded, imageUrl }: WorldViewProps & { imageUrl: string }) {
  useEffect(() => log.info("LiveWorld", { sceneId: scene.id }), [scene.id]);
  const s = useWorldSession(scene, onEnded);
  const live = s.phase === "live";
  useWasdControls(live, { onAxis: s.onAxis, onMovingChange: s.onMovingChange, onInput: s.onInput });

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {!live && <StillWorld url={imageUrl} status="ok" dimmed={s.phase === "connecting" || s.phase === "staging"} />}
      {live && (
        <LingbotWorld2MainVideoView
          videoObjectFit="cover"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      )}
      <WorldHud phase={s.phase} secondsLeft={s.secondsLeft} retry={s.retry} waitingForGpu={s.waitingForGpu} message={s.message} />
    </div>
  );
}
