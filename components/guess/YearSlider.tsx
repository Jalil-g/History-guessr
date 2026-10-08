"use client";
/**
 * YearSlider — the "when" half of a guess.
 *
 * How it fits the architecture: the round screen (components/game/RoundScreen.tsx) owns the guessed
 * year as state and renders this control under the guess map. On submit the year goes, together with
 * the map pin, into lib/scoring.ts `scoreRound`.
 *
 * Behaviour:
 *  - a range input spanning GAME.minYear..GAME.maxYear (lib/config.ts); negative years are BC
 *  - a large readout formatted with `formatYear` ("2560 BC", "AD 410")
 *  - fine-adjust buttons (−100, −10, −1, +1, +10, +100) for precise guesses, clamped to the range
 *  - arrow keys on the focused range input also step by one year (native behaviour)
 */
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import { formatYear } from "@/lib/scoring";

export type YearSliderProps = {
  value: number;
  onChange: (year: number) => void;
};

const STEPS = [-100, -10, -1, 1, 10, 100];

/**
 * Clamps a year into the slider range.
 * @param y candidate year
 * @returns year within GAME.minYear..GAME.maxYear
 */
function clampYear(y: number): number {
  log.info("clampYear", { y });
  return Math.min(GAME.maxYear, Math.max(GAME.minYear, y));
}

/**
 * Renders the year slider with readout and fine-adjust buttons.
 * @param props see YearSliderProps
 */
export function YearSlider({ value, onChange }: YearSliderProps) {
  log.info("YearSlider", { value });
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-amber-200/60">Year</span>
        <span className="font-display text-2xl text-amber-300">{formatYear(value)}</span>
      </div>
      <input
        type="range"
        aria-label="Guessed year"
        min={GAME.minYear}
        max={GAME.maxYear}
        step={1}
        value={value}
        onChange={(e) => onChange(clampYear(Number(e.target.value)))}
        className="w-full accent-amber-500"
      />
      <div className="flex justify-between text-[10px] text-amber-200/40">
        <span>{formatYear(GAME.minYear)}</span>
        <span>{formatYear(GAME.maxYear)}</span>
      </div>
      <div className="grid grid-cols-6 gap-1">
        {STEPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(clampYear(value + s))}
            className="rounded border border-amber-200/15 bg-amber-100/5 py-1 text-xs text-amber-100/80 transition hover:border-amber-400/50 hover:bg-amber-400/10"
          >
            {s > 0 ? `+${s}` : s}
          </button>
        ))}
      </div>
    </div>
  );
}
