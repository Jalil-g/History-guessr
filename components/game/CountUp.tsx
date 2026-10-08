"use client";
/**
 * CountUp — an animated number that counts from 0 to its target (ease-out), for the dramatic score
 * reveal.
 *
 * How it fits the architecture: components/game/RevealScreen.tsx counts up the place and year points
 * (staggered by UI.countUpStaggerMs) and the round total; components/game/SummaryScreen.tsx counts up
 * the game total. Duration comes from UI.countUpMs (lib/config.ts). Respects prefers-reduced-motion
 * by jumping straight to the target.
 *
 * Use cases:
 *  - `useCountUp(target, delayMs)`  the animated value, for custom rendering (e.g. progress bars)
 *  - `<CountUp value delayMs />`     a formatted number ("7,412")
 */
import { useEffect, useState } from "react";
import { UI } from "@/lib/config";
import { log } from "@/lib/log";
import { formatPoints } from "@/lib/scoring";

/**
 * Animates a number from 0 to `target`.
 * @param target final value
 * @param delayMs wait before starting
 * @returns the current (rounded) value
 */
export function useCountUp(target: number, delayMs = 0): number {
  log.info("useCountUp", { target, delayMs });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const timer = window.setTimeout(() => {
      /** One animation frame. @param t timestamp */
      const step = (t: number) => {
        if (!start) start = t;
        const k = Math.min(1, (t - start) / UI.countUpMs);
        setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, delayMs]);
  return v;
}

/**
 * Renders an animated, thousands-separated number.
 * @param props.value target value
 * @param props.delayMs wait before counting
 */
export function CountUp({ value, delayMs = 0 }: { value: number; delayMs?: number }) {
  log.info("CountUp", { value, delayMs });
  const v = useCountUp(value, delayMs);
  return <>{formatPoints(v)}</>;
}
