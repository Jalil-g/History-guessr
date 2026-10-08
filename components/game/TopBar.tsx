"use client";
/**
 * TopBar — the transparent, cinematic header overlaid on the full-bleed scene (EraGuessr-style).
 *
 * How it fits the architecture: components/game/RoundScreen.tsx and RevealScreen.tsx render it absolutely
 * positioned at the top of the viewport, over the world / scene backdrop and its vignette.
 *  - top-left: the logo box (`Logo`: thin cream border, small emblem, serif small-caps "HISTORY GUESSER"),
 *    then "ROUND i OF N" in tiny wide-tracked caps with one thin progress segment per round underneath
 *    (past rounds dim cream, current bright, future faint)
 *  - top-right: "SCORE · n" and an optional slot (`right`) where the round screen puts its icon toolbar
 *    (components/game/HudToolbar.tsx)
 * It deliberately shows nothing scene-specific (no title, place or year), so it is safe before the guess.
 * `Logo` is exported for the intro / summary screens.
 */
import { log } from "@/lib/log";
import { formatPoints } from "@/lib/scoring";

export type TopBarProps = {
  /** 0-based index of the current round. */
  roundIndex: number;
  totalRounds: number;
  totalScore: number;
  /** Optional content on the far right (icon toolbar). */
  right?: React.ReactNode;
};

/**
 * The History Guesser wordmark in its thin-bordered box.
 * @param props.className extra classes
 */
export function Logo({ className = "" }: { className?: string }) {
  log.info("Logo", {});
  return (
    <div className={`flex items-center gap-2.5 border border-cream/35 bg-black/20 px-3 py-2 backdrop-blur-sm ${className}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-cream/90" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 5v7l4 3" />
        <path d="M2 12h2M20 12h2M12 2v1.5M12 20.5V22" />
      </svg>
      <span className="font-display text-[13px] tracking-[0.22em] text-cream [font-variant:small-caps]">History Guesser</span>
    </div>
  );
}

/**
 * Renders the overlaid header.
 * @param props see TopBarProps
 */
export function TopBar({ roundIndex, totalRounds, totalScore, right }: TopBarProps) {
  log.info("TopBar", { roundIndex, totalRounds, totalScore });
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-6 pt-5">
      <div className="pointer-events-auto flex items-start gap-6">
        <Logo />
        <div className="pt-1">
          <div className="hg-label">
            Round <span className="text-cream">{roundIndex + 1}</span> of {totalRounds}
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: totalRounds }, (_, i) => (
              <div
                key={i}
                className={`h-[3px] w-7 transition-colors duration-500 ${
                  i === roundIndex ? "bg-cream shadow-[0_0_8px_rgba(245,236,215,0.7)]" : i < roundIndex ? "bg-cream/45" : "bg-cream/15"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="pointer-events-auto flex items-center gap-5">
        <div className="hg-label">
          Score <span className="text-cream/40">·</span> <span className="text-cream">{formatPoints(totalScore)}</span>
        </div>
        {right}
      </div>
    </header>
  );
}
