"use client";
/**
 * WorldHud — overlay for the walkable world: session status pill, seconds left, key hints.
 *
 * Shared by the live Reactor world and mock mode so both look the same. It is purely
 * presentational: WorldView passes in the phase (from useWorldSession, or "mock") and the countdown.
 * Never shows the scene's place or year.
 *
 * Reconnect: when WorldView passes `reconnect` (live mode, session ended / errored), a centred
 * "Reopen the portal" button (dark glass, thin cream border, tiny letter-spaced caps — the game HUD
 * style) offers a fresh session for the same scene, with the remaining count and the R shortcut.
 * Once the per-round budget (REACTOR.maxReconnectsPerRound) is spent it is replaced by a
 * non-interactive "The portal is spent — make your guess" note. Never shown in mock mode.
 */
import { useEffect } from "react";
import { REACTOR } from "@/lib/config";
import { log } from "@/lib/log";

/** Every visible state of the world view. */
export type WorldPhase = "mock" | "connecting" | "staging" | "live" | "ended" | "error";

type Props = {
  phase: WorldPhase;
  /** Seconds left in the explore cap (live mode). */
  secondsLeft?: number;
  /** Connect retry counter (0 = first attempt). */
  retry?: number;
  /** True while Reactor queues us for a GPU (status "waiting"). */
  waitingForGpu?: boolean;
  /** Short reason shown when ended / error. */
  message?: string | null;
  /** Reconnect affordance (ended / error in live mode only); omit to hide it. */
  reconnect?: { left: number; onReconnect: () => void };
};

/**
 * Returns the status-pill label for a phase.
 * @param p HUD props
 * @returns label text
 */
function label({ phase, secondsLeft, retry = 0, waitingForGpu, message }: Props): string {
  switch (phase) {
    case "mock":
      return "Mock mode · still image";
    case "connecting":
      if (retry > 0) return `Time machines busy — retrying (${retry}/${REACTOR.connectRetries})…`;
      return waitingForGpu ? "Waiting for a GPU…" : "Opening a portal…";
    case "staging":
      return "Materialising the world…";
    case "live":
      return `LIVE · ${secondsLeft ?? 0}s`;
    case "ended":
      return `Portal closed${message ? ` · ${message}` : ""}`;
    case "error":
      return `World unavailable${message ? ` · ${message}` : ""}`;
  }
}

/**
 * Renders the HUD overlay (status pill top-left, key hints bottom-centre while walkable).
 * @param props see Props
 */
export function WorldHud(props: Props) {
  const { phase } = props;
  // Logged per phase change rather than per render (the countdown re-renders twice a second).
  useEffect(() => log.info("WorldHud", { phase, message: props.message, retry: props.retry }), [phase, props.message, props.retry]);
  const dot =
    phase === "live"
      ? "bg-red-500 animate-pulse"
      : phase === "error"
        ? "bg-red-800"
        : phase === "ended" || phase === "mock"
          ? "bg-stone-400"
          : "bg-amber-400 animate-pulse";
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 flex max-w-[80%] items-center gap-2 rounded-full bg-black/60 px-3 py-1 font-mono text-xs text-white/80 backdrop-blur">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label(props)}</span>
      </div>
      {(phase === "live" || phase === "mock") && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 font-mono text-[11px] text-white/70 backdrop-blur">
          {phase === "live" ? "WASD walk · ←↑→↓ look" : "Live world off — look closely for clues"}
        </div>
      )}
      {(phase === "ended" || phase === "error") && props.reconnect && <ReconnectButton {...props.reconnect} />}
    </>
  );
}

/**
 * Centred "Reopen the portal" button, or the "portal is spent" note once no reconnects are left.
 * Deliberately avoids the `left-3 top-3` / `bottom-3` classes that app/globals.css repositions.
 * @param props left = reconnects remaining this round; onReconnect = start a fresh session
 */
function ReconnectButton({ left, onReconnect }: { left: number; onReconnect: () => void }) {
  useEffect(() => log.info("ReconnectButton", { left }), [left]);
  if (left <= 0) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center">
        <div className="hg-glass rounded-full px-5 py-2">
          <span className="hg-label !text-cream/80">The portal is spent — make your guess</span>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center">
      <button
        type="button"
        onClick={onReconnect}
        className="hg-rise hg-glass pointer-events-auto flex flex-col items-center gap-1 rounded-full px-6 py-2.5 transition hover:border-cream/50 hover:bg-black/60"
      >
        <span className="hg-label !text-cream">Reopen the portal</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-cream/50">
          Press {REACTOR.reconnectKey.toUpperCase()} · {left} left
        </span>
      </button>
    </div>
  );
}
