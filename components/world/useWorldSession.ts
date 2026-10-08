"use client";
/**
 * useWorldSession — the Reactor world-model session lifecycle for one round.
 *
 * Model-agnostic: it drives whichever world model the player picked through its adapter
 * (components/world/adapters/*, interface in adapters/types.ts). Must run inside that adapter's
 * <Provider> (WorldView keys the provider by scene id + attempt + model, so every round gets a fresh
 * session and the provider's unmount tears the previous one down = stops billing).
 *
 * Flow:
 *   mount → connect() (JWT from fetchReactorToken; retried REACTOR.connectRetries times on
 *   429 / "no capacity") → status "ready" → fetch the first frame (sceneImageUrl) → setImage
 *   (upload + set_image) → setPrompt(base + idle layer) → setRotationSpeedDeg → start() → "live".
 *   While live, useWasdControls reports key changes; this hook forwards them to adapter move()/look()
 *   (only the axes the model supports — WorldModelInfo.capabilities) and swaps the prompt to base + moving while walking, back to base + idle when stopped.
 *
 * Cost guards (lib/config.ts REACTOR):
 *   - hard cap: ends after REACTOR.exploreSeconds of live generation ("time up"),
 *   - idle: ends after REACTOR.idleDisconnectSeconds without any input ("idle"),
 *   - tab hidden: ends immediately ("tab hidden"),
 *   - server-side drop / command_error during staging: ends with "error"/"session closed".
 * Ending = disconnect() + onEnded(reason) exactly once; WorldView then shows the still image.
 *
 * Every Reactor image/prompt command is logged with logGenAI (inline data stripped).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { REACTOR, sceneImageUrl } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import type { WorldModelInfo } from "@/lib/world-models";
import type { LookValue, MoveValue, WorldAdapter } from "./adapters/types";
import type { Axis } from "./useWasdControls";

export type SessionPhase = "connecting" | "staging" | "live" | "ended" | "error";

/**
 * Flattens the layered world prompt into the single prose string the world models expect.
 * @param scene the scene (worldPrompt.base / idle / moving)
 * @param moving true while the player walks
 * @returns prompt text
 */
export function composeWorldPrompt(scene: Scene, moving: boolean): string {
  log.info("composeWorldPrompt", { sceneId: scene.id, moving });
  return `${scene.worldPrompt.base.trim()} ${(moving ? scene.worldPrompt.moving : scene.worldPrompt.idle).trim()}`;
}

/**
 * Drives one Reactor world session for `scene`.
 * @param scene the round's scene
 * @param model registry entry of the chosen world model (name for logs, capabilities)
 * @param adapter that model's client adapter (must match the surrounding Provider)
 * @param onEnded called once with a short reason when the session ends on its own
 * @returns phase, countdown, retry count, error message and input handlers for useWasdControls
 */
export function useWorldSession(scene: Scene, model: WorldModelInfo, adapter: WorldAdapter, onEnded?: (reason: string) => void) {
  const lw = adapter.useWorld();
  const modelName = model.reactorModel;
  const canMove = model.capabilities.move;
  const canLook = model.capabilities.look;
  const lwRef = useRef(lw);
  lwRef.current = lw;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const [phase, setPhase] = useState<SessionPhase>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(REACTOR.exploreSeconds);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const endedRef = useRef(false);
  const stagedRef = useRef(false);
  const lastInputRef = useRef(Date.now());
  const lastPromptRef = useRef<string | null>(null);

  /**
   * Ends the session once: disconnects (stops billing) and notifies the parent.
   * @param reason short reason ("time up", "idle", "tab hidden", "error: …")
   * @param isError show the error phase instead of "ended"
   */
  const endWorld = useCallback((reason: string, isError = false) => {
    log.info("endWorld", { sceneId: scene.id, reason, isError, already: endedRef.current });
    if (endedRef.current) return;
    endedRef.current = true;
    setMessage(reason);
    setPhase(isError ? "error" : "ended");
    void lwRef.current.disconnect().catch((e: unknown) => log.warn("disconnect failed", e));
    onEndedRef.current?.(reason);
  }, [scene.id]);

  /**
   * Sends a prompt if it differs from the last one sent, logging it as a GenAI call.
   * @param prompt full prompt text
   */
  const sendPrompt = useCallback(async (prompt: string) => {
    log.info("sendPrompt", { sceneId: scene.id, length: prompt.length });
    if (prompt === lastPromptRef.current) return;
    lastPromptRef.current = prompt;
    const req = { model: modelName, command: "set_prompt", prompt };
    const res = await lwRef.current.setPrompt(prompt);
    logGenAI("reactor.setPrompt", req, res ?? { error: "no reply (send failed)" });
    return res;
  }, [scene.id, modelName]);

  // Connect on mount, retrying on 429 / no capacity. The provider disconnects on unmount.
  useEffect(() => {
    log.info("useWorldSession.connect", { sceneId: scene.id });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** One connect attempt. @param n attempt index (0-based) */
    const attempt = (n: number) => {
      log.info("reactor.connect", { sceneId: scene.id, attempt: n + 1 });
      lwRef.current.connect().catch((e: unknown) => {
        if (cancelled || endedRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string } | null)?.code ?? "";
        const busy = /429|capacity|RATE_LIMITED/i.test(`${msg} ${code}`);
        log.warn("reactor.connect failed", { attempt: n + 1, busy, msg, code });
        if (busy && n < REACTOR.connectRetries) {
          setRetry(n + 1);
          timer = setTimeout(() => attempt(n + 1), REACTOR.connectRetryDelayMs);
          return;
        }
        endWorld(busy ? "all time machines are busy" : `error: ${msg}`, true);
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scene.id, endWorld]);

  // Once ready: image → prompt → start.
  useEffect(() => {
    if (lw.status !== "ready" || stagedRef.current || endedRef.current) return;
    stagedRef.current = true;
    setPhase("staging");
    (async () => {
      log.info("useWorldSession.stage", { sceneId: scene.id, model: modelName });
      try {
        const url = sceneImageUrl(scene.id);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`first frame missing (${r.status})`);
        const blob = await r.blob();
        if (endedRef.current) return;
        const imgReq = { model: modelName, command: "set_image", image: { url, bytes: blob.size, type: blob.type } };
        const imgRes = await lwRef.current.setImage(blob, `${scene.id}.png`);
        logGenAI("reactor.setImage", imgReq, imgRes ?? { error: "no reply (send failed)" });
        if (!imgRes) throw new Error("image rejected");
        const promptRes = await sendPrompt(composeWorldPrompt(scene, false));
        if (!promptRes) throw new Error("prompt rejected");
        if (canLook) await lwRef.current.setRotationSpeedDeg(REACTOR.rotationSpeedDeg);
        if (endedRef.current) return;
        await lwRef.current.start();
        logGenAI("reactor.start", { model: modelName, command: "start" }, { ok: true });
        lastInputRef.current = Date.now();
        setPhase("live");
      } catch (e) {
        log.error("useWorldSession.stage failed", e);
        endWorld(`error: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    })();
  }, [lw.status, scene, sendPrompt, endWorld, modelName, canLook]);

  // Server dropped the session (moderation, GPU loss…).
  useEffect(() => {
    if (lw.status === "disconnected" && (phaseRef.current === "live" || phaseRef.current === "staging")) {
      endWorld("session closed by server");
    }
  }, [lw.status, endWorld]);

  adapter.useCommandError((m) => {
    log.warn("reactor command_error", m);
    if (phaseRef.current === "staging") endWorld("error: world model rejected the scene", true);
  });

  // Countdown (hard cap) + idle guard. Watch-only models (no walk, no look) have no input to wait
  // for, so only the hard cap applies to them.
  useEffect(() => {
    if (phase !== "live") return;
    const idleGuard = canMove || canLook;
    log.info("useWorldSession.timer", { sceneId: scene.id, cap: REACTOR.exploreSeconds, idle: idleGuard ? REACTOR.idleDisconnectSeconds : "off" });
    const startedAt = Date.now();
    const t = setInterval(() => {
      const left = REACTOR.exploreSeconds - Math.floor((Date.now() - startedAt) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) endWorld("time up");
      else if (idleGuard && Date.now() - lastInputRef.current > REACTOR.idleDisconnectSeconds * 1000) endWorld("idle");
    }, REACTOR.tickMs);
    return () => clearInterval(t);
  }, [phase, scene.id, endWorld, canMove, canLook]);

  // Hidden tab → stop paying.
  useEffect(() => {
    /** visibilitychange handler. */
    const onVis = () => {
      if (document.hidden && !endedRef.current) endWorld("tab hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [endWorld]);

  /**
   * Forwards one movement/look axis change to Reactor.
   * @param axis which axis changed
   * @param value new value ("idle", "forward", "strafe_left", "left", "up", …)
   */
  const onAxis = useCallback((axis: Axis, value: string) => {
    log.info("onAxis", { axis, value });
    if (phaseRef.current !== "live") return;
    const l = lwRef.current;
    if ((axis === "long" || axis === "lat") && canMove) l.move(axis, value as MoveValue);
    if ((axis === "yaw" || axis === "pitch") && canLook) l.look(axis, value as LookValue);
  }, [canMove, canLook]);

  /** Swaps the idle / moving prompt layer. @param moving true while walking */
  const onMovingChange = useCallback((moving: boolean) => {
    log.info("onMovingChange", { moving });
    if (phaseRef.current !== "live") return;
    void sendPrompt(composeWorldPrompt(scene, moving));
  }, [scene, sendPrompt]);

  /** Resets the idle-disconnect timer (any key press). */
  const onInput = useCallback(() => {
    lastInputRef.current = Date.now();
  }, []);

  return { phase, message, retry, secondsLeft, waitingForGpu: lw.status === "waiting", onAxis, onMovingChange, onInput };
}
