"use client";
/**
 * RevealScreen — the answer to one round, shown right after the guess.
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "reveal" phase with
 * the RoundResult from lib/scoring.ts `scoreRound`. By the time it mounts, RoundScreen (and with it
 * the paid WorldView / VoiceChat sessions) has unmounted.
 *
 * Shows:
 *  - LazyGuessMap in reveal mode: guess pin, answer pin and a dashed line between them
 *  - distance and year difference, with points per axis and the round total
 *  - the scene title, place, true year and `reveal` text (first time any of these are visible)
 *  - the book citation: From H.G. Wells, A Short History of the World — <chapter>: “<quote>”
 *  - a Next round / See results button calling `onNext`
 */
import { LazyGuessMap } from "@/components/guess/LazyGuessMap";
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import { formatKm, formatPoints, formatYear, type RoundResult } from "@/lib/scoring";
import { TopBar } from "./TopBar";

export type RevealScreenProps = {
  result: RoundResult;
  roundIndex: number;
  totalRounds: number;
  totalScore: number;
  isLast: boolean;
  onNext: () => void;
};

/**
 * One score line: label, detail and points with a proportional bar.
 * @param props.label axis name
 * @param props.detail human-readable difference
 * @param props.points points earned on this axis
 */
function ScoreRow({ label, detail, points }: { label: string; detail: string; points: number }) {
  log.info("RevealScreen.ScoreRow", { label, detail, points });
  const pct = (points / GAME.maxPointsPerAxis) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-amber-100/70">
          {label} <span className="text-amber-100/40">· {detail}</span>
        </span>
        <span className="font-display text-amber-300">{formatPoints(points)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-amber-100/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-700 to-amber-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Renders the reveal for one round.
 * @param props see RevealScreenProps
 */
export function RevealScreen({ result, roundIndex, totalRounds, totalScore, isLast, onNext }: RevealScreenProps) {
  const { scene, guess } = result;
  log.info("RevealScreen", { sceneId: scene.id, roundIndex, total: result.total });
  return (
    <div className="flex h-screen flex-col">
      <TopBar roundIndex={roundIndex} totalRounds={totalRounds} totalScore={totalScore} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <section className="min-h-[280px] flex-1 overflow-hidden rounded-lg border border-amber-200/10">
          <LazyGuessMap pin={{ lat: guess.lat, lng: guess.lng }} answer={{ lat: scene.answer.lat, lng: scene.answer.lng }} />
        </section>

        <aside className="flex shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-amber-200/15 bg-amber-50/[0.03] p-5 lg:w-[420px]">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/70">
              {scene.answer.place} · {formatYear(scene.answer.year)}
            </p>
            <h2 className="mt-1 font-display text-2xl leading-tight text-amber-100">{scene.title}</h2>
            <p className="mt-2 font-serif text-lg leading-snug text-amber-100/80">{scene.reveal}</p>
          </div>

          <div className="space-y-3 rounded-md border border-amber-200/10 bg-black/30 p-4">
            <ScoreRow label="Place" detail={`${formatKm(result.distanceKm)} away`} points={result.locationPoints} />
            <ScoreRow
              label="Year"
              detail={`you said ${formatYear(guess.year)}, ${result.yearDiff === 0 ? "exact!" : `${result.yearDiff.toLocaleString("en-US")} yr off`}`}
              points={result.yearPoints}
            />
            <div className="flex items-baseline justify-between border-t border-amber-200/10 pt-3">
              <span className="text-sm uppercase tracking-widest text-amber-100/60">Round</span>
              <span className="font-display text-2xl text-amber-200">
                {formatPoints(result.total)}
                <span className="text-sm text-amber-100/40"> / {formatPoints(GAME.maxPointsPerAxis * 2)}</span>
              </span>
            </div>
          </div>

          <figure className="border-l-2 border-amber-600/60 pl-4">
            <blockquote className="font-serif text-lg italic leading-snug text-amber-100/85">&ldquo;{scene.source.quote}&rdquo;</blockquote>
            <figcaption className="mt-2 text-xs text-amber-100/50">
              From H.G. Wells, <i>A Short History of the World</i> — {scene.source.chapter}
            </figcaption>
          </figure>

          <button
            type="button"
            onClick={onNext}
            className="mt-auto rounded-md border border-amber-400/70 bg-gradient-to-b from-amber-500 to-amber-700 py-2.5 font-display tracking-widest text-stone-950 transition hover:from-amber-400 hover:to-amber-600"
          >
            {isLast ? "SEE RESULTS" : "NEXT ROUND"}
          </button>
        </aside>
      </div>
    </div>
  );
}
