"use client";
/**
 * MiniMap — the "1 · PLACE" panel of the round HUD: a small parchment world map in the bottom-left
 * corner that the player taps to drop a pin, with EXPAND and +/− zoom buttons.
 *
 * How it fits the architecture: components/game/RoundScreen.tsx owns the pin and the expanded flag
 * (so the M keyboard shortcut in components/game/useGameKeys.ts can toggle it) and renders this panel.
 * The map itself is components/guess/GuessMap.tsx, loaded client-only via LazyGuessMap; we get its
 * Leaflet instance through `onMapReady` to drive the custom zoom buttons.
 *
 * Use cases / states:
 *  - collapsed: UI.miniMapWidth × UI.miniMapHeight (lib/config.ts), anchored bottom-left above the
 *    label "1  PLACE · TAP MAP TO PIN"
 *  - expanded:  UI.expandedMapVw × UI.expandedMapVh, centred over the scene with a dark scrim behind
 *    it (click the scrim, press M or Esc, or the COLLAPSE button to shrink it back). The same Leaflet
 *    instance is kept (only the wrapper resizes), so zoom and pin survive the toggle.
 *  - pin placed: label switches to "PIN DROPPED · TAP TO MOVE"
 */
import { useCallback, useRef } from "react";
import type L from "leaflet";
import { UI } from "@/lib/config";
import { log } from "@/lib/log";
import type { LatLng } from "@/lib/scoring";
import { LazyGuessMap } from "./LazyGuessMap";

export type MiniMapProps = {
  pin: LatLng | null;
  onPick: (p: LatLng) => void;
  expanded: boolean;
  onToggleExpand: () => void;
};

/**
 * Small square dark button used for expand / zoom.
 * @param props.label accessible label
 * @param props.onClick click handler
 * @param props.children icon / text
 * @param props.className extra classes
 */
function MapButton({ label, onClick, children, className = "" }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  log.info("MiniMap.MapButton", { label });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center justify-center border border-cream/20 bg-black/70 font-mono text-[10px] tracking-[0.2em] text-cream/85 backdrop-blur transition hover:border-cream/60 hover:bg-black/90 hover:text-cream ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Renders the place panel (label + map + controls).
 * @param props see MiniMapProps
 */
export function MiniMap({ pin, onPick, expanded, onToggleExpand }: MiniMapProps) {
  log.info("MiniMap", { pin, expanded });
  const mapRef = useRef<L.Map | null>(null);
  const handleReady = useCallback((m: L.Map) => {
    log.info("MiniMap.handleReady", {});
    mapRef.current = m;
  }, []);

  const size = expanded
    ? { width: `${UI.expandedMapVw}vw`, height: `${UI.expandedMapVh}vh` }
    : { width: `min(${UI.miniMapWidth}px, 34vw)`, height: `min(${UI.miniMapHeight}px, 26vh)` };

  return (
    <>
      {expanded && <div className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px]" onClick={onToggleExpand} aria-hidden />}
      <div className={expanded ? "fixed inset-0 z-40 flex items-center justify-center pointer-events-none" : "relative"}>
        <div className="pointer-events-auto">
          <div className="mb-2 flex items-baseline gap-3">
            <span className="hg-label !text-cream">1&nbsp;&nbsp;Place</span>
            <span className="hg-label !text-cream/45">{pin ? "Pin dropped · tap to move" : "Tap map to pin"}</span>
          </div>
          <div
            className="relative overflow-hidden border border-cream/35 shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-[width,height] duration-300 ease-out"
            style={size}
          >
            <LazyGuessMap pin={pin} onPick={onPick} onMapReady={handleReady} />
            <MapButton label={expanded ? "Collapse map (M)" : "Expand map (M)"} onClick={onToggleExpand} className="absolute right-2 top-2 z-[500] gap-1.5 px-2.5 py-1.5">
              <span className="text-[12px] leading-none">{expanded ? "⤡" : "⛶"}</span>
              {expanded ? "COLLAPSE" : "EXPAND"}
            </MapButton>
            <div className="absolute bottom-6 right-2 z-[500] flex flex-col">
              <MapButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()} className="h-7 w-7 text-sm">
                +
              </MapButton>
              <MapButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()} className="-mt-px h-7 w-7 text-sm">
                −
              </MapButton>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
