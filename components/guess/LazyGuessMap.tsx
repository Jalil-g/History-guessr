"use client";
/**
 * LazyGuessMap — the client-only entry point for the Leaflet guess / reveal map.
 *
 * Why it exists: Leaflet reads `window` when its module is evaluated, which crashes server rendering
 * in Next.js. Wrapping components/guess/GuessMap.tsx in next/dynamic with `ssr: false` defers the
 * import to the browser. Every screen that shows a map (RoundScreen for picking, RevealScreen for the
 * answer) imports `LazyGuessMap` from here instead of importing GuessMap directly.
 *
 * While the chunk loads, a parchment-coloured placeholder of the same size is shown.
 */
import dynamic from "next/dynamic";

/** Placeholder rendered while Leaflet loads. */
function MapLoading() {
  return <div className="flex h-full w-full items-center justify-center bg-[#1c1610] text-xs text-amber-200/50">Unrolling the map…</div>;
}

/** The GuessMap component, loaded only in the browser. Same props as GuessMapProps. */
export const LazyGuessMap = dynamic(() => import("./GuessMap"), { ssr: false, loading: MapLoading });
