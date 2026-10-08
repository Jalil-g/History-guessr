"use client";
/**
 * AvatarHud — the controls and transcript under the talking avatar's video.
 *
 * Feature: "Talking avatar (Reactor vidu-s2-avatar)". <LocalAvatar> renders the local's live video
 * on top and this HUD underneath, inside the floating portrait card on the right of the round screen:
 *  - a status line (connecting / bringing the local to life / ready / live with countdown) with a
 *    mic indicator (mic open + whether Reactor reports it forwarding),
 *  - the main button: "Talk to <first name>" when ready, "End conversation" while live/starting,
 *    "Wake <first name>" after a cost-guard close (tab hidden / idle),
 *  - error and notice lines (mic denied, BUSY, NO_AVATAR, call ended reasons…),
 *  - the live transcript of both sides (auto-scrolls).
 * Purely presentational: everything comes from useAvatarSession via props. Never shows place/year.
 */
import { useEffect, useRef } from "react";
import { log } from "@/lib/log";
import type { AvatarLine, AvatarPhase } from "./useAvatarSession";

export type AvatarHudProps = {
  firstName: string;
  phase: AvatarPhase;
  error: string | null;
  notice: string | null;
  lines: AvatarLine[];
  secondsLeft: number | null;
  micOn: boolean;
  micForwarding: boolean;
  onTalk: () => void;
  onEnd: () => void;
  onReconnect: () => void;
};

const STATUS: Record<AvatarPhase, string> = {
  connecting: "Opening a window in time…",
  preparing: "Bringing the local to life…",
  ready: "Ready to talk",
  starting: "Getting their attention…",
  live: "Live — just speak",
  closed: "Gone quiet",
  fallback: "Voice only",
};

/**
 * Controls + transcript for the talking avatar.
 * @param props see AvatarHudProps
 */
export function AvatarHud(props: AvatarHudProps) {
  const { firstName, phase, error, notice, lines, secondsLeft, micOn, micForwarding, onTalk, onEnd, onReconnect } = props;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  /** Main button handler, depending on phase. */
  const onMain = () => {
    log.info("AvatarHud.onMain", { phase });
    if (phase === "live" || phase === "starting") onEnd();
    else if (phase === "closed") onReconnect();
    else if (phase === "ready") onTalk();
  };

  const inCall = phase === "live" || phase === "starting";
  const busy = phase === "connecting" || phase === "preparing";
  const label = inCall ? "End conversation" : phase === "closed" ? `Wake ${firstName}` : busy ? "Please wait…" : `Talk to ${firstName}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-amber-100/70">
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              phase === "live" ? "animate-pulse bg-emerald-400" : busy || phase === "starting" ? "animate-pulse bg-amber-300" : phase === "ready" ? "bg-amber-400" : "bg-white/30"
            }`}
          />
          {STATUS[phase]}
        </span>
        {phase === "live" && secondsLeft !== null && <span className="tabular-nums">{secondsLeft}s</span>}
      </div>

      <button
        type="button"
        onClick={onMain}
        disabled={busy}
        className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold tracking-wide transition disabled:cursor-wait disabled:opacity-50 ${
          inCall ? "border border-red-400/50 bg-red-500/20 text-red-100 hover:bg-red-500/30" : "bg-amber-400 text-black hover:bg-amber-300"
        }`}
      >
        {label}
      </button>

      {inCall && (
        <div className="flex items-center gap-2 text-[11px] text-amber-100/60">
          <span className={`h-1.5 w-1.5 rounded-full ${micOn && micForwarding ? "bg-emerald-400" : micOn ? "bg-amber-300" : "bg-red-400"}`} />
          {micOn ? (micForwarding ? "Mic on — they can hear you" : "Mic on — connecting…") : "Mic off"}
        </div>
      )}

      {error && <div className="rounded bg-red-500/10 px-3 py-1.5 text-xs text-red-200">{error}</div>}
      {notice && !error && <div className="rounded bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100/80">{notice}</div>}

      <div ref={scrollRef} className="min-h-[60px] flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
        {lines.length === 0 && (
          <p className="text-xs text-amber-100/50">
            Ask about food, prices, gossip, the weather, who is in charge… {firstName} won&apos;t say where or when you
            are, but will drop clues.
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={l.who === "you" ? "text-right" : ""}>
            <span
              className={`inline-block max-w-[90%] rounded-2xl px-3 py-1.5 ${l.who === "you" ? "bg-white/10 text-white/80" : "bg-amber-400/15 text-amber-50"} ${
                l.final ? "" : "opacity-60"
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
