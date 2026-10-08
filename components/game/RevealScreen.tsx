"use client";
/**
 * RevealScreen — the dramatic answer to one round, shown right after the guess.
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "reveal" phase with
 * the RoundResult from lib/scoring.ts `scoreRound`. By the time it mounts, RoundScreen (and with it
 * the paid WorldView / LocalPanel sessions) has unmounted — the backdrop here is just the still image.
 *
 * Layout (cinematic, same HUD language as the round):
 *  - full-bleed backdrop: the scene's first frame, dimmed (SceneBackdrop), TopBar on top
 *  - left: a large parchment map (LazyGuessMap in reveal mode) — your pin, the answer pin and a dotted
 *    line between them; the map flies to fit both
 *  - right column: "The answer" label, scene title (serif display), place · year (first time any of
 *    these are visible), the reveal text, then PLACE and YEAR points counting up (CountUp, staggered)
 *    with thin progress bars and distance / year-error details, the round total, the H.G. Wells quote
 *    in an elegant italic serif card with chapter citation, and the NEXT ROUND / SEE RESULTS button
 *  - Space / Enter also advance (useGameKeys)
 */
import { LazyGuessMap } from "@/components/guess/LazyGuessMap";
import { GAME, UI } from "@/lib/config";
import { log } from "@/lib/log";
import { formatKm, type RoundResult } from "@/lib/scoring";
import { formatEra } from "@/lib/timeline";
import { CountUp, useCountUp } from "./CountUp";
import { SceneBackdrop } from "./SceneBackdrop";
import { TopBar } from "./TopBar";
import { useGameKeys } from "./useGameKeys";

export type RevealScreenProps = {
  result: RoundResult;
  roundIndex: number;
  totalRounds: number;
  totalScore: number;
  isLast: boolean;
  onNext: () => void;
};

/**
 * One animated score line: label, detail, counting points and a thin bar.
 * @param props.label axis name
 * @param props.detail human-readable difference
 * @param props.points points earned on this axis
 * @param props.delayMs count-up delay
 */
function ScoreRow({ label, detail, points, delayMs }: { label: string; detail: string; points: number; delayMs: number }) {
  log.info("RevealScreen.ScoreRow", { label, detail, points });
  const v = useCountUp(points, delayMs);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="hg-label !text-cream">{label}</span>
        <span className="font-display text-2xl tabular-nums text-cream">{v.toLocaleString("en-US")}</span>
      </div>
      <div className="mt-1.5 h-[3px] bg-cream/10">
        <div className="h-full bg-cream shadow-[0_0_10px_rgba(245,236,215,0.6)]" style={{ width: `${(v / GAME.maxPointsPerAxis) * 100}%` }} />
      </div>
      <div className="hg-label mt-1.5 !text-[9px] !text-cream/45">{detail}</div>
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
  useGameKeys({ " ": onNext, enter: onNext });
  const yearDetail =
    result.yearDiff === 0 ? `You said ${formatEra(guess.year)} — exact!` : `You said ${formatEra(guess.year)} · ${result.yearDiff.toLocaleString("en-US")} yr off`;

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <SceneBackdrop sceneId={scene.id} dim={0.62} />
      <TopBar roundIndex={roundIndex} totalRounds={totalRounds} totalScore={totalScore} />

      <div className="absolute inset-0 flex gap-8 px-6 pb-6 pt-24 max-lg:flex-col max-lg:overflow-y-auto">
        <section className="hg-rise relative min-h-[320px] flex-1 overflow-hidden border border-cream/30 shadow-[0_20px_80px_rgba(0,0,0,0.6)]">
          <LazyGuessMap pin={{ lat: guess.lat, lng: guess.lng }} answer={{ lat: scene.answer.lat, lng: scene.answer.lng }} />
          <div className="pointer-events-none absolute left-3 top-3 z-[500] border border-cream/20 bg-black/70 px-3 py-1.5 backdrop-blur">
            <span className="hg-label !text-cream">{formatKm(result.distanceKm)} away</span>
          </div>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto pr-1 lg:w-[420px]">
          <div className="hg-rise" style={{ animationDelay: "150ms" }}>
            <div className="hg-label !text-brass">Round {roundIndex + 1} · The answer</div>
            <h2 className="mt-2 font-display text-3xl leading-tight text-cream">{scene.title}</h2>
            <div className="hg-label mt-2 !text-cream/75">
              {scene.answer.place} <span className="text-cream/35">·</span> {formatEra(scene.answer.year)}
            </div>
            <p className="mt-3 font-serif text-lg leading-snug text-cream/85">{scene.reveal}</p>
          </div>

          <div className="hg-glass hg-rise space-y-4 p-5" style={{ animationDelay: "300ms" }}>
            <ScoreRow label="Place" detail={`${formatKm(result.distanceKm)} from the answer`} points={result.locationPoints} delayMs={500} />
            <ScoreRow label="Year" detail={yearDetail} points={result.yearPoints} delayMs={500 + UI.countUpStaggerMs} />
            <div className="flex items-baseline justify-between border-t border-cream/15 pt-4">
              <span className="hg-label">Round total</span>
              <span className="font-display text-4xl tabular-nums text-cream">
                <CountUp value={result.total} delayMs={500} />
                <span className="ml-1 font-mono text-xs text-cream/40">/ {(GAME.maxPointsPerAxis * 2).toLocaleString("en-US")}</span>
              </span>
            </div>
          </div>

          <figure className="hg-rise relative border border-cream/20 bg-[#f5ecd7]/[0.06] px-6 py-5" style={{ animationDelay: "450ms" }}>
            <span className="pointer-events-none absolute -top-5 left-3 font-serif text-7xl leading-none text-cream/25">&ldquo;</span>
            <blockquote className="font-serif text-[19px] italic leading-snug text-cream/90">{scene.source.quote}</blockquote>
            <figcaption className="hg-label mt-3 !text-[9px] !tracking-[0.2em] !text-cream/50">
              H.G. Wells · <span className="italic normal-case tracking-normal">A Short History of the World</span> · {scene.source.chapter}
            </figcaption>
          </figure>

          <button
            type="button"
            onClick={onNext}
            className="hg-rise group mt-auto flex items-center justify-between border border-cream/50 bg-black/50 px-5 py-3.5 backdrop-blur transition hover:border-cream hover:bg-cream hover:text-ink"
            style={{ animationDelay: "600ms" }}
          >
            <span className="font-mono text-xs tracking-[0.3em]">{isLast ? "SEE RESULTS" : "NEXT ROUND"}</span>
            <span className="flex items-center gap-3">
              <span className="hg-label !text-[9px] !text-current opacity-50">Space</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}
