/**
 * Timeline — the non-linear year scale behind the "2 · TIME" ruler slider.
 *
 * Why it exists: a linear slider from 3000 BCE to 2026 CE makes modern years nearly impossible to
 * pick (one pixel ≈ ten years) while wasting space on millennia where scenes are sparse. Like
 * eraguessr.ai, we compress ancient history and stretch recent centuries. The scale is a
 * piecewise-linear function defined by TIMELINE.anchors in lib/config.ts: [position 0..1, year] pairs.
 *
 * How it fits the architecture: components/guess/TimelineSlider.tsx renders the ruler (track, ticks,
 * labels, thumb) and converts pointer positions with `posToYear`; it places the thumb with
 * `yearToPos`. The chosen year goes into lib/scoring.ts `scoreRound` unchanged (negative = BCE).
 *
 * Use cases:
 *  - `posToYear` / `yearToPos`  pointer ↔ year conversion, thumb placement
 *  - `timelineTicks`            ruler tick marks (minor / major / labelled) with their positions
 *  - `formatEra`                "3,000 BCE", "0 CE", "1,450 CE" for labels and the readout
 *  - `clampYear`                keyboard nudges stay inside GAME.minYear..GAME.maxYear
 * Pure functions, no I/O — safe on server and client.
 */
import { GAME, TIMELINE } from "./config";
import { log } from "./log";

/** One tick mark on the ruler. */
export type TimelineTick = {
  year: number;
  /** Position along the track, 0..1. */
  pos: number;
  /** "minor" short tick, "major" medium tick, "label" tall tick with text. */
  kind: "minor" | "major" | "label";
};

/**
 * Clamps a year into the playable range.
 * @param year candidate year (negative = BCE)
 * @returns year within GAME.minYear..GAME.maxYear
 */
export function clampYear(year: number): number {
  log.info("clampYear", { year });
  return Math.min(GAME.maxYear, Math.max(GAME.minYear, year));
}

/**
 * Converts a slider position to a year (piecewise-linear over TIMELINE.anchors).
 * @param pos position along the track, 0..1 (clamped)
 * @returns whole year, negative = BCE
 */
export function posToYear(pos: number): number {
  log.info("posToYear", { pos });
  const a = TIMELINE.anchors;
  const p = Math.min(1, Math.max(0, pos));
  for (let i = 1; i < a.length; i++) {
    const [p0, y0] = a[i - 1];
    const [p1, y1] = a[i];
    if (p <= p1) return Math.round(y0 + ((p - p0) / (p1 - p0)) * (y1 - y0));
  }
  return a[a.length - 1][1];
}

/**
 * Converts a year to its slider position (inverse of posToYear).
 * @param year year, negative = BCE (clamped to the anchor range)
 * @returns position along the track, 0..1
 */
export function yearToPos(year: number): number {
  log.info("yearToPos", { year });
  const a = TIMELINE.anchors;
  if (year <= a[0][1]) return a[0][0];
  for (let i = 1; i < a.length; i++) {
    const [p0, y0] = a[i - 1];
    const [p1, y1] = a[i];
    if (year <= y1) return p0 + ((year - y0) / (y1 - y0)) * (p1 - p0);
  }
  return a[a.length - 1][0];
}

/**
 * Minor tick spacing in force at a given year (TIMELINE.tickSteps).
 * @param year year
 * @returns step in years
 */
function tickStepAt(year: number): number {
  let step = TIMELINE.tickSteps[0][1];
  for (const [from, s] of TIMELINE.tickSteps) if (year >= from) step = s;
  return step;
}

/**
 * Generates every tick mark of the ruler, from GAME.minYear to GAME.maxYear.
 * Labelled years (TIMELINE.labelYears) are always included as "label" ticks.
 * @returns ticks sorted by year
 */
export function timelineTicks(): TimelineTick[] {
  log.info("timelineTicks", {});
  const labels = new Set<number>(TIMELINE.labelYears);
  const years = new Set<number>(labels);
  for (let y = GAME.minYear; y < GAME.maxYear; y += tickStepAt(y)) years.add(y);
  return [...years]
    .sort((x, y) => x - y)
    .map((year) => ({
      year,
      pos: yearToPos(year),
      kind: labels.has(year) ? "label" : year % TIMELINE.majorEvery === 0 ? "major" : "minor",
    }));
}

/**
 * Formats a year in the ruler's BCE / CE style.
 * @param year e.g. -3000, 0, 1450
 * @returns e.g. "3,000 BCE", "0 CE", "1,450 CE"
 */
export function formatEra(year: number): string {
  log.info("formatEra", { year });
  const n = Math.abs(year).toLocaleString("en-US");
  return year < 0 ? `${n} BCE` : `${n} CE`;
}
