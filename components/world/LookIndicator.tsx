"use client";
/**
 * LookIndicator — a small compass / heading bar in the world HUD showing where the camera points
 * relative to the scene's starting view (the landmark straight ahead).
 *
 * Fits the look-limit feature (lib/look-limit.ts + useWasdControls): the arrow keys may only turn
 * the camera ±REACTOR.maxYawDeg left/right and ±REACTOR.maxPitchDeg up/down so the world model never
 * loses the landmark. This indicator makes that limit legible instead of feeling like a broken key:
 *  - a thin cream horizontal scale spanning −max…+max yaw, with a centre diamond (straight ahead),
 *  - a marker sliding along it at the current yaw,
 *  - a tiny vertical scale on the right for pitch,
 *  - end ticks light up in brass when that limit is reached.
 * Purely presentational: WorldView (live mode only) passes `look` from useWasdControls. Styled like the
 * rest of the HUD (dark glass `.hg-glass`, thin cream lines, tiny letter-spaced caps `.hg-label`).
 * Positioned top-centre below the key hints; it deliberately avoids the `left-3 top-3` / `bottom-3`
 * class combos that app/globals.css `.hg-world` rules reposition. Never shows place or year.
 */
import { useEffect } from "react";
import { REACTOR } from "@/lib/config";
import { log } from "@/lib/log";
import { limitFlags } from "@/lib/look-limit";
import type { LookState } from "./useWasdControls";

const W = 132; // yaw scale width (px)
const H = 22; // pitch scale height (px)
const CREAM = "rgba(245,236,215,0.55)";
const CREAM_DIM = "rgba(245,236,215,0.25)";
const BRASS = "#e0a530";

/**
 * Renders the heading indicator.
 * @param props `look` = accumulated yaw/pitch in degrees (right / up positive)
 */
export function LookIndicator({ look }: { look: LookState }) {
  const lim = limitFlags(look.yaw, look.pitch, REACTOR.maxYawDeg, REACTOR.maxPitchDeg);
  const atAny = lim.left || lim.right || lim.up || lim.down;
  useEffect(() => log.info("LookIndicator", { atLimit: atAny }), [atAny]);
  const clampN = (v: number, m: number) => Math.max(-1, Math.min(1, v / m));
  const x = (W / 2) * (1 + clampN(look.yaw, REACTOR.maxYawDeg));
  const y = (H / 2) * (1 - clampN(look.pitch, REACTOR.maxPitchDeg));

  return (
    <div
      className="hg-glass pointer-events-none absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-3 py-1"
      aria-label="Camera heading"
    >
      <span className={`hg-label !text-[9px] ${atAny ? "!text-[#e0a530]" : ""}`}>{atAny ? "Limit" : "Ahead"}</span>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke={CREAM_DIM} strokeWidth={1} />
        {[0.25, 0.75].map((f) => (
          <line key={f} x1={W * f} y1={H / 2 - 2} x2={W * f} y2={H / 2 + 2} stroke={CREAM_DIM} strokeWidth={1} />
        ))}
        <line x1={0.5} y1={H / 2 - 5} x2={0.5} y2={H / 2 + 5} stroke={lim.left ? BRASS : CREAM} strokeWidth={lim.left ? 2 : 1} />
        <line x1={W - 0.5} y1={H / 2 - 5} x2={W - 0.5} y2={H / 2 + 5} stroke={lim.right ? BRASS : CREAM} strokeWidth={lim.right ? 2 : 1} />
        <path d={`M ${W / 2} ${H / 2 - 3} l 3 3 l -3 3 l -3 -3 z`} fill="none" stroke={CREAM} strokeWidth={1} />
        <line x1={x} y1={2} x2={x} y2={H - 2} stroke="#f5ecd7" strokeWidth={1.5} />
      </svg>
      <svg width={6} height={H} viewBox={`0 0 6 ${H}`}>
        <line x1={3} y1={0} x2={3} y2={H} stroke={CREAM_DIM} strokeWidth={1} />
        <line x1={0} y1={0.5} x2={6} y2={0.5} stroke={lim.up ? BRASS : CREAM} strokeWidth={lim.up ? 2 : 1} />
        <line x1={0} y1={H - 0.5} x2={6} y2={H - 0.5} stroke={lim.down ? BRASS : CREAM} strokeWidth={lim.down ? 2 : 1} />
        <circle cx={3} cy={y} r={1.8} fill="#f5ecd7" />
      </svg>
    </div>
  );
}
