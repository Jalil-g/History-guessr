"use client";
/**
 * useLiveSession — React hook that runs one Gemini Live voice conversation with a scene's local.
 *
 * Feature: "Voice chat with a local (Gemini Live)". Used only by components/voice/VoiceChat.tsx.
 *
 * Flow when the player presses "Talk" (`start()`):
 *  1. create the 24 kHz playback queue (lib/audio/pcm-player.ts) inside the click gesture
 *  2. open the mic (lib/audio/mic-capture.ts) — fails early with a readable message if denied
 *  3. POST /api/live-token { sceneId } → { token, model }. The server looked up the persona, voice
 *     and secret answer itself and locked them into the single-use token; the browser never sees them.
 *  4. ai.live.connect({ model }) with the token as apiKey (v1alpha). If connecting with the primary
 *     model fails, re-request a token with `fallback: true` (MODELS.geminiLiveFallback) and retry once.
 *  5. stream mic chunks up; play audio coming back; append input/output transcriptions to `lines`;
 *     on `interrupted` (player talks over the local) drop queued playback (barge-in).
 *  6. send VOICE.greetingCue as text so the local speaks first.
 * `stop()` (Talk toggle off, VOICE.sessionSeconds cap reached, socket closed, unmount, new scene)
 * closes the session, releases the mic and the speakers.
 *
 * Every GenAI interaction is logged with logGenAI (connect request/result, each completed turn's
 * transcripts); audio payloads are never logged and the token is never logged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { VOICE } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";
import { startMicCapture, type MicCapture } from "@/lib/audio/mic-capture";
import { createPcmPlayer, type PcmPlayer } from "@/lib/audio/pcm-player";

export type TranscriptLine = { who: "you" | "local"; text: string };
export type LiveStatus = "idle" | "connecting" | "live" | "error";

export type LiveSessionState = {
  status: LiveStatus;
  error: string | null;
  lines: TranscriptLine[];
  speaking: boolean;
  secondsLeft: number | null;
  start: () => Promise<void>;
  stop: () => void;
};

/**
 * Turns any thrown value into a message a player can understand.
 * @param e error from getUserMedia, fetch or the Live socket
 * @returns readable message
 */
export function friendlyError(e: unknown): string {
  log.info("friendlyError", { e });
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow the mic in your browser's address bar and press Talk again.";
  if (name === "NotFoundError") return "No microphone found. Plug one in and press Talk again.";
  const msg = (e as Error)?.message;
  return msg ? `Voice chat failed: ${msg}` : "Voice chat failed. Try again.";
}

/**
 * Fetches a single-use Live token for the scene from our server.
 * @param sceneId scene id (server looks up the persona)
 * @param fallback ask for the fallback Live model
 * @returns { token, model }
 */
async function fetchToken(sceneId: string, fallback: boolean): Promise<{ token: string; model: string }> {
  log.info("fetchToken", { sceneId, fallback });
  const r = await fetch("/api/live-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneId, fallback }),
  });
  const body = (await r.json().catch(() => ({}))) as { token?: string; model?: string; error?: string };
  if (!r.ok || !body.token || !body.model) throw new Error(body.error ?? `token request failed (${r.status})`);
  return { token: body.token, model: body.model };
}

/**
 * Runs a Gemini Live voice session for one scene.
 * @param sceneId the scene whose local the player talks to
 * @returns session state + start/stop controls
 */
export function useLiveSession(sceneId: string): LiveSessionState {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef(0); // increments on every start/stop; stale async work checks it and bails
  const turnRef = useRef({ you: "", local: "" });

  /**
   * Appends transcript text, merging into the last line while the same speaker keeps talking.
   * @param who speaker
   * @param text transcription fragment
   */
  const addText = useCallback((who: TranscriptLine["who"], text: string) => {
    turnRef.current[who] += text;
    setLines((prev) => {
      const last = prev.at(-1);
      if (last && last.who === who) return [...prev.slice(0, -1), { who, text: last.text + text }];
      return [...prev, { who, text: text.trimStart() }];
    });
  }, []);

  /** Tears down session, mic, speakers and the countdown (idempotent). */
  const stop = useCallback(() => {
    log.info("useLiveSession.stop", { sceneId });
    runRef.current++;
    const s = sessionRef.current;
    sessionRef.current = null;
    try {
      s?.close();
    } catch {
      /* already closed */
    }
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setSpeaking(false);
    setSecondsLeft(null);
    setStatus((st) => (st === "error" ? st : "idle"));
  }, [sceneId]);

  /**
   * Handles one server message: audio → player, barge-in, transcripts, turn logging.
   * @param m Live server message
   * @param model model name (for logs)
   */
  const onMessage = useCallback(
    (m: LiveServerMessage, model: string) => {
      const sc = m.serverContent;
      if (!sc) return;
      if (sc.interrupted) playerRef.current?.interrupt();
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) playerRef.current?.enqueue(p.inlineData.data);
      if (sc.inputTranscription?.text) addText("you", sc.inputTranscription.text);
      if (sc.outputTranscription?.text) addText("local", sc.outputTranscription.text);
      if (sc.turnComplete || sc.interrupted) {
        logGenAI("gemini.live.turn", { model, sceneId, playerSaid: turnRef.current.you }, {
          localSaid: turnRef.current.local,
          interrupted: Boolean(sc.interrupted),
        });
        turnRef.current = { you: "", local: "" };
      }
    },
    [addText, sceneId],
  );

  /**
   * Mints a token and connects to Gemini Live.
   * @param fallback use the fallback model
   * @param run run id this attempt belongs to
   * @returns the open session
   */
  const connect = useCallback(
    async (fallback: boolean, run: number): Promise<Session> => {
      log.info("useLiveSession.connect", { sceneId, fallback });
      const { token, model } = await fetchToken(sceneId, fallback);
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: VOICE.apiVersion } });
      const request = { model, config: { responseModalities: [Modality.AUDIO] } };
      try {
        const session = await ai.live.connect({
          ...request,
          callbacks: {
            onmessage: (m) => onMessage(m, model),
            onerror: (e) => {
              log.error("gemini.live error", { message: e.message });
              if (runRef.current !== run) return;
              setError(friendlyError(new Error(e.message || "connection error")));
              setStatus("error");
              stop();
            },
            onclose: (e) => {
              log.info("gemini.live closed", { code: e.code, reason: e.reason });
              if (runRef.current === run && sessionRef.current) {
                if (e.code !== 1000) {
                  setError(friendlyError(new Error(e.reason || `connection closed (${e.code})`)));
                  setStatus("error");
                }
                stop();
              }
            },
          },
        });
        logGenAI("gemini.live.connect", request, { connected: true, model });
        return session;
      } catch (e) {
        logGenAI("gemini.live.connect", request, e);
        throw e;
      }
    },
    [sceneId, onMessage, stop],
  );

  /** Starts mic + speakers + Live session; the local greets first. */
  const start = useCallback(async () => {
    log.info("useLiveSession.start", { sceneId });
    stop();
    const run = runRef.current;
    setError(null);
    setStatus("connecting");
    try {
      playerRef.current = createPcmPlayer(setSpeaking);
      micRef.current = await startMicCapture((chunk) => {
        // Chunks captured before the socket is open are dropped (the local speaks first anyway).
        sessionRef.current?.sendRealtimeInput({ audio: { data: chunk, mimeType: `audio/pcm;rate=${VOICE.inputSampleRate}` } });
      });
      if (runRef.current !== run) return;

      let session: Session;
      try {
        session = await connect(false, run);
      } catch (e) {
        log.warn("primary Live model failed, trying fallback", { error: (e as Error).message });
        if (runRef.current !== run) return;
        session = await connect(true, run);
      }
      if (runRef.current !== run) {
        session.close();
        return;
      }
      sessionRef.current = session;
      session.sendRealtimeInput({ text: VOICE.greetingCue });
      setStatus("live");

      const endsAt = Date.now() + VOICE.sessionSeconds * 1000;
      setSecondsLeft(VOICE.sessionSeconds);
      timerRef.current = setInterval(() => {
        const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left <= 0) {
          log.info("voice session time limit reached", { sceneId, seconds: VOICE.sessionSeconds });
          stop();
        }
      }, 1000);
    } catch (e) {
      log.error("useLiveSession.start failed", e);
      if (runRef.current !== run) return;
      setError(friendlyError(e));
      setStatus("error");
      stop();
    }
  }, [sceneId, connect, stop]);

  // New scene → fresh transcript; unmount → close everything.
  useEffect(() => {
    setLines([]);
    setError(null);
    setStatus("idle");
    return () => stop();
  }, [sceneId, stop]);

  return { status, error, lines, speaking, secondsLeft, start, stop };
}
