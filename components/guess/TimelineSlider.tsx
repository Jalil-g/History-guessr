"use client";
/**
 * TimelineSlider — the "2 · TIME" half of a guess: a wide ruler-style year picker.
 *
 * How it fits the architecture: components/game/RoundScreen.tsx owns the guessed year and renders this
 * control bottom-centre of the HUD. On submit the year goes, with the map pin, into lib/scoring.ts
 * `scoreRound`. The year ↔ position mapping is NON-LINEAR (lib/timeline.ts, anchors in lib/config.ts
 * TIMELINE): ancient millennia are compressed and recent centuries stretched, so 1789 is as easy to hit
 * as 2500 BCE is roughly.
 *
 * Look: a dark sepia track with many thin tick marks (minor / major / labelled — "3,000 BCE", "0 CE",
 * "2,026 CE"…), a round cream thumb with a vertical hairline through the track, and the selected year
 * floating above the thumb.
 *
 * Interaction:
 *  - pointer: press anywhere on the ruler and drag (pointer capture, works with mouse and touch)
 *  - keyboard (when the slider has focus): ←/→ ±TIMELINE.keyStep years, Shift+←/→ ±keyStepLarge,
 *    Home/End jump to the ends. Arrow events are stopped here so they don't also turn the camera in the
 *    walkable world (which listens on window). Without focus, arrows belong to the world.
 *  - exposes role="slider" with aria-valuenow / aria-valuetext for assistive tech
 */
import { useMemo, useRef } from "react";
import { GAME, TIMELINE } from "@/lib/config";
import { log } from "@/lib/log";
import { clampYear, formatEra, posToYear, timelineTicks, yearToPos } from "@/lib/timeline";

export type TimelineSliderProps = {
  value: number;
  onChange: (year: number) => void;
};

/**
 * Renders the ruler slider.
 * @param props see TimelineSliderProps
 */
export function TimelineSlider({ value, onChange }: TimelineSliderProps) {
  log.info("TimelineSlider", { value });
  const trackRef = useRef<HTMLDivElement>(null);
  const ticks = useMemo(() => timelineTicks(), []);
  const pos = yearToPos(value);

  /**
   * Converts a pointer x coordinate to a year and reports it.
   * @param clientX pointer x in viewport pixels
   */
  function setFromPointer(clientX: number) {
    log.info("TimelineSlider.setFromPointer", { clientX });
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.round(((clientX - r.left) / r.width) * TIMELINE.resolution) / TIMELINE.resolution;
    onChange(clampYear(posToYear(p)));
  }

  /**
   * Keyboard nudges while focused (arrows never leak to the world controls).
   * @param e key event
   */
  function handleKey(e: React.KeyboardEvent) {
    log.info("TimelineSlider.handleKey", { key: e.key, shift: e.shiftKey });
    const step = e.shiftKey ? TIMELINE.keyStepLarge : TIMELINE.keyStep;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + step;
    else if (e.key === "Home") next = GAME.minYear;
    else if (e.key === "End") next = GAME.maxYear;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    onChange(clampYear(next));
  }

  return (
    <div className="w-full select-none">
      <div className="mb-2 flex items-baseline gap-3">
        <span className="hg-label !text-cream">2&nbsp;&nbsp;Time</span>
        <span className="hg-label !text-cream/45">Drag the timeline</span>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Guessed year"
        aria-valuemin={GAME.minYear}
        aria-valuemax={GAME.maxYear}
        aria-valuenow={value}
        aria-valuetext={formatEra(value)}
        onKeyDown={handleKey}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) setFromPointer(e.clientX);
        }}
        className="hg-slider group relative cursor-ew-resize touch-none px-0 pb-6 pt-9"
      >
        {/* Track */}
        <div ref={trackRef} className="relative h-9 border border-cream/25 bg-gradient-to-b from-[#3d2c1b]/90 to-[#24180e]/90 shadow-[inset_0_1px_0_rgba(245,236,215,0.08)] backdrop-blur-sm transition group-hover:border-cream/45">
          {/* Filled portion */}
          <div className="absolute inset-y-0 left-0 bg-cream/[0.07]" style={{ width: `${pos * 100}%` }} />
          {/* Ticks */}
          {ticks.map((t) => (
            <div
              key={t.year}
              className={`absolute bottom-0 w-px ${t.kind === "label" ? "h-full bg-cream/70" : t.kind === "major" ? "h-1/2 bg-cream/45" : "h-1/4 bg-cream/25"}`}
              style={{ left: `${t.pos * 100}%` }}
            />
          ))}
          {/* Thumb */}
          <div className="pointer-events-none absolute inset-y-[-10px] w-0" style={{ left: `${pos * 100}%` }}>
            <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-cream" />
            <div className="absolute left-0 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 bg-cream shadow-[0_0_0_4px_rgba(245,236,215,0.15),0_4px_14px_rgba(0,0,0,0.6)] transition-transform group-active:scale-110" />
          </div>
        </div>
        {/* Readout above the thumb */}
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap font-display text-lg tracking-wider text-cream drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]"
          style={{ left: `clamp(48px, ${pos * 100}%, calc(100% - 48px))` }}
        >
          {formatEra(value)}
        </div>
        {/* Labels under the ruler */}
        {ticks
          .filter((t) => t.kind === "label")
          .map((t) => (
            <span
              key={t.year}
              className={`hg-label absolute bottom-0 whitespace-nowrap !text-[9px] !tracking-[0.18em] ${t.pos === 0 ? "" : t.pos === 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${t.pos * 100}%` }}
            >
              {formatEra(t.year)}
            </span>
          ))}
      </div>
    </div>
  );
}
