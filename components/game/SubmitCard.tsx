"use client";
/**
 * SubmitCard — the "3 · LOCATION + YEAR NEEDED" card in the bottom-right of the round HUD, which is
 * itself the submit button.
 *
 * How it fits the architecture: components/game/RoundScreen.tsx renders it next to the mini-map and the
 * timeline and passes the current pin + year. States:
 *  - no pin:   dim card, body "Location + year needed", footer "DROP PIN →", disabled
 *  - pin set:  bright card, body shows "Pin placed" + the chosen year (formatEra), footer "GUESS →",
 *              hover lifts the border; click (or Space / Enter anywhere, see useGameKeys) submits
 * Never shows anything about the answer.
 */
import { log } from "@/lib/log";
import type { LatLng } from "@/lib/scoring";
import { formatEra } from "@/lib/timeline";

export type SubmitCardProps = {
  pin: LatLng | null;
  year: number;
  onSubmit: () => void;
};

/**
 * Renders the submit card.
 * @param props see SubmitCardProps
 */
export function SubmitCard({ pin, year, onSubmit }: SubmitCardProps) {
  log.info("SubmitCard", { hasPin: !!pin, year });
  const ready = !!pin;
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onSubmit}
      className={`group flex w-[min(260px,22vw)] flex-col border text-left backdrop-blur-md transition duration-300 ${
        ready
          ? "border-cream/45 bg-black/55 hover:-translate-y-0.5 hover:border-cream hover:bg-black/70 hover:shadow-[0_0_30px_rgba(245,236,215,0.15)]"
          : "cursor-not-allowed border-cream/15 bg-black/40"
      }`}
    >
      <div className="px-4 pb-3 pt-3.5">
        <div className="hg-label !text-cream">3&nbsp;&nbsp;{ready ? "Ready" : "Location + year needed"}</div>
        <div className="mt-2.5 min-h-[44px]">
          {ready ? (
            <>
              <div className="hg-label !text-[9px] !text-cream/45">
                Pin placed · {Math.abs(pin.lat).toFixed(1)}°{pin.lat >= 0 ? "N" : "S"} {Math.abs(pin.lng).toFixed(1)}°{pin.lng >= 0 ? "E" : "W"}
              </div>
              <div className="mt-1 font-display text-xl tracking-wide text-cream">{formatEra(year)}</div>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-cream/45">Drop a pin on the map and set a year on the timeline.</p>
          )}
        </div>
      </div>
      <div className={`flex items-center justify-between border-t px-4 py-2.5 ${ready ? "border-cream/30 bg-cream/10" : "border-cream/10"}`}>
        <span className={`font-mono text-[11px] tracking-[0.3em] ${ready ? "text-cream" : "text-cream/40"}`}>{ready ? "GUESS" : "DROP PIN"}</span>
        <span className={`transition-transform ${ready ? "text-cream group-hover:translate-x-1" : "text-cream/40"}`}>→</span>
      </div>
    </button>
  );
}
