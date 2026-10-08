"use client";
/**
 * useAvatarSession — the Reactor vidu-s2-avatar session lifecycle for one round's local.
 *
 * Feature: "Talking avatar (Reactor vidu-s2-avatar)". The local the player talks to is a live,
 * lip-synced video character made from the local's portrait (public/locals/<id>.png, painted offline by
 * scripts/generate-portraits.ts). This hook owns the paid Reactor session; <LocalAvatar> renders it.
 *
 * Flow:
 *   mount → fetchAvatarToken (JWT scoped to MODELS.reactorAvatar) → new ViduS2AvatarModel().connect()
 *   → wait for status "ready" → phase "preparing", trying avatar sources in order of preference:
 *        1. prebuilt avatar_id from data/avatars.json (lib/avatars.ts, skipped when older than
 *           AVATAR.prebuiltMaxAgeDays) → attachAvatar — a few seconds instead of ~40 s;
 *        2. cached avatar_id for this scene in localStorage → attachAvatar;
 *        3. fetch localPortraitUrl(id) → uploadFile → createAvatar({ image: FileRef, name }) (~40 s).
 *      AVATAR_NOT_FOUND or any attach failure falls through to the next source (a stale localStorage
 *      id is cleared); a freshly created id is cached in localStorage. The source used and the time
 *      from connect / prepare start to avatar_ready are logged ("avatar.ready").
 *   → session_state "avatar_ready" → phase "ready" (UI: "Talk to <name>")
 *   → startTalk(): getUserMedia(mic) → publishMic → listVoices → pick a gender-matched voice →
 *     startCall({ persona: buildLocalInstruction(scene), greeting, voice, language, call_mode: "audio",
 *     transcripts: true, llm }) → server phases starting / warming_up → "live": the character arrives
 *     on main_video + main_audio, `transcript` messages fill the transcript.
 *   → endTalk() / call ends → back to "ready" (the avatar stays bound; Talk works again).
 *
 * Secrecy: the persona is the same instruction Gemini Live gets (lib/persona.ts) — it contains the
 * secret place/year with strict never-reveal rules. Scenes are bundled client-side already, so building
 * it in the browser leaks nothing new; it is never rendered.
 *
 * Cost guards (lib/config.ts AVATAR):
 *   - call hard cap AVATAR.callMaxSeconds (or the server's call_max_seconds, whichever is lower),
 *   - call idle end after AVATAR.idleEndSeconds without transcript activity,
 *   - session idle: disconnect if no call is started AVATAR.readyIdleSeconds after "ready" → "closed",
 *   - tab hidden → endCall + disconnect → "closed",
 *   - unmount (round ends, LocalAvatar is unmounted) → endCall + disconnect, mic released.
 * "closed" offers reconnect(); setup failures (token, connect, missing portrait, AVATAR_FAILED /
 * AVATAR_TIMEOUT) end in "fallback", where LocalAvatar shows the still portrait + Gemini Live voice chat.
 *
 * Every Reactor model command (createAvatar, attachAvatar, listVoices, startCall, endCall) is logged
 * with logGenAI (image bytes stripped); every function logs its call with log.info.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ViduS2AvatarModel } from "@reactor-models/vidu-s2-avatar";
import type { ViduS2AvatarStartCallParams } from "@reactor-models/vidu-s2-avatar";
import { getPrebuiltAvatarId } from "@/lib/avatars";
import { AVATAR, MODELS, REACTOR, localPortraitUrl } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";
import { buildLocalInstruction } from "@/lib/persona";
import type { Scene } from "@/lib/scene";
import {
  clearCachedAvatarId,
  describeAvatarError,
  guessGender,
  pickAvatarVoice,
  readCachedAvatarId,
  writeCachedAvatarId,
} from "./avatarHelpers";
import { fetchAvatarToken } from "./fetchAvatarToken";

export type AvatarPhase = "connecting" | "preparing" | "ready" | "starting" | "live" | "closed" | "fallback";
export type AvatarLine = {
  who: "you" | "local";
  /** Text shown in the bubble (settled sentences + current draft). */
  text: string;
  final: boolean;
  /** Settled sentences only, so a later draft can replace the previous draft. */
  settled?: string;
};

/**
 * Folds one transcript message into the conversation so each speaker's turn reads as ONE bubble.
 * The avatar model emits a message per finished sentence (and sometimes a non-final draft first),
 * so: a draft replaces the previous draft of the same speaker; a sentence from the same speaker as
 * the last bubble is appended to it with a space; a new speaker starts a new bubble.
 * @param prev current lines
 * @param who speaker of the new message
 * @param text spoken text of the new message
 * @param final whether the model marked it settled
 * @returns the new lines array
 */
export function mergeTranscript(prev: AvatarLine[], who: AvatarLine["who"], text: string, final: boolean): AvatarLine[] {
  const clean = text.trim();
  if (!clean) return prev;
  const last = prev[prev.length - 1];
  if (!last || last.who !== who) return [...prev, { who, text: clean, final, settled: final ? clean : "" }];
  // Same speaker: rebuild from the settled part of the bubble plus this message.
  const settled = last.settled ?? (last.final ? last.text : "");
  const joined = settled ? `${settled} ${clean}` : clean;
  return [...prev.slice(0, -1), { who, text: joined, final, settled: final ? joined : settled }];
}

/**
 * Resolves once the Reactor session reports status "ready".
 * @param model the connected (or connecting) avatar model
 * @param timeoutMs give up after this many ms
 */
function waitForReady(model: ViduS2AvatarModel, timeoutMs: number): Promise<void> {
  log.info("waitForReady", { status: model.getStatus(), timeoutMs });
  if (model.getStatus() === "ready") return Promise.resolve();
  return new Promise((resolve, reject) => {
    /** statusChanged listener. @param s new status */
    const onStatus = (s: string) => {
      if (s === "ready") done();
      else if (s === "disconnected") done(new Error("disconnected before ready"));
    };
    const timer = setTimeout(() => done(new Error("timed out waiting for the avatar session")), timeoutMs);
    /** Cleans up and settles. @param err rejection reason, if any */
    function done(err?: Error) {
      clearTimeout(timer);
      model.off("statusChanged", onStatus);
      if (err) reject(err);
      else resolve();
    }
    model.on("statusChanged", onStatus);
  });
}

/**
 * Drives one vidu-s2-avatar session for `scene`'s local.
 * @param scene the round's scene
 * @param enabled false → do nothing (mock mode / AVATAR.enabled off)
 * @returns phase, messages, media streams, countdown, mic status and controls
 */
export function useAvatarSession(scene: Scene, enabled: boolean) {
  const modelRef = useRef<ViduS2AvatarModel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const [phase, setPhaseState] = useState<AvatarPhase>("connecting");
  const phaseRef = useRef<AvatarPhase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lines, setLines] = useState<AvatarLine[]>([]);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micForwarding, setMicForwarding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const serverCapRef = useRef<number | null>(null);

  /** Sets the phase in state and in the ref timers read. @param p new phase */
  const setPhase = useCallback((p: AvatarPhase) => {
    log.info("avatar.setPhase", { from: phaseRef.current, to: p });
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /** Unpublishes and stops the microphone. */
  const stopMic = useCallback(() => {
    log.info("avatar.stopMic", { active: !!micRef.current });
    if (!micRef.current) return;
    void modelRef.current?.unpublishMic().catch((e: unknown) => log.warn("unpublishMic failed", e));
    micRef.current.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    setMicOn(false);
  }, []);

  /**
   * Ends any call and disconnects a model (stops billing). Safe to call twice.
   * @param model the model to tear down
   * @param inCall whether a call may be running
   */
  const teardown = useCallback((model: ViduS2AvatarModel, inCall: boolean) => {
    log.info("avatar.teardown", { inCall });
    void (async () => {
      if (inCall) {
        const req = { model: MODELS.reactorAvatar, command: "end_call", reason: "teardown" };
        const res = await Promise.race([
          model.endCall().catch((e: unknown) => ({ error: String(e) })),
          new Promise((r) => setTimeout(() => r({ error: "no reply before disconnect" }), AVATAR.endCallGraceMs)),
        ]);
        logGenAI("reactor.avatar.endCall", req, res ?? { error: "send failed" });
      }
      await model.disconnect().catch((e: unknown) => log.warn("avatar disconnect failed", e));
    })();
  }, []);

  /**
   * Closes the session on a cost guard (tab hidden, idle) — the player can reconnect.
   * @param reason short reason shown to the player
   */
  const closeSession = useCallback((reason: string) => {
    log.info("avatar.closeSession", { sceneId: scene.id, reason, phase: phaseRef.current });
    const model = modelRef.current;
    stopMic();
    if (model) teardown(model, phaseRef.current === "live" || phaseRef.current === "starting");
    modelRef.current = null;
    setVideoStream(null);
    setAudioStream(null);
    setSecondsLeft(null);
    setNotice(reason);
    setPhase("closed");
  }, [scene.id, stopMic, teardown, setPhase]);

  // Connect + prepare the avatar on mount (and on reconnect).
  useEffect(() => {
    if (!enabled) return;
    log.info("useAvatarSession.setup", { sceneId: scene.id, attempt });
    let disposed = false;
    const model = new ViduS2AvatarModel({ apiUrl: REACTOR.apiUrl });
    modelRef.current = model;
    const offs: Array<() => void> = [];
    let prepTimer: ReturnType<typeof setTimeout> | undefined;
    /** Avatar ids still to try with attachAvatar, in order of preference (prebuilt, then cached). */
    const candidates: Array<{ source: "prebuilt" | "cache"; id: string }> = [];
    /** The avatar source currently being prepared. */
    let source: "prebuilt" | "cache" | "create" | null = null;
    const connectStartedAt = Date.now();
    let prepStartedAt = 0;
    let readyLogged = false;
    setPhase("connecting");
    setError(null);
    setNotice(null);
    setLines([]);

    /** Gives up on the live avatar and shows the voice-only fallback. @param code error code @param reason detail */
    const fallback = (code: string, reason?: string) => {
      log.warn("avatar.fallback", { sceneId: scene.id, code, reason });
      if (disposed) return;
      clearTimeout(prepTimer);
      setError(describeAvatarError(code, reason));
      setPhase("fallback");
      disposed = true;
      modelRef.current = null;
      teardown(model, false);
    };

    /** (Re)starts the prepare timeout for the current avatar source. */
    const armPrepTimer = () => {
      log.info("avatar.armPrepTimer", { sceneId: scene.id, source, ms: AVATAR.prepareTimeoutMs });
      clearTimeout(prepTimer);
      prepTimer = setTimeout(() => {
        if (phaseRef.current === "preparing") fallback("AVATAR_TIMEOUT");
      }, AVATAR.prepareTimeoutMs);
    };

    /**
     * Tries the next avatar source: attach the next candidate id, else create from the portrait.
     * Attach errors (thrown here, or AVATAR_NOT_FOUND via command_error) call this again.
     */
    const prepareNext = async (): Promise<void> => {
      if (disposed) return;
      const next = candidates.shift();
      source = next?.source ?? "create";
      prepStartedAt = Date.now();
      log.info("avatar.prepareNext", { sceneId: scene.id, source, avatarId: next?.id, remaining: candidates.length });
      armPrepTimer();
      if (!next) return createFromPortrait();
      const req = { model: MODELS.reactorAvatar, command: "attach_avatar", avatar_id: next.id, source: next.source };
      try {
        const res = await model.attachAvatar({ avatar_id: next.id });
        logGenAI("reactor.avatar.attachAvatar", req, res ?? { ok: true });
      } catch (e) {
        logGenAI("reactor.avatar.attachAvatar", req, { error: String(e) });
        if (next.source === "cache") clearCachedAvatarId(scene.id);
        return prepareNext();
      }
    };

    /** Uploads the portrait and creates a new avatar from it. */
    const createFromPortrait = async () => {
      log.info("avatar.createFromPortrait", { sceneId: scene.id });
      const url = localPortraitUrl(scene.id);
      const r = await fetch(url);
      if (!r.ok) return fallback("PORTRAIT_MISSING", `portrait ${r.status}`);
      const blob = await r.blob();
      if (disposed) return;
      const ref = await model.uploadFile(blob, { name: `${scene.id}.png` });
      const name = scene.local.name.slice(0, 100);
      const req = { model: MODELS.reactorAvatar, command: "create_avatar", name, image: { url, bytes: blob.size, type: blob.type } };
      const res = await model.createAvatar({ image: ref, name, image_url: null });
      logGenAI("reactor.avatar.createAvatar", req, res ?? { ok: true });
    };

    offs.push(
      model.onSessionState((s) => {
        log.info("avatar.session_state", {
          phase: s.phase, avatar_id: s.avatar_id, avatar_status: s.avatar_status, end_reason: s.end_reason,
          mic_forwarding: s.mic_forwarding, video_receiving: s.video_receiving, call_max_seconds: s.call_max_seconds,
        });
        if (disposed) return;
        setMicForwarding(!!s.mic_forwarding);
        serverCapRef.current = s.call_max_seconds ?? null;
        switch (s.phase) {
          case "preparing_avatar":
            setPhase("preparing");
            break;
          case "avatar_ready":
            clearTimeout(prepTimer);
            if (!readyLogged) {
              readyLogged = true;
              log.info("avatar.ready", {
                sceneId: scene.id, source, avatar_id: s.avatar_id,
                msFromConnect: Date.now() - connectStartedAt, msFromPrepare: prepStartedAt ? Date.now() - prepStartedAt : null,
              });
            }
            if (s.avatar_id && source !== "prebuilt") writeCachedAvatarId(scene.id, s.avatar_id);
            if (phaseRef.current !== "ready") lastActivityRef.current = Date.now();
            setPhase("ready");
            break;
          case "starting":
          case "warming_up":
            setPhase("starting");
            break;
          case "live":
            if (phaseRef.current !== "live") lastActivityRef.current = Date.now();
            setPhase("live");
            break;
          case "ending":
          case "ended":
          case "failed":
            if (phaseRef.current === "live" || phaseRef.current === "starting") {
              stopMic();
              setSecondsLeft(null);
              lastActivityRef.current = Date.now();
              if (s.phase === "failed") setError(describeAvatarError(String(s.last_error?.code ?? "CALL_FAILED"), String(s.last_error?.reason ?? "")));
              else if (s.end_reason && s.end_reason !== "ended_by_client") setNotice(`Conversation ended (${s.end_reason.replace(/_/g, " ")}).`);
              if (s.phase !== "ending") setPhase("ready");
            }
            break;
        }
      }),
    );
    offs.push(
      model.onCommandError((e) => {
        log.warn("avatar.command_error", e);
        if (disposed) return;
        // A stale / failing attach falls through to the next source (cache, then createAvatar).
        if (e.code === "AVATAR_NOT_FOUND" || ((source === "prebuilt" || source === "cache") && phaseRef.current === "preparing")) {
          if (source === "cache") clearCachedAvatarId(scene.id);
          void prepareNext().catch((err: unknown) => fallback("AVATAR_FAILED", String(err)));
          return;
        }
        if (phaseRef.current === "preparing" || phaseRef.current === "connecting") return fallback(e.code, e.reason);
        setError(describeAvatarError(e.code, e.reason));
        if (phaseRef.current === "starting") {
          stopMic();
          setPhase("ready");
        }
      }),
    );
    offs.push(
      model.onTranscript((t) => {
        log.info("avatar.transcript", { speaker: t.speaker, final: t.final, text: t.text });
        lastActivityRef.current = Date.now();
        const who = t.speaker === "user" ? "you" : "local";
        setLines((prev) => mergeTranscript(prev, who, t.text, t.final !== false).slice(-AVATAR.maxTranscriptLines));
      }),
    );
    offs.push(model.onMainVideo((_t, stream) => !disposed && setVideoStream(stream)));
    offs.push(model.onMainAudio((_t, stream) => !disposed && setAudioStream(stream)));

    (async () => {
      // No portrait yet (not generated) → don't open a paid session at all.
      const head = await fetch(localPortraitUrl(scene.id), { method: "HEAD" }).catch(() => null);
      if (!head?.ok) return fallback("PORTRAIT_MISSING", `portrait ${head?.status ?? "unreachable"}`);
      if (disposed) return;
      let jwt: string;
      try {
        jwt = await fetchAvatarToken();
      } catch (e) {
        return fallback("TOKEN", String(e));
      }
      if (disposed) return;
      try {
        await model.connect(jwt);
        await waitForReady(model, AVATAR.connectTimeoutMs);
      } catch (e) {
        const msg = `${e instanceof Error ? e.message : String(e)} ${(e as { code?: string } | null)?.code ?? ""}`;
        return fallback(/429|capacity|RATE_LIMITED/i.test(msg) ? "UPSTREAM_CAPACITY" : "CONNECT", msg);
      }
      if (disposed) return;
      setPhase("preparing");
      const prebuiltId = getPrebuiltAvatarId(scene.id);
      const cachedId = readCachedAvatarId(scene.id);
      if (prebuiltId) candidates.push({ source: "prebuilt", id: prebuiltId });
      if (cachedId && cachedId !== prebuiltId) candidates.push({ source: "cache", id: cachedId });
      try {
        await prepareNext();
      } catch (e) {
        fallback("AVATAR_FAILED", String(e));
      }
    })();

    return () => {
      log.info("useAvatarSession.cleanup", { sceneId: scene.id, phase: phaseRef.current });
      const wasDisposed = disposed;
      disposed = true;
      clearTimeout(prepTimer);
      offs.forEach((off) => off());
      if (micRef.current) {
        micRef.current.getTracks().forEach((t) => t.stop());
        micRef.current = null;
      }
      if (!wasDisposed) teardown(model, phaseRef.current === "live" || phaseRef.current === "starting");
      if (modelRef.current === model) modelRef.current = null;
    };
  }, [scene, enabled, attempt, setPhase, stopMic, teardown]);

  /** Starts a voice call with the ready avatar (asks for the mic first). */
  const startTalk = useCallback(async () => {
    log.info("avatar.startTalk", { sceneId: scene.id, phase: phaseRef.current });
    const model = modelRef.current;
    if (!model || phaseRef.current !== "ready") return;
    setError(null);
    setNotice(null);
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? "";
      setError(describeAvatarError(name === "NotFoundError" || name === "OverconstrainedError" ? "NO_MIC" : "MIC_DENIED"));
      setPhase("ready");
      return;
    }
    if (modelRef.current !== model) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    micRef.current = stream;
    setMicOn(true);
    try {
      await model.publishMic(stream.getAudioTracks()[0]);
      const voices = await model.listVoices().catch(() => undefined);
      logGenAI("reactor.avatar.listVoices", { model: MODELS.reactorAvatar, command: "list_voices" }, voices ?? { error: "no reply" });
      const voice = pickAvatarVoice(voices, guessGender(scene));
      const params: ViduS2AvatarStartCallParams = {
        persona: buildLocalInstruction(scene),
        greeting: AVATAR.greeting,
        voice: voice ?? null,
        language: AVATAR.language,
        call_mode: "audio",
        transcripts: true,
        llm: { ...AVATAR.llm },
      };
      const res = await model.startCall(params);
      logGenAI("reactor.avatar.startCall", { model: MODELS.reactorAvatar, command: "start_call", ...params }, res ?? { ok: true });
      lastActivityRef.current = Date.now();
    } catch (e) {
      log.error("avatar.startTalk failed", e);
      stopMic();
      setError(describeAvatarError("CALL_FAILED", e instanceof Error ? e.message : String(e)));
      setPhase("ready");
    }
  }, [scene, setPhase, stopMic]);

  /**
   * Ends the current call (the avatar stays bound so the player can talk again).
   * @param reason why ("button", "time up", "idle")
   */
  const endTalk = useCallback(async (reason = "button") => {
    log.info("avatar.endTalk", { sceneId: scene.id, reason, phase: phaseRef.current });
    const model = modelRef.current;
    stopMic();
    setSecondsLeft(null);
    if (reason !== "button") setNotice(reason === "time up" ? "Time's up for this conversation." : "The conversation went quiet, so it ended.");
    if (!model || (phaseRef.current !== "live" && phaseRef.current !== "starting")) return;
    const req = { model: MODELS.reactorAvatar, command: "end_call", reason };
    const res = await model.endCall().catch((e: unknown) => ({ error: String(e) }));
    logGenAI("reactor.avatar.endCall", req, res ?? { error: "send failed" });
    lastActivityRef.current = Date.now();
    if (phaseRef.current === "live" || phaseRef.current === "starting") setPhase("ready");
  }, [scene.id, stopMic, setPhase]);

  /** Reconnects after a cost-guard close. */
  const reconnect = useCallback(() => {
    log.info("avatar.reconnect", { sceneId: scene.id });
    setAttempt((a) => a + 1);
  }, [scene.id]);

  // Call timers: hard cap + idle end.
  useEffect(() => {
    if (phase !== "live") return;
    const cap = Math.min(AVATAR.callMaxSeconds, serverCapRef.current ?? Infinity);
    log.info("useAvatarSession.callTimer", { sceneId: scene.id, cap, idle: AVATAR.idleEndSeconds });
    const startedAt = Date.now();
    const t = setInterval(() => {
      const left = cap - Math.floor((Date.now() - startedAt) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) void endTalk("time up");
      else if (Date.now() - lastActivityRef.current > AVATAR.idleEndSeconds * 1000) void endTalk("idle");
    }, AVATAR.tickMs);
    return () => clearInterval(t);
  }, [phase, scene.id, endTalk]);

  // Session idle guard: a ready avatar nobody talks to is disconnected.
  useEffect(() => {
    if (phase !== "ready") return;
    log.info("useAvatarSession.readyIdle", { sceneId: scene.id, seconds: AVATAR.readyIdleSeconds });
    const t = setInterval(() => {
      if (Date.now() - lastActivityRef.current > AVATAR.readyIdleSeconds * 1000) closeSession("The local wandered off while you were exploring.");
    }, AVATAR.tickMs * 4);
    return () => clearInterval(t);
  }, [phase, scene.id, closeSession]);

  // Hidden tab → stop paying.
  useEffect(() => {
    if (!enabled) return;
    /** visibilitychange handler. */
    const onVis = () => {
      if (document.hidden && phaseRef.current !== "closed" && phaseRef.current !== "fallback") closeSession("Paused while the tab was hidden.");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled, closeSession]);

  return { phase, error, notice, lines, videoStream, audioStream, secondsLeft, micOn, micForwarding, startTalk, endTalk, reconnect };
}
