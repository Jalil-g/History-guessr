"use client";
/**
 * SummaryScreen — the end of a game: big counting total, one row per round, "Play again".
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "summary" phase with
 * every RoundResult collected during the game (lib/scoring.ts). "Play again" (or Enter) calls
 * `onPlayAgain`, which returns the game loop to the intro screen with fresh state.
 *
 * Look: full-bleed blurred backdrop of the last scene played (SceneBackdrop), the grand total counting
 * up (CountUp) out of rounds × 10 000, then a glass list: per round the scene title, true place & year,
 * the player's distance and year error, points per axis and a thin bar of the round total.
 */
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import { formatKm, formatPoints, type RoundResult } from "@/lib/scoring";
import { formatEra } from "@/lib/timeline";
import { CountUp } from "./CountUp";
import { SceneBackdrop } from "./SceneBackdrop";
import { Logo } from "./TopBar";
import { useGameKeys } from "./useGameKeys";

export type SummaryScreenProps = {
  results: RoundResult[];
  onPlayAgain: () => void;
};

/**
 * Renders the end-of-game summary.
 * @param props see SummaryScreenProps
 */
export function SummaryScreen({ results, onPlayAgain }: SummaryScreenProps) {
  log.info("SummaryScreen", { rounds: results.length });
  useGameKeys({ enter: onPlayAgain });
  const total = results.reduce((s, r) => s + r.total, 0);
  const perRound = GAME.maxPointsPerAxis * 2;
  const max = results.length * perRound;
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <SceneBackdrop sceneId={results[results.length - 1]?.scene.id} blur dim={0.7} />
      <div className="absolute left-6 top-5 z-10">
        <Logo />
      </div>

      <div className="relative z-10 h-full overflow-y-auto px-6 pb-12 pt-24">
        <div className="mx-auto w-full max-w-4xl">
          <p className="hg-label hg-rise text-center">Your journey through time</p>
          <h1 className="hg-rise mt-4 text-center font-display text-7xl tabular-nums text-cream drop-shadow-[0_4px_30px_rgba(0,0,0,0.7)]">
            <CountUp value={total} delayMs={300} />
          </h1>
          <p className="hg-label mt-3 text-center !text-cream/50">out of {formatPoints(max)} points</p>

          <ol className="hg-glass hg-rise mt-10 divide-y divide-cream/10" style={{ animationDelay: "250ms" }}>
            {results.map((r, i) => (
              <li key={r.scene.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4">
                <span className="font-mono text-xs text-cream/40">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <div className="truncate font-display text-base tracking-wide text-cream">{r.scene.title}</div>
                  <div className="hg-label mt-1 truncate !text-[9px] !text-cream/50">
                    {r.scene.answer.place} · {formatEra(r.scene.answer.year)} — {formatKm(r.distanceKm)} · {r.yearDiff.toLocaleString("en-US")} yr off
                  </div>
                  <div className="mt-2 h-[2px] bg-cream/10">
                    <div className="h-full bg-cream/80" style={{ width: `${(r.total / perRound) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl tabular-nums text-cream">{formatPoints(r.total)}</div>
                  <div className="font-mono text-[10px] text-cream/45">
                    {formatPoints(r.locationPoints)} + {formatPoints(r.yearPoints)}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={onPlayAgain}
              className="group flex items-center gap-4 border border-cream/70 bg-cream/5 px-10 py-3 backdrop-blur transition hover:bg-cream hover:text-ink"
            >
              <span className="font-mono text-xs tracking-[0.4em]">PLAY AGAIN</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
