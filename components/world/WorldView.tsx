"use client";
/**
 * WorldView — the walkable historical world for one round (Reactor world model chosen by the player;
 * LingBot World 2 by default — see lib/world-models.ts and components/world/adapters/*).
 *
 * Contract (stable — the game loop depends on it):
 *  - `scene`   the scene to render (first frame = sceneImageUrl(scene.id), prompts = scene.worldPrompt)
 *  - `onEnded` called once if the session ends on its own (time cap, idle, hidden tab, error) with a
 *              short reason; the view then falls back to the still image. Reported at most once per
 *              session (attempt); callbacks from an older, torn-down session are ignored.
 *  - `onResumed` OPTIONAL — called when a manual reconnect goes live again (the parent can hide its
 *              "vision fades" banner).
 * Fills its parent (absolute inset-0) — the parent must be `relative` with a size.
 *
 * Modes:
 *  - MOCK_WORLD (NEXT_PUBLIC_MOCK_WORLD=1): never contacts Reactor; shows the still image with a slow
 *    Ken Burns pan/zoom (StillWorld) and the same HUD.
 *  - Live: the chosen adapter <Provider> keyed by scene id + model (fresh session per round, torn down on unmount)
 *    → useWorldSession (token → connect → setImage → setPrompt → start, cost guards) +
 *    useWasdControls (WASD walk, arrows look, idle ↔ moving prompt swap) + WorldHud.
 *  - Missing first frame (404 during development): gradient fallback, and no paid session is opened.
 *
 * Reconnect (live mode only, never automatic): once a session has ended or errored, the HUD offers
 * "Reopen the portal" (button or the REACTOR.reconnectKey shortcut, R). Clicking bumps an attempt
 * counter that is part of the provider's key, so React tears the old provider down (disconnect) and
 * mounts a brand-new adapter <Provider> + LiveWorld: fresh token lookup → connect → setImage →
 * setPrompt → start, with a fresh idle timer, per-session time cap and fresh WASD/look state (the
 * controls hook lives inside the keyed subtree, so any accumulated camera yaw also starts at 0).
 * Capped at REACTOR.maxReconnectsPerRound per round (the component is remounted per round/scene);
 * after that the HUD shows "The portal is spent — make your guess".
 *
 * Feature files: useWorldSession.ts, useWasdControls.ts, WorldHud.tsx, StillWorld.tsx,
 * useSceneImage.ts, fetchReactorToken.ts (client) + lib/reactor-token.ts & app/api/reactor/token (server).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MOCK_WORLD, REACTOR } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import { getWorldModel, type WorldModelInfo } from "@/lib/world-models";
import { getWorldAdapter } from "./adapters";
import type { WorldAdapter } from "./adapters/types";
import { fetchReactorToken } from "./fetchReactorToken";
import { StillWorld } from "./StillWorld";
import { useSceneImage } from "./useSceneImage";
import { useWasdControls } from "./useWasdControls";
import { useWorldSession } from "./useWorldSession";
import { WorldHud } from "./WorldHud";
import { LookIndicator } from "./LookIndicator";

export type WorldViewProps = {
  scene: Scene;
  onEnded?: (reason: string) => void;
  onResumed?: () => void;
  /** World model id from lib/world-models.ts (default WORLD.defaultModelId; unknown ids fall back). */
  modelId?: string;
};

/**
 * Entry point: picks mock / missing-image / live rendering.
 * @param props see WorldViewProps
 */
export function WorldView({ scene, onEnded, onResumed, modelId }: WorldViewProps) {
  const image = useSceneImage(scene.id);
  const reportedRef = useRef<string | null>(null);
  const model = getWorldModel(modelId);
  useEffect(() => log.info("WorldView", { sceneId: scene.id, mock: MOCK_WORLD, model: model.id }), [scene.id, model.id]);

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
  return <ReconnectableWorld key={`${scene.id}@${model.id}`} scene={scene} onEnded={onEnded} onResumed={onResumed} imageUrl={image.url} model={model} />;
}

/**
 * Owns the per-round reconnect budget and the attempt counter; renders one keyed provider per attempt.
 * Guards: onEnded is forwarded at most once per attempt and only for the current attempt (a late
 * endWorld from a torn-down session is dropped); onResumed fires only when a reconnect (attempt > 0)
 * reaches "live"; reconnect is only accepted after the current attempt has ended.
 * @param props scene, parent callbacks, the verified first-frame URL and the chosen world model
 */
function ReconnectableWorld({ scene, onEnded, onResumed, imageUrl, model }: WorldViewProps & { imageUrl: string; model: WorldModelInfo }) {
  const adapter = getWorldAdapter(model.id);
  const Provider = adapter.Provider;
  /** JWT resolver scoped to the chosen model (the token route only allows REACTOR_TOKEN_MODELS). */
  const jwtToken = useCallback(() => fetchReactorToken(model.reactorModel), [model.reactorModel]);
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  const endedAttemptRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onResumedRef = useRef(onResumed);
  onResumedRef.current = onResumed;
  useEffect(() => log.info("ReconnectableWorld", { sceneId: scene.id, attempt }), [scene.id, attempt]);

  /**
   * Forwards a session end to the parent, once per attempt, ignoring stale sessions.
   * @param n attempt the ending session belongs to
   * @param reason short reason from useWorldSession
   */
  const handleEnded = useCallback((n: number, reason: string) => {
    log.info("ReconnectableWorld.handleEnded", { n, current: attemptRef.current, reason });
    if (n !== attemptRef.current || endedAttemptRef.current === n) return;
    endedAttemptRef.current = n;
    onEndedRef.current?.(reason);
  }, []);

  /** Tells the parent a reconnect went live (ignored for the first session / stale ones). @param n attempt */
  const handleLive = useCallback((n: number) => {
    log.info("ReconnectableWorld.handleLive", { n, current: attemptRef.current });
    if (n === 0 || n !== attemptRef.current) return;
    onResumedRef.current?.();
  }, []);

  /** Starts a fresh session for the same scene if the current one has ended and budget remains. */
  const reconnect = useCallback(() => {
    log.info("ReconnectableWorld.reconnect", { attempt: attemptRef.current, ended: endedAttemptRef.current });
    if (endedAttemptRef.current !== attemptRef.current) return;
    if (attemptRef.current >= REACTOR.maxReconnectsPerRound) return;
    attemptRef.current += 1;
    setAttempt(attemptRef.current);
  }, []);

  return (
    <Provider key={`${scene.id}#${attempt}`} apiUrl={REACTOR.apiUrl} jwtToken={jwtToken}>
      <LiveWorld
        scene={scene}
        model={model}
        adapter={adapter}
        imageUrl={imageUrl}
        attempt={attempt}
        reconnectsLeft={REACTOR.maxReconnectsPerRound - attempt}
        onSessionEnded={handleEnded}
        onSessionLive={handleLive}
        onReconnect={reconnect}
      />
    </Provider>
  );
}

type LiveWorldProps = {
  scene: Scene;
  /** Chosen world model (registry entry) and its adapter (must match the surrounding Provider). */
  model: WorldModelInfo;
  adapter: WorldAdapter;
  imageUrl: string;
  /** Which session of this round this is (0 = first). */
  attempt: number;
  /** Reconnects still allowed this round. */
  reconnectsLeft: number;
  onSessionEnded: (attempt: number, reason: string) => void;
  onSessionLive: (attempt: number) => void;
  onReconnect: () => void;
};

/**
 * Live Reactor world: video stream over the still poster, HUD on top, keyboard driving, and the
 * reconnect affordance (button + R) once the session has ended.
 * @param props see LiveWorldProps
 */
function LiveWorld({ scene, model, adapter, imageUrl, attempt, reconnectsLeft, onSessionEnded, onSessionLive, onReconnect }: LiveWorldProps) {
  useEffect(() => log.info("LiveWorld", { sceneId: scene.id, attempt, model: model.id }), [scene.id, attempt, model.id]);
  const handleEnded = useCallback((reason: string) => onSessionEnded(attempt, reason), [onSessionEnded, attempt]);
  const s = useWorldSession(scene, model, adapter, handleEnded);
  const live = s.phase === "live";
  const closed = s.phase === "ended" || s.phase === "error";
  const wasd = useWasdControls(live, { onAxis: s.onAxis, onMovingChange: s.onMovingChange, onInput: s.onInput }, adapter);
  const Video = adapter.Video;

  useEffect(() => {
    if (live) onSessionLive(attempt);
  }, [live, attempt, onSessionLive]);

  // R = reconnect, bound only while the session is closed and budget remains.
  useEffect(() => {
    if (!closed || reconnectsLeft <= 0) return;
    log.info("LiveWorld.reconnectKey", { attempt, reconnectsLeft });
    /** keydown handler. @param e keyboard event */
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key.toLowerCase() !== REACTOR.reconnectKey) return;
      e.preventDefault();
      onReconnect();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [closed, reconnectsLeft, attempt, onReconnect]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {!live && <StillWorld url={imageUrl} status="ok" dimmed={s.phase === "connecting" || s.phase === "staging"} />}
      {live && (
        <Video style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      )}
      {live && model.capabilities.look && <LookIndicator look={wasd.look} />}
      <WorldHud phase={s.phase} secondsLeft={s.secondsLeft} retry={s.retry} waitingForGpu={s.waitingForGpu} message={s.message}
        modelLabel={model.label} canMove={model.capabilities.move} canLook={model.capabilities.look}
        reconnect={closed ? { left: reconnectsLeft, onReconnect } : undefined}
      />

    </div>
  );
}
