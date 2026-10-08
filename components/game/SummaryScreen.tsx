"use client";
/**
 * SummaryScreen — the end of a game: per-round table, total score and "Play again".
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "summary" phase with
 * every RoundResult collected during the game (lib/scoring.ts). "Play again" calls `onPlayAgain`,
 * which returns the game loop to the intro screen with fresh state.
 *
 * Shows, per round: scene title, true place & year, the player's distance and year error, and the
 * points per axis; then the grand total out of rounds × 10 000.
 */
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import { formatKm, formatPoints, formatYear, type RoundResult } from "@/lib/scoring";

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
  const total = results.reduce((s, r) => s + r.total, 0);
  const max = results.length * GAME.maxPointsPerAxis * 2;
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-12">
      <div className="w-full max-w-4xl">
        <p className="text-center text-xs uppercase tracking-[0.4em] text-amber-400/70">Your journey through time</p>
        <h1 className="mt-2 text-center font-display text-5xl text-amber-100">{formatPoints(total)}</h1>
        <p className="mt-1 text-center text-sm text-amber-100/50">out of {formatPoints(max)} points</p>

        <div className="mt-8 overflow-x-auto rounded-lg border border-amber-200/15 bg-amber-50/[0.03]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-amber-200/10 text-xs uppercase tracking-wider text-amber-200/60">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Scene</th>
                <th className="px-4 py-3">Distance</th>
                <th className="px-4 py-3">Year off</th>
                <th className="px-4 py-3 text-right">Place</th>
                <th className="px-4 py-3 text-right">Year</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.scene.id} className="border-b border-amber-200/5 last:border-0">
                  <td className="px-4 py-3 font-display text-amber-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-display text-amber-100">{r.scene.title}</div>
                    <div className="text-xs text-amber-100/50">
                      {r.scene.answer.place} · {formatYear(r.scene.answer.year)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-amber-100/70">{formatKm(r.distanceKm)}</td>
                  <td className="px-4 py-3 text-amber-100/70">{r.yearDiff.toLocaleString("en-US")} yr</td>
                  <td className="px-4 py-3 text-right text-amber-100/80">{formatPoints(r.locationPoints)}</td>
                  <td className="px-4 py-3 text-right text-amber-100/80">{formatPoints(r.yearPoints)}</td>
                  <td className="px-4 py-3 text-right font-display text-amber-300">{formatPoints(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={onPlayAgain}
            className="rounded-md border border-amber-400/70 bg-gradient-to-b from-amber-500 to-amber-700 px-10 py-3 font-display text-lg tracking-widest text-stone-950 transition hover:from-amber-400 hover:to-amber-600"
          >
            PLAY AGAIN
          </button>
        </div>
      </div>
    </main>
  );
}
