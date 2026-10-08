"use client";
/**
 * TopBar — the thin header shown during rounds and reveals.
 *
 * How it fits the architecture: components/game/RoundScreen.tsx and RevealScreen.tsx render it at
 * the top of the screen so the player always sees the game name, "Round i / N" and their running
 * total score. It deliberately shows nothing scene-specific (no title, place or year), so it is safe
 * to render before the guess.
 */
import { log } from "@/lib/log";
import { formatPoints } from "@/lib/scoring";

export type TopBarProps = {
  /** 0-based index of the current round. */
  roundIndex: number;
  totalRounds: number;
  totalScore: number;
};

/**
 * Renders the header bar.
 * @param props see TopBarProps
 */
export function TopBar({ roundIndex, totalRounds, totalScore }: TopBarProps) {
  log.info("TopBar", { roundIndex, totalRounds, totalScore });
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-amber-200/10 bg-black/40 px-4">
      <span className="font-display text-sm tracking-[0.25em] text-amber-200">HISTORY GUESSER</span>
      <div className="flex items-center gap-6 text-sm">
        <span className="text-amber-100/70">
          Round <span className="font-display text-amber-300">{roundIndex + 1}</span> / {totalRounds}
        </span>
        <span className="text-amber-100/70">
          Score <span className="font-display text-amber-300">{formatPoints(totalScore)}</span>
        </span>
      </div>
    </header>
  );
}
