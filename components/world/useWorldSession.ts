"use client";
/**
 * useWorldSession — the Reactor LingBot World 2 session lifecycle for one round.
 *
 * Must run inside <LingbotWorld2Provider> (WorldView keys the provider by scene id, so every round
 * gets a fresh session and the provider's unmount tears the previous one down = stops billing).
 *
 * Flow:
 *   mount → connect() (JWT from fetchReactorToken; retried REACTOR.connectRetries times on
 *   429 / "no capacity") → status "ready" → fetch the first frame (sceneImageUrl) → uploadFile →
 *   setImage → setPrompt(base + idle layer) → setRotationSpeedDeg → start() → phase "live".
 *   While live, useWasdControls reports key changes; this hook forwards them as
 *   set_move_longitudinal / set_move_lateral / set_look_horizontal / set_look_vertical and swaps the
 *   prompt to base + moving while walking, back to base + idle when stopped.
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
import { useLingbotWorld2, useLingbotWorld2CommandError } from "@reactor-models/lingbot-world-2";
import { MODELS, REACTOR, sceneImageUrl } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import type { Axis } from "./useWasdControls";

export type SessionPhase = "connecting" | "staging" | "live" | "ended" | "error";

/**
 * Flattens the layered world prompt into the single prose string LingBot World 2 expects.
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
 * @param onEnded called once with a short reason when the session ends on its own
 * @returns phase, countdown, retry count, error message and input handlers for useWasdControls
 */
export function useWorldSession(scene: Scene, onEnded?: (reason: string) => void) {
  const lw = useLingbotWorld2();
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
    const req = { model: MODELS.reactorWorld, command: "set_prompt", prompt };
    const res = await lwRef.current.setPrompt({ prompt });
    logGenAI("reactor.setPrompt", req, res ?? { error: "no reply (send failed)" });
    return res;
  }, [scene.id]);

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
      log.info("useWorldSession.stage", { sceneId: scene.id });
      try {
        const url = sceneImageUrl(scene.id);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`first frame missing (${r.status})`);
        const blob = await r.blob();
        if (endedRef.current) return;
        const ref = await lwRef.current.uploadFile(blob, { name: `${scene.id}.png` });
        const imgReq = { model: MODELS.reactorWorld, command: "set_image", image: { url, bytes: blob.size, type: blob.type } };
        const imgRes = await lwRef.current.setImage({ image: ref });
        logGenAI("reactor.setImage", imgReq, imgRes ?? { error: "no reply (send failed)" });
        if (!imgRes) throw new Error("image rejected");
        const promptRes = await sendPrompt(composeWorldPrompt(scene, false));
        if (!promptRes) throw new Error("prompt rejected");
        await lwRef.current.setRotationSpeedDeg({ rotation_speed_deg: REACTOR.rotationSpeedDeg });
        if (endedRef.current) return;
        await lwRef.current.start();
        logGenAI("reactor.start", { model: MODELS.reactorWorld, command: "start" }, { ok: true });
        lastInputRef.current = Date.now();
        setPhase("live");
      } catch (e) {
        log.error("useWorldSession.stage failed", e);
        endWorld(`error: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    })();
  }, [lw.status, scene, sendPrompt, endWorld]);

  // Server dropped the session (moderation, GPU loss…).
  useEffect(() => {
    if (lw.status === "disconnected" && (phaseRef.current === "live" || phaseRef.current === "staging")) {
      endWorld("session closed by server");
    }
  }, [lw.status, endWorld]);

  useLingbotWorld2CommandError((m) => {
    log.warn("reactor command_error", m);
    if (phaseRef.current === "staging") endWorld("error: world model rejected the scene", true);
  });

  // Countdown (hard cap) + idle guard.
  useEffect(() => {
    if (phase !== "live") return;
    log.info("useWorldSession.timer", { sceneId: scene.id, cap: REACTOR.exploreSeconds, idle: REACTOR.idleDisconnectSeconds });
    const startedAt = Date.now();
    const t = setInterval(() => {
      const left = REACTOR.exploreSeconds - Math.floor((Date.now() - startedAt) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) endWorld("time up");
      else if (Date.now() - lastInputRef.current > REACTOR.idleDisconnectSeconds * 1000) endWorld("idle");
    }, REACTOR.tickMs);
    return () => clearInterval(t);
  }, [phase, scene.id, endWorld]);

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
    if (axis === "long") void l.setMoveLongitudinal({ move_longitudinal: value as "idle" | "forward" | "back" });
    if (axis === "lat") void l.setMoveLateral({ move_lateral: value as "idle" | "strafe_left" | "strafe_right" });
    if (axis === "yaw") void l.setLookHorizontal({ look_horizontal: value as "idle" | "left" | "right" });
    if (axis === "pitch") void l.setLookVertical({ look_vertical: value as "idle" | "up" | "down" });
  }, []);

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
