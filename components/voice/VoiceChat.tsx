"use client";
/**
 * VoiceChat — side panel where the player talks by voice to the scene's local (Gemini Live).
 *
 * Feature: "Voice chat with a local (Gemini Live)". The game loop (components/game) renders
 * `<VoiceChat scene={scene} />` next to the world view during a round and unmounts it when the round
 * ends. Contract (keep stable — the game loop depends on it): export `VoiceChat`, props
 * `VoiceChatProps = { scene: Scene }`.
 *
 * What it shows:
 *  - the local's name (from scene.local.name — safe, it never names the place)
 *  - a big "Talk" toggle: on → opens mic + Live session (useLiveSession.start), off → hangs up
 *  - connection status with a speaking/listening indicator and the remaining session time
 *    (VOICE.sessionSeconds cap)
 *  - a live transcript of both sides
 *  - readable errors (mic blocked, no mic, connection failed)
 * The persona and secret answer never reach this component: the server locks them into the token.
 * Unmount (round ends) or a new scene closes the session and releases the mic (handled in the hook).
 */
import { useEffect, useRef } from "react";
import type { Scene } from "@/lib/scene";
import { log } from "@/lib/log";
import { useLiveSession } from "./useLiveSession";

export type VoiceChatProps = { scene: Scene };

const STATUS_TEXT = {
  idle: "Not connected",
  connecting: "Connecting…",
  live: "Live",
  error: "Disconnected",
} as const;

/**
 * Voice chat side panel for one scene's local.
 * @param props see VoiceChatProps
 */
export function VoiceChat({ scene }: VoiceChatProps) {
  const { status, error, lines, speaking, secondsLeft, start, stop } = useLiveSession(scene.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstName = scene.local.name.split(",")[0];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  /** Talk toggle: start the conversation, or hang up if one is running. */
  const onToggle = () => {
    log.info("VoiceChat.onToggle", { sceneId: scene.id, status });
    if (status === "live" || status === "connecting") stop();
    else void start();
  };

  const active = status === "live" || status === "connecting";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-lg border border-amber-200/20 bg-black/30 p-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-amber-200/60">A local is nearby</div>
        <div className="font-serif text-lg text-amber-50">{scene.local.name}</div>
      </div>

      <button
        onClick={onToggle}
        aria-pressed={active}
        className={`w-full rounded-full px-4 py-3 text-base font-semibold transition ${
          active
            ? "border border-red-400/50 bg-red-500/20 text-red-100 hover:bg-red-500/30"
            : "bg-amber-400 text-black hover:bg-amber-300"
        }`}
      >
        {status === "connecting" ? "Connecting… (tap to cancel)" : status === "live" ? "Stop talking" : "Talk"}
      </button>

      <div className="flex items-center justify-between text-xs text-amber-100/70">
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "live" ? (speaking ? "animate-pulse bg-amber-400" : "bg-emerald-400") : status === "error" ? "bg-red-400" : "bg-white/30"
            }`}
          />
          {status === "live" ? (speaking ? `${firstName} is speaking — talk to interrupt` : "Listening… ask anything") : STATUS_TEXT[status]}
        </span>
        {status === "live" && secondsLeft !== null && <span>{secondsLeft}s left</span>}
      </div>

      {error && <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-sm">
        {lines.length === 0 && (
          <p className="text-amber-100/50">
            Press Talk and ask about food, prices, gossip, the weather, who is in charge… {firstName} won&apos;t tell
            you where or when you are, but will drop clues.
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={l.who === "you" ? "text-right" : ""}>
            <span
              className={`inline-block max-w-[90%] rounded-2xl px-3 py-2 ${
                l.who === "you" ? "bg-white/10 text-white/80" : "bg-amber-400/15 text-amber-50"
              }`}
            >
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
